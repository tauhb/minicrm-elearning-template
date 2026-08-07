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
import { composeDraftPrompts, composeBlockRenderPrompts, buildHtmlShell, StyleInstructions } from '../../services/prompt-composer'
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

    // Action: APPROVE — render HTML from approved copy_draft using PER-BLOCK generation
    // Each block → 1 small AI call (avoids max_output_tokens limits + faster in parallel)
    if (action === 'approve' && id) {
      const { data: step } = await admin.from('funnel_steps').select('*').eq('id', id).single()
      if (!step) return res.status(404).json({ error: 'Step not found' })
      if (!step.copy_draft || !(step.copy_draft as any).blocks?.length) {
        return res.status(400).json({ error: 'Step chưa có copy_draft. Draft trước rồi mới approve.' })
      }
      const body = req.body || {}
      const editedDraft = body.copy_draft || step.copy_draft
      const blocks = (editedDraft.blocks || []) as Array<{ kind: string; content: any }>
      const { data: flow } = await admin.from('funnel_flows').select('style_preset').eq('id', step.funnel_id).single()
      const style = (flow?.style_preset || {}) as StyleInstructions
      const renderInstructions = body.render_instructions ?? step.render_instructions ?? undefined

      const stepMeta = {
        name: step.name, page_type: step.page_type,
        has_form: step.has_form, form_fields: step.form_fields,
      }

      const CONCURRENCY = 3
      const htmlBlocks: Array<{ kind: string; content: any; html: string; generated_at: string; error?: string; usage?: any }> = new Array(blocks.length)

      async function renderOne(block: { id?: string; kind: string; content: any; extras?: any }, index: number) {
        if (block.kind === 'custom' && block.content?.html) {
          htmlBlocks[index] = {
            id: block.id, kind: block.kind, content: block.content, extras: block.extras,
            html: `<section class="py-16 md:py-24" data-block-index="${index}" data-block-kind="${block.kind}"${block.id ? ` data-block-id="${block.id}"` : ''}>${block.content.html}</section>`,
            generated_at: new Date().toISOString(),
          }
          return
        }
        try {
          const { system, user } = await composeBlockRenderPrompts({
            funnelId: step.funnel_id, stepId: step.id, block, style, stepMeta, renderInstructions,
          })
          const r = await runCompletion({
            provider: 'openai-codex', model: body.model,
            systemPrompt: system, userPrompt: user,
          })
          let sectionHtml = r.text.trim()
          const fence = sectionHtml.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/)
          if (fence) sectionHtml = fence[1].trim()
          sectionHtml = sectionHtml.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '').trim()
          if (!sectionHtml) sectionHtml = `<!-- block ${block.kind} empty -->`
          sectionHtml = injectBlockMeta(sectionHtml, index, block.kind, block.id)
          htmlBlocks[index] = {
            id: block.id, kind: block.kind, content: block.content, extras: block.extras,
            html: sectionHtml, generated_at: new Date().toISOString(),
            usage: r.usage,
          }
        } catch (e: any) {
          htmlBlocks[index] = {
            id: block.id, kind: block.kind, content: block.content, extras: block.extras,
            html: `<!-- block ${block.kind} error: ${e.message.slice(0, 80)} -->`,
            generated_at: new Date().toISOString(), error: e.message,
          }
        }
      }

      for (let i = 0; i < blocks.length; i += CONCURRENCY) {
        const batch = blocks.slice(i, i + CONCURRENCY)
        await Promise.all(batch.map((b, j) => renderOne(b, i + j)))
      }

      const bodyContent = htmlBlocks.map(b => b?.html || '').join('\n\n')
      const errors = htmlBlocks.filter(b => b?.error).map(b => b.error!)
      let html = buildHtmlShell({
        title: step.page_title || step.name,
        description: step.page_description || undefined,
        style, bodyContent,
      })
      html = injectFormHiddens(html, step.funnel_id, id)

      const totalUsage = htmlBlocks.reduce((acc, b) => {
        if (b?.usage) {
          acc.input_tokens = (acc.input_tokens || 0) + (b.usage.input_tokens || 0)
          acc.output_tokens = (acc.output_tokens || 0) + (b.usage.output_tokens || 0)
        }
        return acc
      }, { input_tokens: 0, output_tokens: 0 } as any)

      await admin.from('funnel_steps').update({
        copy_draft: editedDraft, copy_approved: true, copy_approved_at: new Date().toISOString(),
        html, html_blocks: htmlBlocks,
        html_generated_from_copy_at: new Date().toISOString(),
        render_instructions: renderInstructions ?? null,
        generation_meta: {
          provider: 'openai-codex', model: body.model || 'gpt-5.6-sol',
          usage: totalUsage, generatedAt: new Date().toISOString(),
          blocks_rendered: htmlBlocks.length, block_errors: errors.length,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', id)

      return res.json({
        html,
        meta: { blocks_rendered: htmlBlocks.length, block_errors: errors.length, usage: totalUsage, errors: errors.slice(0, 5) },
      })
    }

    // Action: REGENERATE-BLOCK — re-render 1 block via AI, update html_blocks[i] + rebuild html
    if (action === 'regenerate-block' && id) {
      const body = req.body || {}
      const blockIndex = Number(body.block_index)
      if (isNaN(blockIndex) || blockIndex < 0) return res.status(400).json({ error: 'block_index required' })

      const { data: step } = await admin.from('funnel_steps').select('*').eq('id', id).single()
      if (!step) return res.status(404).json({ error: 'Step not found' })
      const draft = (step.copy_draft as any) || { blocks: [] }
      const block = draft.blocks?.[blockIndex]
      if (!block) return res.status(400).json({ error: `Block index ${blockIndex} not found in copy_draft` })

      if (body.content) block.content = body.content

      const { data: flow } = await admin.from('funnel_flows').select('style_preset').eq('id', step.funnel_id).single()
      const style = (flow?.style_preset || {}) as StyleInstructions
      const renderInstructions = body.render_instructions ?? step.render_instructions ?? undefined
      const stepMeta = { name: step.name, page_type: step.page_type, has_form: step.has_form, form_fields: step.form_fields }

      // Allow extras override from client
      if (body.extras) block.extras = body.extras

      let sectionHtml: string
      let usage: any
      try {
        if (block.kind === 'custom' && block.content?.html) {
          sectionHtml = `<section class="py-16 md:py-24" data-block-index="${blockIndex}" data-block-kind="${block.kind}"${block.id ? ` data-block-id="${block.id}"` : ''}>${block.content.html}</section>`
        } else {
          const { system, user } = await composeBlockRenderPrompts({
            funnelId: step.funnel_id, stepId: step.id, block, style, stepMeta, renderInstructions,
          })
          const r = await runCompletion({ provider: 'openai-codex', model: body.model, systemPrompt: system, userPrompt: user })
          usage = r.usage
          let s = r.text.trim()
          const fence = s.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/)
          if (fence) s = fence[1].trim()
          s = s.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '').trim()
          if (!s) s = `<!-- block ${block.kind} empty -->`
          sectionHtml = injectBlockMeta(s, blockIndex, block.kind, block.id)
        }
      } catch (e: any) {
        return res.status(500).json({ error: `Block render failed: ${e.message}` })
      }

      const existingBlocks = (((step.html_blocks as any) || []) as any[]).slice()
      while (existingBlocks.length <= blockIndex) existingBlocks.push(null)
      existingBlocks[blockIndex] = {
        id: block.id, kind: block.kind, content: block.content, extras: block.extras,
        html: sectionHtml, generated_at: new Date().toISOString(), usage,
      }

      const bodyContent = existingBlocks.map(b => b?.html || '').join('\n\n')
      let html = buildHtmlShell({
        title: step.page_title || step.name,
        description: step.page_description || undefined,
        style, bodyContent,
      })
      html = injectFormHiddens(html, step.funnel_id, id)

      draft.blocks[blockIndex] = block
      await admin.from('funnel_steps').update({
        copy_draft: draft, html, html_blocks: existingBlocks,
        html_generated_from_copy_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', id)

      return res.json({ html, block_html: sectionHtml, block_index: blockIndex, usage })
    }

    // Action: SYNC-OUTLINE — deterministic string-replace when user edits outline (no AI)
    // Returns which blocks are "stale" (couldn't be text-replaced → need regenerate)
    if (action === 'sync-outline' && id) {
      const body = req.body || {}
      const newDraft = body.copy_draft
      if (!newDraft?.blocks) return res.status(400).json({ error: 'copy_draft required' })

      const { data: step } = await admin.from('funnel_steps').select('*').eq('id', id).single()
      if (!step) return res.status(404).json({ error: 'Step not found' })
      const existingBlocks = (((step.html_blocks as any) || []) as any[]).slice()
      const { data: flow } = await admin.from('funnel_flows').select('style_preset').eq('id', step.funnel_id).single()
      const style = (flow?.style_preset || {}) as StyleInstructions

      // Build lookup by block id (primary) with content-hash fallback for backward-compat blocks
      const byId = new Map<string, any>()
      const byHash = new Map<string, any>()
      existingBlocks.forEach(b => {
        if (b?.id) byId.set(b.id, b)
        if (b?.content) byHash.set(hashContent(b.kind, b.content), b)
      })

      const dirty: number[] = []
      const dirtyIds: string[] = []
      const updatedBlocks: any[] = []

      newDraft.blocks.forEach((newBlock: any, i: number) => {
        // Try match by id first, then by content hash (for moved blocks whose content didn't change)
        let existing = newBlock.id ? byId.get(newBlock.id) : undefined
        if (!existing) existing = byHash.get(hashContent(newBlock.kind, newBlock.content))

        if (!existing) {
          // New block — needs render
          dirty.push(i)
          if (newBlock.id) dirtyIds.push(newBlock.id)
          updatedBlocks[i] = {
            id: newBlock.id,
            kind: newBlock.kind, content: newBlock.content, extras: newBlock.extras,
            html: `<!-- block ${i} (${newBlock.kind}) needs render -->`, is_stale: true,
          }
          return
        }
        if (existing.kind !== newBlock.kind) {
          dirty.push(i)
          if (newBlock.id) dirtyIds.push(newBlock.id)
          updatedBlocks[i] = { ...existing, id: newBlock.id || existing.id, kind: newBlock.kind, content: newBlock.content, extras: newBlock.extras, is_stale: true }
          return
        }
        // Attempt text-replace sync
        const { synced, html: newHtml } = trySyncBlock(existing.content, newBlock.content, existing.html || '')
        if (synced) {
          updatedBlocks[i] = { ...existing, id: newBlock.id || existing.id, content: newBlock.content, extras: newBlock.extras, html: newHtml, is_stale: false }
        } else {
          dirty.push(i)
          if (newBlock.id) dirtyIds.push(newBlock.id)
          updatedBlocks[i] = { ...existing, id: newBlock.id || existing.id, content: newBlock.content, extras: newBlock.extras, is_stale: true }
        }
      })

      const bodyContent = updatedBlocks.map(b => b?.html || '').join('\n\n')
      let html = buildHtmlShell({
        title: step.page_title || step.name,
        description: step.page_description || undefined,
        style, bodyContent,
      })
      html = injectFormHiddens(html, step.funnel_id, id)

      await admin.from('funnel_steps').update({
        copy_draft: newDraft, html, html_blocks: updatedBlocks,
        updated_at: new Date().toISOString(),
      }).eq('id', id)

      return res.json({
        synced_count: updatedBlocks.length - dirty.length,
        dirty_indices: dirty,
        dirty_ids: dirtyIds,
        html,
      })
    }

    // Action: GENERATE-BLOCK — AI generates 1 block content from intent
    // Used by AddBlockModal (auto-fill on click) + custom AI freeform
    // Accepts context_blocks + funnel shared_context so AI generates content that fits the page
    if (action === 'generate-block' && id) {
      const body = req.body || {}
      const intent = String(body.intent || '').trim()
      const hintKind = String(body.hint_kind || 'custom')
      const contextBlocks = Array.isArray(body.context_blocks) ? body.context_blocks : []
      if (!intent && hintKind === 'custom') return res.status(400).json({ error: 'intent required for custom block' })

      const { data: step } = await admin.from('funnel_steps').select('funnel_id, page_type, name').eq('id', id).single()
      if (!step) return res.status(404).json({ error: 'Step not found' })
      const { data: flow } = await admin.from('funnel_flows').select('shared_context').eq('id', step.funnel_id).single()

      // Build content shape hint for known kinds (so AI outputs the right structure)
      const shapeHints: Record<string, string> = {
        'hero': '{ headline, subheadline, cta_text }',
        'hero-video': '{ headline, subheadline, cta_text, video_url? }',
        'hero-split': '{ headline, subheadline, cta_text, visual_hint }',
        'pain-list': '{ title, bullets: string[] (3-5) }',
        'pain-story': '{ title, story: string (2-4 paragraphs) }',
        'solution-reveal': '{ title, body, tagline? }',
        'feature-benefit': '{ title, items: [{feature, benefit}] (3-6) }',
        'mechanism': '{ title, steps: [{name, description}] (3-5) }',
        'testimonials-grid': '{ title, items: [{quote, author_name, author_title?}] (2-6) }',
        'testimonial-quote': '{ quote, author_name, author_title? }',
        'stats-numbers': '{ title?, items: [{number, label}] (3-4) }',
        'logos-strip': '{ title?, logos: [{name}] (4-8) }',
        'case-study': '{ title, subject_name, before, after, quote }',
        'pricing-table': '{ title?, tiers: [{name, price, features: string[], highlighted?, cta_text}] }',
        'pricing-single': '{ name, price, price_anchor?, features: string[], cta_text }',
        'bonus-stack': '{ title, items: [{name, description, value_note}] }',
        'guarantee': '{ title, body, days?: number }',
        'countdown': '{ title, target_date_hint, subtext? }',
        'scarcity-list': '{ title, items: string[] }',
        'faq-accordion': '{ title, items: [{question, answer}] (5-8) }',
        'comparison-table': '{ title, columns: string[], rows: [{feature, values: string[]}] }',
        'timeline': '{ title, steps: [{when, title, description}] }',
        'cta-simple': '{ headline?, cta_text, sub? }',
        'cta-with-form': '{ headline, sub?, cta_text }',
        'cta-repeat': '{ headline, sub, cta_text, urgency_note? }',
        'custom': '{ intent, markdown }',
      }
      const targetShape = shapeHints[hintKind] || shapeHints.custom
      const isCustomKind = hintKind === 'custom'

      const systemPrompt = isCustomKind
        ? `Bạn là copywriter tạo 1 BLOCK JSON cho landing page tiếng Việt.
Output PHẢI là JSON valid: { "kind": "<block_kind>", "content": {...} }
Available kinds: hero, hero-video, hero-split, pain-list, pain-story, solution-reveal, feature-benefit, mechanism, testimonials-grid, testimonial-quote, stats-numbers, logos-strip, case-study, pricing-table, pricing-single, bonus-stack, guarantee, countdown, scarcity-list, faq-accordion, comparison-table, timeline, cta-simple, cta-with-form, cta-repeat, custom.
Nếu không kind nào phù hợp → dùng "custom" với content { intent, markdown }.
KHÔNG wrap markdown code fence. Chỉ pure JSON. Tiếng Việt, dùng "bạn".`
        : `Bạn là copywriter tạo 1 BLOCK JSON kind "${hintKind}" cho landing page tiếng Việt.
Output PHẢI là JSON valid: { "kind": "${hintKind}", "content": {...} }
Content shape BẮT BUỘC: ${targetShape}
Đọc context của funnel + các blocks đã có để viết content phù hợp, không lặp lại nội dung của blocks khác.
KHÔNG wrap markdown code fence. Chỉ pure JSON. Tiếng Việt, dùng "bạn".`

      const contextLines: string[] = [`# Step: ${step.name} (${step.page_type})`]
      if (flow?.shared_context && Object.keys(flow.shared_context).length > 0) {
        contextLines.push('', '# Funnel Shared Context')
        Object.entries(flow.shared_context).forEach(([k, v]) => {
          contextLines.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        })
      }
      if (contextBlocks.length > 0) {
        contextLines.push('', '# Blocks đã có trong step này (đừng lặp nội dung)')
        contextBlocks.forEach((b: any, i: number) => {
          const preview = b?.content?.headline || b?.content?.title || b?.content?.quote || JSON.stringify(b?.content || {}).slice(0, 80)
          contextLines.push(`${i + 1}. [${b.kind}] ${String(preview).slice(0, 100)}`)
        })
      }
      if (intent) contextLines.push('', '# User intent', intent)
      contextLines.push('', '# Task', isCustomKind
        ? 'Sinh 1 block JSON phù hợp với intent + context. Chọn kind hợp lý.'
        : `Sinh content JSON cho block kind "${hintKind}" — phù hợp với funnel context + không lặp blocks khác.`)

      try {
        const r = await runCompletion({ provider: 'openai-codex', model: body.model, systemPrompt, userPrompt: contextLines.join('\n'), maxTokens: 2000 })
        let text = r.text.trim()
        const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
        if (fence) text = fence[1].trim()
        let block
        try {
          block = JSON.parse(text)
        } catch (e: any) {
          return res.status(500).json({ error: `AI returned invalid JSON: ${e.message}`, raw: text.slice(0, 500) })
        }
        if (!block.kind) block.kind = hintKind
        if (!block.content) block.content = { intent, markdown: '' }
        return res.json({ block, usage: r.usage })
      } catch (e: any) {
        return res.status(500).json({ error: e.message })
      }
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
    if (body.render_instructions !== undefined) payload.render_instructions = body.render_instructions
    if (body.copy_draft !== undefined) payload.copy_draft = body.copy_draft
    if (body.page_title !== undefined) payload.page_title = body.page_title || null
    if (body.page_description !== undefined) payload.page_description = body.page_description || null
    // Product assignment + upsell config (order/upsell steps)
    if (body.assigned_product_id !== undefined) payload.assigned_product_id = body.assigned_product_id || null
    if (body.price_override !== undefined) {
      const n = body.price_override === null || body.price_override === '' ? null : Number(body.price_override)
      payload.price_override = n !== null && !isNaN(n) && n >= 0 ? Math.floor(n) : null
    }
    if (body.upsell_config !== undefined) payload.upsell_config = body.upsell_config || {}
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
    if (!/\/api\/f\/submit/.test(attrs)) return match
    const alreadyHasFunnel = new RegExp(`name=["']funnel_id["']`).test(html)
    const alreadyHasStep = new RegExp(`name=["']step_id["']`).test(html)
    const hiddens: string[] = []
    if (!alreadyHasFunnel) hiddens.push(`<input type="hidden" name="funnel_id" value="${funnelId}">`)
    if (!alreadyHasStep) hiddens.push(`<input type="hidden" name="step_id" value="${stepId}">`)
    return `<form${attrs}>${hiddens.join('')}`
  })
}

/** Inject data-block-index + data-block-id attributes into first section/div of block HTML. */
function injectBlockMeta(html: string, index: number, kind: string, blockId?: string): string {
  if (/data-block-index=/.test(html.slice(0, 200))) return html
  const idAttr = blockId ? ` data-block-id="${blockId}"` : ''
  return html.replace(/^(\s*<[a-z][a-z0-9]*)(\s|>)/i, (m, tag, sep) =>
    `${tag} data-block-index="${index}" data-block-kind="${kind}"${idAttr}${sep}`)
}

/** Deterministic text-replace sync for outline edits.
 *  For each changed string field in newContent, try to find it in existing HTML and replace.
 *  Returns { synced: true, html: updated } if ALL string changes could be replaced;
 *  else { synced: false, html: unchanged } → caller should mark block as stale + offer regenerate. */
function trySyncBlock(oldContent: any, newContent: any, html: string): { synced: boolean; html: string } {
  const changes = diffStrings(oldContent, newContent)
  if (!changes.length) return { synced: true, html }
  let updated = html
  for (const { oldValue, newValue } of changes) {
    if (!oldValue || oldValue === newValue) continue
    // HTML-escape both — since AI outputs escaped text
    const oldEsc = escapeForHtml(oldValue)
    const newEsc = escapeForHtml(newValue)
    if (updated.includes(oldValue)) {
      updated = updated.split(oldValue).join(newValue)
    } else if (oldEsc !== oldValue && updated.includes(oldEsc)) {
      updated = updated.split(oldEsc).join(newEsc)
    } else {
      // Not found → can't safely sync
      return { synced: false, html }
    }
  }
  return { synced: true, html: updated }
}

/** Walk two objects and collect changed string leaves.
 *  Returns [{path, oldValue, newValue}] for each string field that changed. */
function diffStrings(oldObj: any, newObj: any, path: string = ''): Array<{ path: string; oldValue: string; newValue: string }> {
  const changes: Array<{ path: string; oldValue: string; newValue: string }> = []
  if (typeof oldObj === 'string' && typeof newObj === 'string') {
    if (oldObj !== newObj) changes.push({ path, oldValue: oldObj, newValue: newObj })
    return changes
  }
  if (Array.isArray(oldObj) && Array.isArray(newObj)) {
    // Only sync if lengths match (arrays getting shorter/longer needs regen)
    if (oldObj.length !== newObj.length) {
      // Report any string change we can find
      const minLen = Math.min(oldObj.length, newObj.length)
      for (let i = 0; i < minLen; i++) changes.push(...diffStrings(oldObj[i], newObj[i], `${path}[${i}]`))
      // Return with marker that structural change happened — caller decides
      return changes  // Note: caller may still succeed if only string edits found
    }
    for (let i = 0; i < oldObj.length; i++) {
      changes.push(...diffStrings(oldObj[i], newObj[i], `${path}[${i}]`))
    }
    return changes
  }
  if (typeof oldObj === 'object' && oldObj !== null && typeof newObj === 'object' && newObj !== null) {
    const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])
    for (const k of keys) {
      changes.push(...diffStrings(oldObj[k], newObj[k], path ? `${path}.${k}` : k))
    }
    return changes
  }
  return changes
}

function escapeForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Stable hash of block content — used by sync-outline to detect moved blocks (same content, different position). */
function hashContent(kind: string, content: any): string {
  return `${kind}:${JSON.stringify(content)}`
}
