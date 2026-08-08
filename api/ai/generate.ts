// api/ai/generate.ts — Unified AI completion endpoint
// POST /api/ai/generate (admin only)
// Body: { provider, model?, systemPrompt?, userPrompt, maxTokens?, temperature? }
// Response: { text, model, provider, usage? }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { runCompletion, ProviderId } from '../../services/ai-router'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).json({})
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
  if (!['owner','admin'].includes(caller?.role || '')) return res.status(403).json({ error: 'Admin only' })

  const { provider = 'openai-codex', model, systemPrompt, userPrompt, maxTokens, temperature } = req.body || {}
  if (!userPrompt) return res.status(400).json({ error: 'userPrompt required' })

  try {
    const result = await runCompletion({
      provider: provider as ProviderId,
      model,
      systemPrompt,
      userPrompt,
      maxTokens,
      temperature,
    })
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
