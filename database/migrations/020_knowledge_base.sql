-- 020_knowledge_base.sql
-- Sprint B — Knowledge Base with pgvector for RAG (Karpathy-style distilled entries).
--
-- Design:
--   • Karpathy philosophy: raw content → LLM distill → structured entries (kebab-case
--     filename + title + summary + content) → chunk + embed → RAG.
--   • pgvector for embeddings (colocated with data, no external vector DB dep).
--   • Multi-KB per workspace; products can be linked to N KBs (via product_knowledge_bases).
--   • Chunk table separated from entries — one entry can produce many chunks with different
--     text slices, and we can re-embed by dropping chunks + regenerating without losing the source.

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── knowledge_bases ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  -- Which embedding provider was used to build kb_chunks. Changing this requires
  -- re-embedding all chunks (dim + model change would break similarity search).
  embedding_provider TEXT,               -- e.g. 'openai' | 'gemini' | 'kimi'
  embedding_model    TEXT,               -- e.g. 'text-embedding-3-small'
  embedding_dim      INT,                -- 1536, 768, 1024 depending on model
  created_by  UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── kb_entries: distilled knowledge units (one .md-like doc each) ──────────
CREATE TABLE IF NOT EXISTS kb_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_id       UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  category    TEXT,                                  -- kebab-case, optional
  filename    TEXT NOT NULL,                         -- kebab-case.md
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  content     TEXT NOT NULL,                         -- full distilled body (markdown)
  source_kind TEXT NOT NULL DEFAULT 'manual',        -- 'manual' | 'distilled' | 'imported'
  source_ref  JSONB,                                 -- e.g. {kind: 'chat_conversation', id: '...'} | {kind: 'url', url: '...'} | {kind: 'upload', filename: '...'}
  tags        TEXT[] DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,         -- soft-disable without deleting chunks
  created_by  UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(kb_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_kb_entries_kb    ON kb_entries(kb_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_kb_entries_tags  ON kb_entries USING GIN(tags);

-- ─── kb_chunks: chunked + embedded slices of entries ────────────────────────
-- NOTE: embedding vector column is created as vector(1536) below because Supabase's
-- IVFFlat index requires a fixed dim. If you swap to a model with different dim,
-- create a new KB (schema is per-KB) OR extend this migration to add a dim-suffixed
-- table (kb_chunks_768 etc). We standardise on 1536 for MVP (OpenAI text-embedding-3-small).
CREATE TABLE IF NOT EXISTS kb_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    UUID NOT NULL REFERENCES kb_entries(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  text        TEXT NOT NULL,
  embedding   vector(1536),
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entry_id, chunk_index)
);

-- IVFFlat cosine similarity index. Lists=100 fits up to ~100k chunks; increase for larger.
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding
  ON kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_entry ON kb_chunks(entry_id);

-- ─── product_knowledge_bases: many-to-many product ↔ KB ─────────────────────
CREATE TABLE IF NOT EXISTS product_knowledge_bases (
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  kb_id       UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  priority    INT NOT NULL DEFAULT 0,                 -- higher = queried first when multiple KBs match
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_id, kb_id)
);

CREATE INDEX IF NOT EXISTS idx_pkb_product ON product_knowledge_bases(product_id);
CREATE INDEX IF NOT EXISTS idx_pkb_kb      ON product_knowledge_bases(kb_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE knowledge_bases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_entries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chunks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_knowledge_bases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kb_admin_all" ON knowledge_bases;
CREATE POLICY "kb_admin_all" ON knowledge_bases FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('owner', 'admin', 'sales', 'support')));

DROP POLICY IF EXISTS "kb_entries_admin_all" ON kb_entries;
CREATE POLICY "kb_entries_admin_all" ON kb_entries FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('owner', 'admin', 'sales', 'support')));

DROP POLICY IF EXISTS "kb_chunks_admin_read" ON kb_chunks;
CREATE POLICY "kb_chunks_admin_read" ON kb_chunks FOR SELECT
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('owner', 'admin', 'sales', 'support')));

DROP POLICY IF EXISTS "pkb_admin_all" ON product_knowledge_bases;
CREATE POLICY "pkb_admin_all" ON product_knowledge_bases FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role IN ('owner', 'admin')));

-- ─── RPC: cosine similarity search ──────────────────────────────────────────
-- Returns top-K chunks for a KB (or across product's KBs). Called by RAG retriever.
CREATE OR REPLACE FUNCTION kb_search(
  p_kb_ids UUID[],
  p_query_embedding vector(1536),
  p_top_k INT DEFAULT 5,
  p_min_score REAL DEFAULT 0.0
)
RETURNS TABLE (
  chunk_id UUID,
  entry_id UUID,
  entry_title TEXT,
  entry_filename TEXT,
  chunk_text TEXT,
  score REAL
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id            AS chunk_id,
    e.id            AS entry_id,
    e.title         AS entry_title,
    e.filename      AS entry_filename,
    c.text          AS chunk_text,
    1 - (c.embedding <=> p_query_embedding) AS score
  FROM kb_chunks c
  JOIN kb_entries e ON e.id = c.entry_id
  WHERE e.kb_id = ANY(p_kb_ids)
    AND e.is_active = TRUE
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_min_score
  ORDER BY c.embedding <=> p_query_embedding ASC
  LIMIT p_top_k;
$$;

COMMENT ON TABLE knowledge_bases IS
  'Karpathy-style distilled knowledge repos. Multi-KB per workspace, link to products for RAG-driven auto-reply.';
COMMENT ON TABLE kb_entries IS
  'One distilled unit per row (title + summary + full content). Chunked into kb_chunks for retrieval.';
COMMENT ON TABLE kb_chunks IS
  'Embedded slices of entries. IVFFlat cosine index. Rebuild by DELETE + re-run embedder if you change model.';
COMMENT ON FUNCTION kb_search IS
  'Top-K cosine similarity search across one or more KBs. Called by services/rag.ts::retrieve().';
