// api/funnel-steps/index.ts — Steps CRUD + suggest + draft + approve + import
//
// Query param `action` controls behavior:
//   GET  ?funnel_id=xxx                    → list steps for funnel
//   GET  ?id=xxx                            → get one step
//   POST                                    → create/update step (body has fields)
//   POST ?action=suggest&funnel_id=xxx      → auto-create steps from type.suggested_steps
//   POST ?action=draft&id=xxx               → generate copy_draft JSON from formula+input
//   POST ?action=approve&id=xxx             → mark approved + generate HTML
//   POST ?action=import&id=xxx              → save imported HTML (body.html)
//   POST ?action=direct&id=xxx              → 1-step generate HTML (skip draft)
//   DELETE ?id=xxx                          → delete step

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { composeDraftPrompts, composeRenderPrompts, StyleInstructions } from '../../services/prompt-composer'
import { runCompletion } from '../../services/ai-router'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

const CODEX_HEADERS_INJECT = true  // Use codex CF headers via router

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  const userToken = authHeader.slice(7)

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return res.status(401).json({ error: 'Invalid token' })
  const { data: caller } = await userClient.from('customers').select('role').eq('id', user.id).maybeSingle()
  if (caller?.role !== 'admin') return res.status(403).json({ error: 'Admin only' })

  const admin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const url = new URL(req.url || '', 'http://localhost')
  const id = url.searchParams.get('id')
  const action = url.searchParams.get('action')
  const funnelId = url.searchParams.get('funnel_id')

  try {
    // ───── GET ─────
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await admin.from('funnel_steps').select('*').eq('id', id).single()
        if (error) return res.status(404).json({ error: error.message })
        return res.json(data)
      }
      if (funnelId) {
        const { data } = await admin.from('funnel_steps').select('*').eq('funnel_id', funnelId).order('step_number')
        return res.json({ steps: data || [] })
      }
      return res.status(400).json({ error: 'id or funnel_id required' })
    }

    // ───── DELETE ─────
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await admin.from('funnel_steps').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ success: true })
    }

    // ───── POST ─────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    // Action: REORDER — set step_number for a list of step ids in given order
    if (action === 'reorder' && funnelId) {
      const body = req.body || {}
      const orderedIds: string[] = body.ordered_ids || []
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) return res.status(400).json({ error: 'ordered_ids required' })

      // 2-phase update to avoid UNIQUE(funnel_id, step_number) violations:
      // Phase 1: set step_number = -1000 - index for all target rows (guaranteed unique + non-conflicting)
      // Phase 2: set step_number = index + 1 to final values
      for (let i = 0; i < orderedIds.length; i++) {
        await admin.from('funnel_steps').update({ step_number: -1000 - i }).eq('id', orderedIds[i]).eq('funnel_id', funnelId)
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await admin.from('funnel_steps').update({ step_number: i + 1, updated_at: new Date().toISOString() }).eq('id', orderedIds[i]).eq('funnel_id', funnelId)
      }
      const { data } = await admin.from('funnel_steps').select('*').eq('funnel_id', funnelId).order('step_number')
      return res.json({ steps: data || [] })
    }

    // Action: SUGGEST — auto-create steps from type.suggested_steps
    if (action === 'suggest' && funnelId) {
      const { data: flow } = await admin.from('funnel_flows').select('type_key').eq('id', funnelId).single()
      if (!flow) return res.status(404).json({ error: 'Funnel not found' })
      const { data: type } = await admin.from('funnel_types').select('suggested_steps').eq('key', flow.type_key).maybeSingle()
      const suggested = (type?.suggested_steps || []) as any[]
      if (!suggested.length) return res.status(400).json({ error: 'Type has no suggested steps' })
      // Delete existing steps first? User probably wants clean slate — check first
      const { data: existing } = await admin.from('funnel_steps').select('id').eq('funnel_id', funnelId)
      if (existing && existing.length > 0) {
        return res.status(409).json({ error: 'Funnel đã có steps. Xoá trước khi suggest lại.' })
      }
      const rows = suggested.map((s: any) => ({
        funnel_id: funnelId,
        step_number: s.step_number,
        slug: s.slug,
        name: s.name,
        page_type: s.page_type,
        has_form: !!s.has_form,
        form_mode: s.form_mode || (s.has_form ? 'inline' : 'none'),
        form_fields: s.form_fields || [],
        form_success_step_slug: s.form_success_step_slug || null,
        content_source: 'ai_draft',
        copy_input: {},
        html: null,
      }))
      const { data, error } = await admin.from('funnel_steps').insert(rows).select().order('step_number')
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ steps: data || [] })
    }

    // Action: DRAFT — generate copy_draft JSON from formula+input
    if (action === 'draft' && id) {
      const { data: step } = await admin.from('funnel_steps').select('*').eq('id', id).single()
      if (!step) return res.status(404).json({ error: 'Step not found' })
      const { data: flow } = await admin.from('funnel_flows').select('shared_context').eq('id', step.funnel_id).single()
      const body = req.body || {}
      const formulaKey = body.formula_key || step.copy_formula_key || 'pas'
      const rawInput = body.raw_input || step.copy_raw_input || ''

      const { system, user } = await composeDraftPrompts({
        funnelId: step.funnel_id,
        stepId: id,
        formulaKey,
        rawInput,
        sharedContext: flow?.shared_context || {},
        stepMeta: { name: step.name, page_type: step.page_type, has_form: step.has_form },
      })

      const result = await runCompletion({
        provider: 'openai-codex',
        model: body.model,
        systemPrompt: system,
        userPrompt: user,
        maxTokens: 8000,
        temperature: 0.7,
      })

      // Parse JSON — strip fence if present
      let text = result.text.trim()
      const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
      if (fence) text = fence[1].trim()

      let draft
      try {
        draft = JSON.parse(text)
      } catch (e: any) {
        return res.status(500).json({ error: `AI returned invalid JSON: ${e.message}`, raw: text.slice(0, 500) })
      }

      // Save + version
      const { data: nextVer } = await admin.from('funnel_step_copy_versions')
        .select('version_number').eq('step_id', id).order('version_number', { ascending: false }).limit(1).maybeSingle()
      const nextNum = (nextVer?.version_number || 0) + 1

      await admin.from('funnel_step_copy_versions').insert({
        step_id: id, version_number: nextNum,
        copy_draft: draft, copy_formula_key: formulaKey, copy_raw_input: rawInput,
        generation_meta: { provider: result.provider, model: result.model, usage: result.usage },
      })
      await admin.from('funnel_steps').update({
        copy_formula_key: formulaKey, copy_raw_input: rawInput,
        copy_draft: draft, copy_approved: false, copy_approved_at: null,
        content_source: 'ai_draft', updated_at: new Date().toISOString(),
      }).eq('id', id)

      return res.json({ draft, version_number: nextNum, meta: { provider: result.provider, model: result.model, usage: result.usage } })
    }

    // Action: APPROVE — render HTML from approved copy_draft
    if (action === 'approve' && id) {
      const { data: step } = await admin.from('funnel_steps').select('*').eq('id', id).single()
      if (!step) return res.status(404).json({ error: 'Step not found' })
      if (!step.copy_draft || !(step.copy_draft as any).blocks?.length) {
        return res.status(400).json({ error: 'Step chưa có copy_draft. Draft trước rồi mới approve.' })
      }
      const body = req.body || {}
      const editedDraft = body.copy_draft || step.copy_draft  // Allow user-edited draft
      const { data: flow } = await admin.from('funnel_flows').select('style_preset').eq('id', step.funnel_id).single()

      const { system, user } = await composeRenderPrompts({
        funnelId: step.funnel_id, stepId: id,
        copyDraft: editedDraft,
        style: (flow?.style_preset || {}) as StyleInstructions,
        stepMeta: {
          name: step.name, page_type: step.page_type,
          has_form: step.has_form, form_fields: step.form_fields,
        },
      })

      const result = await runCompletion({
        provider: 'openai-codex', model: body.model,
        systemPrompt: system, userPrompt: user,
        maxTokens: 16000, temperature: 0.5,
      })

      let html = result.text.trim()
      const fence = html.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/)
      if (fence) html = fence[1].trim()
      if (!html.toLowerCase().startsWith('<!doctype')) html = `<!DOCTYPE html>\n${html}`

      // Inject hidden form fields for funnel_id/step_id
      html = injectFormHiddens(html, step.funnel_id, id)

      await admin.from('funnel_steps').update({
        copy_draft: editedDraft, copy_approved: true, copy_approved_at: new Date().toISOString(),
        html, html_generated_from_copy_at: new Date().toISOString(),
        generation_meta: { provider: result.provider, model: result.model, usage: result.usage, generatedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq('id', id)

      return res.json({ html, meta: { provider: result.provider, model: result.model, usage: result.usage } })
    }

    // Action: IMPORT — save external HTML with transforms
    if (action === 'import' && id) {
      const body = req.body || {}
      if (!body.html) return res.status(400).json({ error: 'html required' })
      const cfg = body.config || {}

      let html = String(body.html)
      const original = html

      // Basic transforms (Cheerio would be better but not installed — regex for MVP)
      if (cfg.strip_external_scripts !== false) {
        html = html.replace(/<script[^>]*src=["']https?:\/\/[^"']+["'][^>]*>\s*<\/script>/gi, '<!-- stripped external script -->')
      }
      if (cfg.override_form_action !== false) {
        html = html.replace(/<form([^>]*?)action=["'][^"']*["']([^>]*?)>/gi, '<form$1action="/api/f/submit"$2 data-form="1">')
      }
      if (cfg.auto_tag_ctas !== false) {
        // Add data-cta="1" to <button> and <a class="button|btn|cta">
        html = html.replace(/<(button)([^>]*)>/gi, (match, tag, attrs) => {
          if (/data-cta=/.test(attrs)) return match
          return `<${tag}${attrs} data-cta="1">`
        })
      }

      const { data: step } = await admin.from('funnel_steps').select('funnel_id').eq('id', id).single()
      if (step) html = injectFormHiddens(html, step.funnel_id, id)

      await admin.from('funnel_steps').update({
        content_source: 'imported', html, import_original_html: original,
        import_config: cfg, copy_approved: true, copy_approved_at: new Date().toISOString(),
        html_generated_from_copy_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', id)

      return res.json({ html, imported: true })
    }

    // Regular POST — create/update step
    const body = req.body || {}
    if (!body.funnel_id) return res.status(400).json({ error: 'funnel_id required' })
    if (!body.name) return res.status(400).json({ error: 'name required' })

    const payload: any = {
      funnel_id: body.funnel_id,
      step_number: body.step_number || 1,
      slug: body.slug || `step-${body.step_number || 1}`,
      name: body.name, page_type: body.page_type || 'landing',
      content_source: body.content_source || 'ai_draft',
      has_form: !!body.has_form, form_mode: body.form_mode || (body.has_form ? 'inline' : 'none'),
      form_fields: body.form_fields || [],
      form_success_step_slug: body.form_success_step_slug || null,
      form_success_url: body.form_success_url || null,
      copy_input: body.copy_input || {},
      copy_formula_key: body.copy_formula_key || null,
      copy_raw_input: body.copy_raw_input || null,
      updated_at: new Date().toISOString(),
    }
    if (body.id) {
      const { data, error } = await admin.from('funnel_steps').update(payload).eq('id', body.id).select().single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json(data)
    } else {
      const { data, error } = await admin.from('funnel_steps').insert(payload).select().single()
      if (error) return res.status(500).json({ error: error.message })
      return res.json(data)
    }
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}

function injectFormHiddens(html: string, funnelId: string, stepId: string): string {
  return html.replace(/<form([^>]*)>/gi, (match, attrs) => {
    // Only inject if this form points to our submit endpoint
    if (!/\/api\/f\/submit/.test(attrs)) return match
    const alreadyHasFunnel = new RegExp(`name=["']funnel_id["']`).test(html)
    const alreadyHasStep = new RegExp(`name=["']step_id["']`).test(html)
    const hiddens: string[] = []
    if (!alreadyHasFunnel) hiddens.push(`<input type="hidden" name="funnel_id" value="${funnelId}">`)
    if (!alreadyHasStep) hiddens.push(`<input type="hidden" name="step_id" value="${stepId}">`)
    return `<form${attrs}>${hiddens.join('')}`
  })
}
