-- 026_kb_variable_embedding_dim.sql
-- Allow ANY AI provider's embedding model for RAG (not just OpenAI 1536-dim).
--
-- Before: kb_chunks.embedding was vector(1536), forcing OpenAI text-embedding-3-small.
-- Anyone connecting Gemini (768) / Qwen (1024) / other dim → hard error at KB create.
--
-- After: kb_chunks.embedding is `vector` (no fixed dim). Each KB records its own
-- embedding_dim; retrieval sanity-checks query dim matches the KB's dim before
-- calling the RPC.
--
-- Trade-off: dropping the fixed dim also drops the IVFFlat index (IVFFlat requires
-- fixed dim). MVP: brute-force sequential scan — fine for <10k chunks per KB.
-- Future: add per-dim partitioned indexes (kb_chunks_768, kb_chunks_1024, ...)
-- if any KB approaches that scale.

-- 1. Drop the fixed-dim index + swap the column type.
DROP INDEX IF EXISTS idx_kb_chunks_embedding;

-- pgvector allows plain `vector` with no dim spec. Existing data (dim=1536) still
-- fits — column just no longer constrains new inserts to that dim.
ALTER TABLE kb_chunks
  ALTER COLUMN embedding TYPE vector USING embedding::vector;

-- 2. Update kb_search RPC to accept variable-dim query embedding.
DROP FUNCTION IF EXISTS kb_search(UUID[], vector(1536), INT, REAL);

CREATE OR REPLACE FUNCTION kb_search(
  p_kb_ids UUID[],
  p_query_embedding vector,
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
    AND vector_dims(c.embedding) = vector_dims(p_query_embedding)  -- dim safety net
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_min_score
  ORDER BY c.embedding <=> p_query_embedding ASC
  LIMIT p_top_k;
$$;

-- 3. Note the dim on knowledge_bases so we can validate at the API layer without
-- probing chunks. Column already exists (embedding_dim INT) from migration 020.

COMMENT ON FUNCTION kb_search IS
  'Top-K cosine similarity search. Variable-dim: query must match the chunks'' dim '
  '(kb.embedding_dim). No IVFFlat index — brute-force scan. Fine for MVP scale.';
COMMENT ON COLUMN kb_chunks.embedding IS
  'Variable-dim vector. Each KB uses one embedding provider + model + dim; all chunks '
  'within a KB share that dim. Dim recorded on knowledge_bases.embedding_dim.';
