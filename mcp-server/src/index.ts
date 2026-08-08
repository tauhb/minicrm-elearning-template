#!/usr/bin/env node
/**
 * @rainmaker/agentcrm-mcp — MCP server for AgentCRM
 *
 * Exposes CRM operations as MCP tools that Claude Code / Codex / Cursor /
 * any MCP-compatible AI agent can invoke.
 *
 * Config via env:
 *   AGENTCRM_URL     — base URL of the CRM (e.g. https://portal.foo.com)
 *   AGENTCRM_TOKEN   — raw API token (acrm_...) created in Settings → API Tokens
 *   MCP_TRANSPORT    — 'stdio' (default) or 'sse'
 *   MCP_SSE_PORT     — port for SSE transport (default 8790)
 *
 * Startup verifies the token by POSTing to /api/api-tokens/verify.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { makeClient, q, CRMError } from './callCRM.js'

const VERSION = '0.1.0'
const AGENTCRM_URL = process.env.AGENTCRM_URL || ''
const AGENTCRM_TOKEN = process.env.AGENTCRM_TOKEN || ''
const TRANSPORT = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase()

function log(...args: unknown[]) {
  // MCP stdio uses stdout for protocol frames — always log to stderr.
  console.error('[agentcrm-mcp]', ...args)
}

function bail(msg: string): never {
  log('FATAL:', msg)
  process.exit(1)
}

async function verifyToken(): Promise<{ owner_email: string | null; scopes: string[] }> {
  const res = await fetch(`${AGENTCRM_URL.replace(/\/+$/, '')}/api/api-tokens/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: AGENTCRM_TOKEN }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Verify failed: HTTP ${res.status} — ${body.slice(0, 200)}`)
  }
  const json = await res.json() as { valid: boolean; owner_email: string | null; scopes: string[]; reason?: string }
  if (!json.valid) throw new Error(`Token invalid: ${json.reason || 'unknown reason'}`)
  return { owner_email: json.owner_email, scopes: json.scopes || [] }
}

function textResult(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text' as const, text }] }
}

function errorResult(err: unknown) {
  const msg = err instanceof CRMError
    ? `HTTP ${err.status}: ${err.message}`
    : err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text' as const, text: `ERROR: ${msg}` }], isError: true }
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  if (!AGENTCRM_URL) {
    bail([
      'AGENTCRM_URL is not set.',
      '',
      'Configure your MCP client with:',
      '  env.AGENTCRM_URL   = "https://portal.yourdomain.com"',
      '  env.AGENTCRM_TOKEN = "acrm_..."   (get from Settings → API Tokens)',
      '',
      'See README.md for setup instructions.',
    ].join('\n'))
  }
  if (!AGENTCRM_TOKEN) {
    bail([
      'AGENTCRM_TOKEN is not set.',
      '',
      `1. Open ${AGENTCRM_URL}/#/admin (Settings → API Tokens)`,
      '2. Create a new token with the scopes your agent needs',
      '3. Copy the raw token (shown once) and set AGENTCRM_TOKEN in your MCP config',
    ].join('\n'))
  }

  log(`v${VERSION} starting — connecting to ${AGENTCRM_URL}`)
  let tokenInfo: Awaited<ReturnType<typeof verifyToken>>
  try {
    tokenInfo = await verifyToken()
  } catch (err) {
    bail(`Token verification failed: ${(err as Error).message}`)
  }
  log(`token OK · owner=${tokenInfo.owner_email || '(unknown)'} · scopes=${tokenInfo.scopes.join(',') || '(none)'}`)

  const crm = makeClient({ url: AGENTCRM_URL, token: AGENTCRM_TOKEN })
  const server = new McpServer({ name: '@rainmaker/agentcrm-mcp', version: VERSION })

  // ── LEADS ────────────────────────────────────────────────────────────
  server.tool(
    'crm.leads.list',
    'List leads with optional filters. Scope: leads.read.',
    {
      status: z.enum(['all', 'active', 'converted']).optional().default('all'),
      search: z.string().optional().describe('Search by name/email/phone'),
      limit:  z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ status, search, limit }) => {
      try {
        const res = await crm.get('/api/leads' + q({ status, search, limit }))
        return textResult(res)
      } catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.leads.get',
    'Get a single lead by ID (with care history + tags). Scope: leads.read.',
    { id: z.string().uuid() },
    async ({ id }) => {
      try { return textResult(await crm.get(`/api/leads?id=${encodeURIComponent(id)}`)) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.leads.create',
    'Create a new lead via the /api/capture-lead endpoint. Scope: leads.write.',
    {
      email: z.string().email(),
      name:  z.string().optional(),
      phone: z.string().optional(),
      source: z.string().optional().describe("e.g. 'agent_action', 'landing_page'"),
      tags:  z.array(z.string()).optional(),
      notes: z.string().optional(),
      utm_source:   z.string().optional(),
      utm_campaign: z.string().optional(),
    },
    async (input) => {
      try { return textResult(await crm.post('/api/capture-lead', input)) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.leads.update',
    'Update lead fields (name, phone, tags, notes, pipeline_stage_id, score). Scope: leads.write.',
    {
      id: z.string().uuid(),
      name: z.string().optional(),
      phone: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
      pipeline_stage_id: z.string().uuid().optional(),
      score: z.number().int().optional(),
    },
    async ({ id, ...fields }) => {
      try { return textResult(await crm.patch(`/api/leads?id=${encodeURIComponent(id)}`, fields)) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.leads.convert',
    'Convert a lead to a customer (creates auth user + enrolls if course_id given). Scope: leads.convert.',
    {
      lead_id:            z.string().uuid(),
      email:              z.string().email(),
      display_name:       z.string().optional(),
      enroll_course_id:   z.string().uuid().optional(),
      enroll_cohort:      z.string().optional(),
      grant_product_id:   z.string().uuid().optional(),
      amount:             z.number().nonnegative().optional(),
      email_mode:         z.enum(['magic_link', 'password']).optional().default('magic_link'),
    },
    async (input) => {
      try {
        const body = { ...input, convert_lead_id: input.lead_id }
        return textResult(await crm.post('/api/admin-create-customer', body))
      } catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.leads.tag',
    'Add tags to a lead (merges with existing). Scope: leads.write.',
    { id: z.string().uuid(), tags: z.array(z.string()).min(1) },
    async ({ id, tags }) => {
      try { return textResult(await crm.patch(`/api/leads?id=${encodeURIComponent(id)}&action=tag`, { tags })) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── CUSTOMERS ────────────────────────────────────────────────────────
  server.tool(
    'crm.customers.list',
    'List customers (students / paying users). Scope: customers.read.',
    {
      search: z.string().optional(),
      role:   z.enum(['all', 'student', 'affiliate', 'admin']).optional().default('all'),
      limit:  z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ search, role, limit }) => {
      try { return textResult(await crm.get('/api/customers' + q({ search, role, limit }))) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.customers.get',
    'Get a customer with enrollments + payments + care history. Scope: customers.read.',
    { id: z.string().uuid() },
    async ({ id }) => {
      try { return textResult(await crm.get(`/api/customers?id=${encodeURIComponent(id)}`)) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.customers.deactivate',
    'Deactivate a customer (soft delete — payment_status=inactive). Scope: customers.deactivate.',
    { id: z.string().uuid(), reason: z.string().optional() },
    async ({ id, reason }) => {
      try { return textResult(await crm.post(`/api/customers?id=${encodeURIComponent(id)}&action=deactivate`, { reason })) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.customers.resend_magic_link',
    'Resend the magic-link login email to a customer. Scope: customers.write.',
    { id: z.string().uuid() },
    async ({ id }) => {
      try { return textResult(await crm.post(`/api/team?action=resend-magic-link&id=${encodeURIComponent(id)}`, {})) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── TASKS ────────────────────────────────────────────────────────────
  server.tool(
    'crm.tasks.list',
    'List tasks (kind=task). Filter by status/assignee/due date. Scope: tasks.read.',
    {
      status:      z.enum(['all', 'todo', 'in_progress', 'done', 'cancelled']).optional().default('todo'),
      assigned_to: z.string().uuid().optional(),
      overdue:     z.boolean().optional(),
      limit:       z.number().int().min(1).max(200).optional().default(50),
    },
    async (input) => {
      try { return textResult(await crm.get('/api/tasks' + q(input))) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.tasks.create',
    'Create a task attached to a lead OR customer. Scope: tasks.write.',
    {
      title:       z.string().min(1),
      description: z.string().optional(),
      due_at:      z.string().datetime().optional().describe('ISO 8601'),
      priority:    z.enum(['low', 'medium', 'high']).optional().default('medium'),
      assigned_to: z.string().uuid().optional(),
      lead_id:     z.string().uuid().optional(),
      customer_id: z.string().uuid().optional(),
    },
    async (input) => {
      try { return textResult(await crm.post('/api/tasks', input)) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.tasks.complete',
    'Mark a task as done. Scope: tasks.complete.',
    { id: z.string().uuid(), note: z.string().optional() },
    async ({ id, note }) => {
      try { return textResult(await crm.patch(`/api/tasks?id=${encodeURIComponent(id)}`, { status: 'done', completion_note: note })) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.tasks.cancel',
    'Cancel a task. Scope: tasks.write.',
    { id: z.string().uuid(), reason: z.string().optional() },
    async ({ id, reason }) => {
      try { return textResult(await crm.patch(`/api/tasks?id=${encodeURIComponent(id)}`, { status: 'cancelled', completion_note: reason })) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── ORDERS ───────────────────────────────────────────────────────────
  server.tool(
    'crm.orders.list_pending',
    'List funnel_orders that are still pending payment. Useful for chasing stalled checkouts. Scope: orders.read.',
    {
      older_than_minutes: z.number().int().min(0).optional().default(20),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ older_than_minutes, limit }) => {
      try { return textResult(await crm.get('/api/orders' + q({ status: 'pending', older_than_minutes, limit }))) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.orders.refund',
    'Mark a payment as refunded (bookkeeping only — actual refund must be issued in the payment provider). Scope: orders.refund.',
    { id: z.string().uuid(), reason: z.string().optional() },
    async ({ id, reason }) => {
      try { return textResult(await crm.post(`/api/orders?id=${encodeURIComponent(id)}&action=refund`, { reason })) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── FUNNELS ──────────────────────────────────────────────────────────
  server.tool(
    'crm.funnels.list',
    'List all funnels (sales pages, lead capture, etc.). Scope: funnels.read.',
    { active_only: z.boolean().optional().default(true) },
    async ({ active_only }) => {
      try { return textResult(await crm.get('/api/admin/funnels' + q({ active_only }))) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.funnels.get',
    'Get funnel details by ID or slug. Scope: funnels.read.',
    { id: z.string().optional(), slug: z.string().optional() },
    async ({ id, slug }) => {
      try { return textResult(await crm.get('/api/admin/funnels' + q({ id, slug }))) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.funnels.publish',
    'Toggle a funnel active/inactive (publish/unpublish). Scope: funnels.publish.',
    { id: z.string(), is_active: z.boolean() },
    async ({ id, is_active }) => {
      try { return textResult(await crm.patch('/api/admin/funnels', { id, is_active })) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── CHAT ─────────────────────────────────────────────────────────────
  server.tool(
    'crm.chat.list_conversations',
    'List chat conversations (customer support inbox). Scope: chat.read.',
    {
      status: z.enum(['all', 'open', 'closed']).optional().default('open'),
      limit:  z.number().int().min(1).max(200).optional().default(50),
    },
    async (input) => {
      try { return textResult(await crm.get('/api/chat/conversations' + q(input))) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.chat.send_reply',
    'Send a reply message to a conversation. Scope: chat.reply.',
    {
      conversation_id: z.string().uuid(),
      body:            z.string().min(1),
      internal_note:   z.boolean().optional().default(false),
    },
    async (input) => {
      try { return textResult(await crm.post('/api/chat/messages', input)) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── KNOWLEDGE (Sprint B — endpoints may not exist yet) ───────────────
  server.tool(
    'crm.knowledge.list',
    'List knowledge base collections. Scope: knowledge.read. (Requires Sprint B knowledge base to be deployed.)',
    {},
    async () => {
      try { return textResult(await crm.get('/api/knowledge/collections')) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.knowledge.retrieve',
    'Query a knowledge collection with semantic search. Scope: knowledge.read.',
    {
      collection: z.string().describe('slug — e.g. "khoa-ai"'),
      query:      z.string().min(1),
      top_k:      z.number().int().min(1).max(20).optional().default(5),
    },
    async (input) => {
      try { return textResult(await crm.post('/api/knowledge/retrieve', input)) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.knowledge.add_entry',
    'Add a text entry to a knowledge collection. Scope: knowledge.write.',
    {
      collection: z.string(),
      title:      z.string(),
      content:    z.string().min(1),
      tags:       z.array(z.string()).optional(),
    },
    async (input) => {
      try { return textResult(await crm.post('/api/knowledge/entries', input)) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.knowledge.distill',
    'Ask the CRM AI to summarise / distill a knowledge collection into a short brief. Scope: knowledge.read.',
    { collection: z.string(), prompt: z.string().optional() },
    async (input) => {
      try { return textResult(await crm.post('/api/knowledge/distill', input)) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── TEAM ─────────────────────────────────────────────────────────────
  server.tool(
    'crm.team.list',
    'List team members (owner/admin/sales/support). Scope: team.read.',
    {},
    async () => {
      try { return textResult(await crm.get('/api/team')) }
      catch (err) { return errorResult(err) }
    },
  )

  server.tool(
    'crm.team.invite',
    'Invite a new team member (creates auth user + sends magic link). Scope: team.invite.',
    {
      email:        z.string().email(),
      display_name: z.string().optional(),
      role:         z.enum(['admin', 'sales', 'support']),
    },
    async (input) => {
      try { return textResult(await crm.post('/api/team?action=invite', input)) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── ANALYTICS ────────────────────────────────────────────────────────
  server.tool(
    'crm.analytics.summary',
    'High-level dashboard summary: new leads, conversions, revenue, active tasks. Scope: analytics.read.',
    {
      days: z.number().int().min(1).max(365).optional().default(30),
    },
    async ({ days }) => {
      try { return textResult(await crm.get('/api/analytics/summary' + q({ days }))) }
      catch (err) { return errorResult(err) }
    },
  )

  // ── Transport ────────────────────────────────────────────────────────
  if (TRANSPORT === 'stdio') {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    log('connected via stdio — ready')
  } else if (TRANSPORT === 'sse') {
    // Lazy-load SSE — not everyone will use it.
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js')
    const http = await import('node:http')
    const port = Number(process.env.MCP_SSE_PORT) || 8790
    const transports = new Map<string, InstanceType<typeof SSEServerTransport>>()
    const httpServer = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/sse') {
        const t = new SSEServerTransport('/messages', res)
        transports.set(t.sessionId, t)
        res.on('close', () => transports.delete(t.sessionId))
        await server.connect(t)
      } else if (req.method === 'POST' && req.url?.startsWith('/messages')) {
        const url = new URL(req.url, 'http://localhost')
        const sid = url.searchParams.get('sessionId') || ''
        const t = transports.get(sid)
        if (!t) { res.writeHead(404).end(); return }
        await t.handlePostMessage(req, res)
      } else {
        res.writeHead(404).end()
      }
    })
    httpServer.listen(port, () => log(`SSE transport listening on :${port}`))
  } else {
    bail(`Unknown MCP_TRANSPORT: ${TRANSPORT} (expected 'stdio' or 'sse')`)
  }
}

main().catch(err => {
  log('fatal:', err?.stack || err)
  process.exit(1)
})
