# Example prompts

Once `@rainmaker/agentcrm-mcp` is wired to your MCP client, try these prompts. The agent will pick the right tools automatically.

## 1. Chase stalled checkouts

> **You:** *"List every funnel_orders row that has been pending for more than 20 minutes, then draft a Zalo follow-up message I can paste per buyer."*

Tools invoked: `crm.orders.list_pending` → `crm.customers.get` (per row).

## 2. Follow-up task from a lead email

> **You:** *"Create a task for tomorrow 9AM to follow up with the lead whose email is `binh@example.com` about the 30-day AI Sprint. Assign it to me."*

Tools invoked: `crm.leads.list` (search=binh@example.com) → `crm.team.list` (to resolve "me") → `crm.tasks.create`.

## 3. Distil the refund policy from knowledge base

> **You:** *"Query the `khoa-ai` knowledge base for anything about the refund policy and summarise in 3 bullets I can paste into a chat reply."*

Tools invoked: `crm.knowledge.retrieve` (collection=khoa-ai, query="chính sách hoàn tiền") → optionally `crm.knowledge.distill`.

## 4. Convert a promising lead

> **You:** *"Take lead `f47ac10b-...`, convert them to a customer with course `Khoá K3` (id `a1b2c3...`), amount 1,997,000 VND, send magic link."*

Tools invoked: `crm.leads.get` → `crm.leads.convert`.

## 5. Weekly dashboard brief

> **You:** *"Give me a Vietnamese brief of the last 7 days: new leads, conversions, revenue, open tasks. Format as a Lark message."*

Tools invoked: `crm.analytics.summary` (days=7) → `crm.tasks.list` (status=todo).

## 6. Publish a funnel

> **You:** *"Publish the funnel with slug `sales-k4-launch`."*

Tools invoked: `crm.funnels.get` (slug) → `crm.funnels.publish`.

## 7. Reply to a support conversation

> **You:** *"There's a chat conversation from `linh@abc.com` about installation. Look up her enrollment, then reply with the correct install link and mark the conversation as replied."*

Tools invoked: `crm.chat.list_conversations` → `crm.customers.list` (search=linh) → `crm.chat.send_reply`.
