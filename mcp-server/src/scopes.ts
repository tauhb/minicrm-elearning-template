// Canonical MCP scopes — mirror of api/api-tokens/index.ts CANONICAL_SCOPES
// and components/admin/APITokensView.tsx SCOPE_GROUPS.  Keep in lockstep.

export const SCOPES = [
  'leads.read', 'leads.write', 'leads.convert',
  'customers.read', 'customers.write', 'customers.deactivate',
  'tasks.read', 'tasks.write', 'tasks.complete',
  'orders.read', 'orders.refund',
  'funnels.read', 'funnels.publish',
  'chat.read', 'chat.reply',
  'knowledge.read', 'knowledge.write',
  'team.read', 'team.invite',
  'analytics.read',
] as const

export type Scope = typeof SCOPES[number] | '*'

export function hasScope(granted: string[] | undefined, required: Scope): boolean {
  if (!granted || !Array.isArray(granted)) return false
  return granted.includes('*') || granted.includes(required)
}
