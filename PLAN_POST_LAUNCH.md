# Post-Launch Plan — 4 initiatives
**Date**: 2026-08-08
**Scope**: Multi-provider AI, Knowledge Base (Karpathy distillation), Zalo/Telegram channels, MCP server

---

## 🗺️ Landscape audit — what we already have

| Capability | CRM (giftbox) | support-agent (repo neighbor) |
|-----------|--------------|-------------------------------|
| **AI provider abstraction** | Only OpenAI Codex OAuth. Single-provider `ai-router.ts` | ✅ Vercel AI SDK — google/openai/anthropic + `openai_compatible` generic (works cho Kimi/Grok/DeepSeek/Together/Groq/OpenRouter/Mistral) |
| **RAG / Knowledge base** | Không có | ✅ Full pipeline: chunker + embedder + vector-store + retriever + wiki-loader + sync. Markdown-based. Per-product wikis. |
| **Knowledge distillation** | Không có | ✅ Skills: `extract-knowledge`, `write-kb-entry`, `answer-question`, `analyze-image`, `classify-thread` |
| **Chat channels** | Website widget only (Wave 1) | ✅ Telegram (grammY) + Zalo (zca-js embedded) + Facebook + Email |
| **Bot auto-reply** | Không có | ✅ `answer-question` skill với RAG context, per-group product routing |

**Key insight**: **Support-agent đã build 80% những gì user muốn.** Vấn đề là 2 systems tách biệt. Plan phải quyết định: reinvent trong CRM, hay reuse support-agent qua API, hay merge.

**Kiến trúc đề xuất (chọn cho cả 4 initiatives)**:
```
┌─────────────────────┐    HTTP API    ┌──────────────────────┐
│  CRM (giftbox)      │◄──────────────►│  support-agent       │
│  - Chat inbox UI    │                │  - LLM factory       │
│  - Task/Lead/Order  │                │  - RAG pipeline      │
│  - Website widget   │                │  - Zalo/TG channels  │
│  - MCP server (mới) │                │  - Bot skills        │
└─────────────────────┘                └──────────────────────┘
         │                                       │
         │        Bridge webhook events          │
         └───────────────────────────────────────┘
```

Support-agent làm "AI infrastructure" service, CRM là "business system". Bridge qua webhook cho Zalo/Telegram inbound → CRM. CRM outbound → support-agent gọi API bot.

---

## 🎯 Initiative 1 — Multi-provider AI (Groq / OpenRouter / Kimi / Qwen / DeepSeek)

### Why now
Cần trước cho Initiative 2 (RAG cần embedding + generation LLM) và Initiative 4 (MCP có thể dùng model rẻ hơn).

### Approach
**Copy pattern từ support-agent** (`src/llm/factory.ts`) — tất cả providers user nêu **đều OpenAI-compatible REST**. Chỉ khác `base_url` + `api_key_env`.

### Plan

**Phase 1 — Provider registry (2h)**:
- Migration 019: extend `provider_credentials.provider` CHECK để accept: `openai-codex | openai | anthropic | google | groq | openrouter | kimi | qwen | deepseek | openai-compatible`
- Rewrite `services/ai-router.ts`:
  - Add adapter map per provider (base_url + default model + streaming quirks)
  - Preserve existing openai-codex OAuth flow
  - New generic `callOpenAICompat(cred, request)` for the 5 new providers
  - Default models per provider (settable per-funnel/step via existing `body.model`)

**Phase 2 — Settings UI (2h)**:
- New sub-tab "AI Providers" trong `AISettingsView.tsx`:
  - Provider list card mỗi provider: status (connected/not) + "Kết nối" button
  - Kết nối = modal input API key → POST `/api/oauth/{provider}/connect` (thực ra API key thẳng, không OAuth)
  - Test button: gọi `/api/ai/test?provider=X` → 1 completion ping → success/fail
  - Per-provider model dropdown (fetched from `/api/ai/models?provider=X`)

**Phase 3 — Model picker cascading (1h)**:
- Funnel step "Content generation" giờ có 2 dropdowns: Provider + Model
- Default = openai-codex (giữ backward compat)
- Override tại BUSINESS.md hoặc per-step

**Phase 4 — Testing (1h)**:
- Test 1 funnel generation với mỗi provider
- Verify streaming works (Groq / DeepSeek chunk format)

**Effort: ~6h total**

### Trade-off decisions
- **KHÔNG dùng Vercel AI SDK** — thêm dep, mà cả 6 providers cùng REST format, tự viết adapter 200 dòng
- **KHÔNG hỗ trợ Google/Anthropic native** — dùng qua OpenRouter cho đủ tất cả
- **API key lưu encrypted** trong `provider_credentials` (đã có mechanism từ Codex flow)

### Provider config sẵn
| Provider | base_url | Models mẫu | Note |
|----------|----------|-----------|------|
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`, `moonshotai/kimi-k2-instruct` | Nhanh nhất, free tier ổn |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-opus-5`, `openai/gpt-5.6`, `google/gemini-2.5-pro` | All-in-one aggregator |
| Kimi (Moonshot) | `https://api.moonshot.cn/v1` | `moonshot-v1-32k`, `moonshot-v1-128k` | 128k context, giá rẻ |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-max`, `qwen-plus` | VN/CN language mạnh |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` | Reasoning + code, cực rẻ |

---

## 🎯 Initiative 2 — Kho kiến thức (Karpathy-style distillation) + auto-reply bot

### Karpathy philosophy (recap)
Raw content (chats, docs, ghi âm) → **chưng cất thành notes có cấu trúc** (kebab-case, title + summary + content) → embed vào vector store → RAG answer.

Không phải "dump raw text vào RAG" như 90% RAG project. Mà **distill trước** — vì tài liệu chưng cất cho tín hiệu cao hơn nhiều.

### Architecture

**Data model** (migration 020):
```sql
CREATE TABLE knowledge_bases (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,             -- "Khoá AI 30-day KB"
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  embedding_provider TEXT,        -- e.g. 'openai' | 'gemini' | 'local'
  embedding_model TEXT,
  created_at TIMESTAMPTZ
);

CREATE TABLE kb_entries (
  id UUID PRIMARY KEY,
  kb_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  category TEXT,                  -- kebab-case, from Karpathy pattern
  filename TEXT NOT NULL,         -- kebab-case.md
  title TEXT NOT NULL,
  summary TEXT NOT NULL,          -- 1-2 sentences
  content TEXT NOT NULL,          -- full distilled body
  source_kind TEXT,               -- 'manual' | 'distilled' | 'imported'
  source_ref JSONB,               -- ref to raw source (chat_conversation_id, upload_id, url)
  tags TEXT[],
  created_by UUID REFERENCES customers(id),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(kb_id, filename)
);

CREATE TABLE kb_chunks (
  id UUID PRIMARY KEY,
  entry_id UUID REFERENCES kb_entries(id) ON DELETE CASCADE,
  chunk_index INT,
  text TEXT NOT NULL,
  embedding vector(1536),         -- pgvector; adjust dim per model
  metadata JSONB
);
CREATE INDEX idx_kb_chunks_embedding ON kb_chunks USING ivfflat (embedding vector_cosine_ops);

-- Product ↔ KB many-to-many
CREATE TABLE product_knowledge_bases (
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  kb_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  priority INT DEFAULT 0,
  PRIMARY KEY (product_id, kb_id)
);
```

**Enable pgvector**: `CREATE EXTENSION IF NOT EXISTS vector;` (Supabase supports it).

### Plan

**Phase 1 — KB CRUD + Entry management (4h)**:
- Sidebar item mới "Kho kiến thức" (`/admin/knowledge`)
- KB list view: create/rename/delete KB + assign to products (multi-select)
- KB detail view: entry list (table) + editor (markdown) + tags
- New API `api/knowledge/{index.ts, entries/[id].ts, embed.ts}`

**Phase 2 — Manual authoring (2h)**:
- "New entry" modal: title / summary / content (markdown editor) / tags / category
- Save → auto-chunk (500 tokens each, 100 overlap) → embed → store in kb_chunks
- Uses Initiative 1's provider abstraction (embedding provider chọn OpenAI hoặc Gemini)

**Phase 3 — Distillation from raw sources (6h)** — **quan trọng nhất**:
- "Import & distill" workflow — user upload / paste raw content:
  - Text/markdown paste
  - PDF upload (dùng `pdf-parse`)
  - URL scrape (dùng `@mozilla/readability`)
  - Chat conversation export (chọn conversation → distill toàn bộ)
  - Ghi âm/video → transcript first (dùng Whisper API qua Initiative 1)
- Distill agent: prompt LLM extract knowledge → produce list of `{filename, category, title, summary, content}` JSON entries (like support-agent's KBEntrySchema)
- User review + edit + accept entries batch
- Accepted → auto-chunk + embed + store

**Phase 4 — RAG retriever + chat integration (4h)**:
- New service `services/rag.ts`:
  - `retrieve(kb_id, query, top_k=5)` → cosine similarity → top chunks
  - `retrieveForProduct(product_id, query)` → union across product's KBs
- Chat widget mode "AI-powered" toggle per inbox:
  - Visitor sends message → server look up conversation → find product context (via funnel or inbox binding) → RAG retrieve → LLM generate reply → send back
  - Agent sees `[Bot]` prefixed reply, can override anytime
- **Fallback path**: nếu confidence < threshold → route to human, ping notification

**Phase 5 — Auto-reply for external channels (link to Initiative 3)**:
- Zalo/Telegram inbound → RAG answer flow same as widget
- Per-channel toggle (per inbox_id or per group)

**Effort: ~16h total**

### Trade-off decisions
- **pgvector trong Supabase** thay vì Pinecone/Weaviate — 1 dependency ít hơn, latency thấp hơn
- **Chunk 500 tokens, overlap 100** — sweet spot cho Vietnamese content
- **Embedding provider tách khỏi generation** — có thể dùng Gemini embed (rẻ) + Claude generate (chất lượng)
- **Distillation batch review UX** — user check trước khi lưu, tránh AI hallucinate vào KB
- **NOT reuse support-agent RAG code** — schema khác (file-based vs DB), CRM cần multi-tenant per-workspace future

---

## 🎯 Initiative 3 — Zalo cá nhân + Telegram → CRM Chat

### Recommendation: **Bridge architecture (Path A)**
Deploy support-agent song song. Bridge qua webhook events. Lý do:
- Support-agent đã production-ready cho zca-js + grammY
- Giftbox students không phải ai cũng cần Zalo/Telegram — bridge = optional deploy
- Session-persistent connections (Zalo cần login qua QR + duy trì cookie) không hợp Vercel serverless
- Support-agent chạy trên Railway/Fly.io/VPS

### Data model
```sql
-- Extend chat_inboxes
ALTER TABLE chat_inboxes ADD COLUMN channel_type TEXT DEFAULT 'website'
  CHECK (channel_type IN ('website', 'zalo', 'telegram', 'facebook', 'email'));
ALTER TABLE chat_inboxes ADD COLUMN external_id TEXT;  -- Telegram bot handle, Zalo group id, etc.
ALTER TABLE chat_inboxes ADD COLUMN bridge_config JSONB;  -- bridge webhook URL, secret

-- Extend chat_conversations
ALTER TABLE chat_conversations ADD COLUMN external_thread_id TEXT;  -- Zalo threadId, Telegram chatId
ALTER TABLE chat_conversations ADD COLUMN channel_type TEXT;
CREATE INDEX idx_chat_conv_external ON chat_conversations(external_thread_id, channel_type);
```

### Plan

**Phase 1 — Bridge protocol design (2h)**:
- Doc bridge contract:
  - **Inbound**: support-agent POST `/api/chat/inbound` with `{channel, external_thread_id, from: {name, id, phone?, email?}, message: {content, attachments?}, timestamp}`
  - **Outbound**: CRM POST `{support-agent}/api/send` with `{channel, external_thread_id, message}` when agent replies
  - **Auth**: HMAC signature với shared `BRIDGE_SECRET`
- Configure in Settings: bridge URL + secret

**Phase 2 — Inbound webhook (3h)**:
- New API `api/chat/inbound/index.ts`:
  - Verify HMAC
  - Match `channel_type` + `external_id` → find `chat_inbox`
  - Find or create `chat_conversation` by `(inbox_id, external_thread_id)`
  - Auto-resolve/create contact by email/phone (leads-first policy)
  - Insert `chat_message` (sender_type='visitor')
  - Realtime broadcast to admin
- If AI-powered toggle on → RAG reply flow (Initiative 2 integration)

**Phase 3 — Outbound sender (2h)**:
- When agent replies in ChatView + conversation.channel_type != 'website':
  - After insert message in DB, POST to bridge outbound endpoint
  - Handle failure (retry with exponential backoff, mark message as `delivery_failed`)

**Phase 4 — Setup UX (2h)**:
- Chat > New inbox modal: pick channel type
- For Telegram: guide "Chat @BotFather → get token → paste here". Portal generates bridge webhook URL for student to config trong support-agent
- For Zalo: guide "cài support-agent → login qua QR → set bridge callback vào portal URL"

**Phase 5 — Support-agent side (3h)**:
- Add outbound bridge to `apps/support-agent/src/channels/*` — khi CRM POST /send, gửi qua zca-js/grammY
- Config file `bridge.yaml` per instance: `crm_url`, `crm_secret`

**Effort: ~12h total**

### Trade-off decisions
- **HMAC over mTLS** — simpler for students, still secure
- **Không reuse existing zalo-group-store** — CRM's chat_inboxes replaces it (multi-tenant future)
- **Session persist trong support-agent** — CRM stateless về bridge
- **Retry outbound 3x + dead-letter** — Zalo hay flaky

---

## 🎯 Initiative 4 — MCP server để control CRM từ Claude Code / Codex

### What is MCP
Model Context Protocol = JSON-RPC-based protocol từ Anthropic để LLM gọi tools trên local machine. Claude Code + Codex đều support MCP servers qua `~/.claude/config.toml`.

### Value cho user
Dev anh gõ trong Claude Code:
> "Tạo task follow-up ngày mai cho lead có email x@y.com về khoá 30-day"

→ Claude call `crm.tasks.create` MCP tool → task hiện ngay trên CRM.

Hoặc:
> "List tất cả funnel_orders pending quá 20 phút"

→ Claude call `crm.orders.list_pending` → JSON → summarize.

### Plan

**Phase 1 — Bootstrap MCP server (3h)**:
- New service directory `apps/customer-portal-giftbox/mcp-server/`
  - `package.json` với `@modelcontextprotocol/sdk`
  - `index.ts` → stdio transport (default) + optional SSE
  - Config đọc `.env.local` để lấy Supabase service role key
- Manifest: server name = "agentcrm", version, tools list

**Phase 2 — Tool schema (5h)**:
- Auto-generate tool declarations từ existing API endpoints:
  - `crm.leads.list` / `create` / `update` / `convert`
  - `crm.customers.list` / `get` / `resend-magic-link` / `deactivate`
  - `crm.tasks.list` / `create` / `complete`
  - `crm.orders.list_pending` / `refund`
  - `crm.funnels.list` / `publish` / `preview`
  - `crm.chat.list_conversations` / `send_reply`
  - `crm.knowledge.query` (Initiative 2 integration)
  - `crm.team.invite` / `change-role`
  - `crm.analytics.dashboard_summary`
- Each tool = zod schema for input + validation + service role Supabase call
- ~20-25 tools tổng

**Phase 3 — Installation UX (2h)**:
- README `mcp-server/README.md`: install steps
- Optional npm publish: `@rainmaker/agentcrm-mcp` — user chỉ cần `claude mcp add agentcrm npx @rainmaker/agentcrm-mcp`
- Config file cho `.claude/config.toml` snippet

**Phase 4 — Auth model (2h)**:
- **Local mode** (dev): service role key trong `.env` — full access
- **Remote mode** (production): user tạo Personal Access Token trong Settings > API Tokens (mới) → MCP server uses token → RLS-scoped queries → chỉ thấy data thuộc workspace
- Migration 021 cho `api_tokens` table

**Phase 5 — Testing + docs (2h)**:
- Test 5 workflows từ Claude Code
- Video demo 3-min

**Effort: ~14h total**

### Trade-off decisions
- **stdio transport mặc định** — chạy local, không cần expose HTTP
- **SSE optional** — cho remote/collaborative Claude sessions
- **Zod validation on every tool** — LLM sẽ gọi sai schema, tool phải reject rõ ràng
- **Service role trong local mode** — simple, chấp nhận trust boundary = local dev machine
- **Không hỗ trợ streaming responses** — MCP spec chưa mature ở phần này

---

## 📊 Dependencies + Recommended sequence

```
Initiative 1 (Multi-provider)  ────┬──►  Initiative 2 (KB + RAG) ────►  Initiative 3 (channels auto-reply)
                                    │
                                    └──►  Initiative 4 (MCP) can start anytime
```

**Recommended order**:

| Sprint | Duration | Deliverable |
|--------|----------|-------------|
| **Sprint A** (1 tuần) | Init 1 | Multi-provider AI + Settings UI |
| **Sprint B** (2 tuần) | Init 2 phase 1-4 | Knowledge Base CRUD + Manual authoring + Distillation + RAG retriever |
| **Sprint C** (1.5 tuần) | Init 3 phase 1-5 | Zalo + Telegram bridge |
| **Sprint D** (0.5 tuần) | Init 2 phase 5 | Auto-reply bot for widget + external channels |
| **Sprint E** (1.5 tuần) | Init 4 | MCP server + tools + docs |

**Total**: ~48h dev work spread over ~6-8 tuần part-time.

**Parallel possible**: Init 4 (MCP) không depend Init 1-3 — có thể chạy song song bất kỳ sprint nào bằng subagent.

---

## ❓ 6 quyết định cần anh confirm trước khi start

**Q1. Multi-provider — có launch cho học viên tự cài API key không?**
- **A**: Yes, cho phép self-serve — cần Settings UI đầy đủ (Sprint A đủ)
- **B**: Chỉ owner set — chỉ cần .env config (Sprint A rút gọn 3h)

**Q2. Knowledge base — pgvector hay external (Pinecone/Weaviate)?**
- **A**: pgvector trong Supabase (em recommend — 1 dep ít hơn)
- **B**: Pinecone (nhanh hơn khi scale, nhưng thêm 20-100$/mo)

**Q3. Distillation UX — batch review hay auto-accept?**
- **A**: Batch review — user check + edit trước khi lưu (em recommend — tránh hallucinate)
- **B**: Auto-accept + user delete sai sau (nhanh hơn nhưng nhiễu KB)

**Q4. Zalo/Telegram — bridge (support-agent riêng) hay embed vào CRM?**
- **A**: Bridge với support-agent (em recommend — support-agent đã ready)
- **B**: Embed zca-js/grammY vào CRM (single deploy nhưng CRM nặng)
- **C**: Bridge + document rõ nếu student không dùng Zalo/TG thì skip support-agent

**Q5. MCP — publish npm package hay chỉ local repo?**
- **A**: Publish `@rainmaker/agentcrm-mcp` npm (dễ install)
- **B**: Chỉ local — student `cd mcp-server && node index.ts`

**Q6. MCP auth model**:
- **A**: Local mode only cho MVP (service role)
- **B**: Full token-based ngay từ đầu (an toàn hơn nhưng thêm 4h)

---

## 🚀 Nếu anh OK plan này em bắt đầu ngay

Em recommend order:
1. **Sprint A ngay** (Init 1 — multi-provider, unlocks 2+3+4)
2. **Sprint B** (Init 2 — RAG, longest sprint)
3. **Sprint C + D song song** (channels + auto-reply)
4. **Sprint E** cuối (MCP — foundation stable nhất mới build tool schema)

Anh trả lời 6 câu Q, em code.
