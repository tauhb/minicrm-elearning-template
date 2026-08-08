# @rainmaker/agentcrm-mcp

Control **AgentCRM** from Claude Code, Codex, Cursor, or any MCP-compatible AI agent.

Ask your AI in natural language:

- *"List every funnel_order that has been pending for more than 20 minutes and DM the buyers."*
- *"Create a follow-up task tomorrow for the lead with email `x@y.com` about the 30-day course."*
- *"Query the `khoa-ai` knowledge base for 'refund policy' and summarise in 3 bullets."*

Under the hood the agent calls MCP tools (`crm.leads.list`, `crm.tasks.create`, `crm.knowledge.retrieve`, …) that hit your CRM's authenticated HTTP API.

## Install

```bash
npm install -g @rainmaker/agentcrm-mcp
```

The binary `agentcrm-mcp` will be on your PATH.

## Get an API token

1. Open your AgentCRM: **Settings → API Tokens → Tạo token**
2. Give it a name (e.g. `Claude Code — laptop`), pick the scopes your agent needs, and click **Tạo token**
3. **Copy the raw token immediately** — it is shown only once and looks like `acrm_1234abcd...`
4. Note your CRM base URL, e.g. `https://portal.yourdomain.com`

### Canonical scopes

| Domain     | Scopes                                                        |
|------------|---------------------------------------------------------------|
| Leads      | `leads.read`, `leads.write`, `leads.convert`                  |
| Customers  | `customers.read`, `customers.write`, `customers.deactivate`   |
| Tasks      | `tasks.read`, `tasks.write`, `tasks.complete`                 |
| Orders     | `orders.read`, `orders.refund`                                |
| Funnels    | `funnels.read`, `funnels.publish`                             |
| Chat       | `chat.read`, `chat.reply`                                     |
| Knowledge  | `knowledge.read`, `knowledge.write`                           |
| Team       | `team.read`, `team.invite`                                    |
| Analytics  | `analytics.read`                                              |
| Wildcard   | `*` — full access, owner-only                                 |

## Configure Claude Code

Add to `~/.claude/config.toml`:

```toml
[[mcpServers]]
name = "agentcrm"
command = "agentcrm-mcp"
env.AGENTCRM_URL   = "https://portal.yourdomain.com"
env.AGENTCRM_TOKEN = "acrm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Restart Claude Code. The tools will show up under the `agentcrm` server.

## Configure Codex (ChatGPT desktop / CLI)

Codex uses `~/.codex/config.toml` with the same MCP schema:

```toml
[mcp_servers.agentcrm]
command = "agentcrm-mcp"
env = { AGENTCRM_URL = "https://portal.yourdomain.com", AGENTCRM_TOKEN = "acrm_..." }
```

## Configure Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agentcrm": {
      "command": "agentcrm-mcp",
      "env": {
        "AGENTCRM_URL":   "https://portal.yourdomain.com",
        "AGENTCRM_TOKEN": "acrm_..."
      }
    }
  }
}
```

## Configure any other MCP client

The default transport is **stdio**. Set `MCP_TRANSPORT=sse` and `MCP_SSE_PORT` (default 8790) to switch to Server-Sent Events instead.

## Available tools

All tools are prefixed `crm.` and mirror the API — each declares its required scope in the tool description so the AI can request the right token.

### Leads
- `crm.leads.list` — list with filters (status, search)
- `crm.leads.get` — fetch one lead with care history
- `crm.leads.create` — capture a new lead
- `crm.leads.update` — patch name/phone/tags/notes/stage/score
- `crm.leads.convert` — promote lead → customer (auth user + enrollment)
- `crm.leads.tag` — merge additional tags

### Customers
- `crm.customers.list`
- `crm.customers.get`
- `crm.customers.deactivate`
- `crm.customers.resend_magic_link`

### Tasks
- `crm.tasks.list` — filter by status / assignee / overdue
- `crm.tasks.create` — attach to lead or customer
- `crm.tasks.complete`
- `crm.tasks.cancel`

### Orders
- `crm.orders.list_pending` — chase stalled checkouts
- `crm.orders.refund` — bookkeeping only

### Funnels
- `crm.funnels.list`
- `crm.funnels.get` — by id or slug
- `crm.funnels.publish` — toggle active

### Chat
- `crm.chat.list_conversations`
- `crm.chat.send_reply` — optionally internal note

### Knowledge (requires Sprint B knowledge base deployed)
- `crm.knowledge.list`
- `crm.knowledge.retrieve` — semantic search
- `crm.knowledge.add_entry`
- `crm.knowledge.distill` — AI summary

### Team
- `crm.team.list`
- `crm.team.invite`

### Analytics
- `crm.analytics.summary`

## Errors

- **HTTP 401** — token invalid or revoked. Create a new one and update `AGENTCRM_TOKEN`.
- **HTTP 403** — token is missing the required scope. Revoke + recreate with the right scopes, or grant `*` (owner only).
- **HTTP 5xx** — server error; GET calls automatically retry twice with backoff.

## Local development

```bash
git clone https://github.com/rainmaker/agentcrm-mcp
cd agentcrm-mcp
npm install
AGENTCRM_URL=http://localhost:3001 \
AGENTCRM_TOKEN=acrm_dev_token \
npm run dev
```

Then wire your local Claude Code to `command = "npm --prefix /path/to/agentcrm-mcp run dev"` while iterating.

## Publish (maintainers)

See [`publish-checklist.md`](./publish-checklist.md).

## License

MIT
