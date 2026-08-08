/**
 * services/kb-distiller.ts — Sprint B
 *
 * "Karpathy-style" ingestion: raw text → LLM → structured KB entries ready to embed.
 *
 * The LLM does the work of chunking a big blob into 1–8 focused entries, each with
 * kebab-case filename + title + summary + full markdown content. We then hand these
 * straight to the persistence layer (auto-accept per product Q3=B — no human review).
 */

import { runCompletion } from './ai-router'

export interface KBEntryDraft {
  filename: string       // kebab-case, ends with .md
  category?: string      // kebab-case
  title: string          // ≤120 chars
  summary: string        // ≤280 chars
  content: string        // markdown, 100–1500 words
  tags?: string[]
}

const SYSTEM_PROMPT = `Bạn là một AI curator kho kiến thức. Nhiệm vụ: nhận vào nội dung thô (bài viết dài, transcript, ghi chú, cuộc hội thoại) và distill thành 1-8 entry độc lập, có cấu trúc, dễ tra cứu.

Nguyên tắc distill (Karpathy-style):
- MỘT entry = MỘT ý/chủ đề rõ ràng. Nếu source có nhiều chủ đề rời rạc → tách ra nhiều entry.
- Nếu source ngắn và tập trung → chỉ tạo 1 entry.
- KHÔNG lặp lại nguyên văn source. Diễn đạt lại ngắn gọn, súc tích, có cấu trúc (heading, bullet, code block khi cần).
- Loại bỏ "chào bạn", quảng cáo, câu hỏi trivia, filler.

Với mỗi entry, output đúng schema JSON sau (không markdown wrapper, không giải thích thêm):

{
  "entries": [
    {
      "filename": "kebab-case-slug.md",
      "category": "optional-kebab-case",
      "title": "Tiêu đề ngắn gọn (≤120 ký tự)",
      "summary": "Tóm tắt 1-2 câu (≤280 ký tự)",
      "content": "# Nội dung markdown\\n\\nDiễn giải chi tiết, 100-1500 từ...",
      "tags": ["kebab-tag-1", "kebab-tag-2"]
    }
  ]
}

Ràng buộc:
- filename: chỉ chữ thường, số, dấu gạch ngang; luôn kết thúc .md; không dấu tiếng Việt.
- category (nếu có): chỉ kebab-case, không dấu.
- title: câu hoàn chỉnh, không viết hoa toàn bộ.
- summary: đọc là hiểu ngay entry nói về gì, không mở đầu bằng "Bài này/Entry này...".
- content: markdown thực dụng, có structure. Preserve code, số liệu, ví dụ cụ thể.
- tags: 2-5 tag, kebab-case, không dấu.

CHỈ output JSON. Không code fence, không comment.`

function buildUserPrompt(text: string, opts?: { productHint?: string }): string {
  const hint = opts?.productHint
    ? `\n\nGợi ý ngữ cảnh sản phẩm: ${opts.productHint}\nƯu tiên các tag/category phù hợp với sản phẩm này.\n`
    : ''
  return `Distill nội dung sau thành các KB entry:\n\n---BEGIN SOURCE---\n${text}\n---END SOURCE---${hint}`
}

/**
 * Best-effort JSON parse: strip common LLM habits (```json fences, leading/trailing
 * explanation) then JSON.parse. Throws with a readable error if we still can't parse.
 */
function parseDrafts(raw: string): KBEntryDraft[] {
  let s = (raw || '').trim()
  // Strip ```json ... ``` fences if present
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  // Some models prepend a sentence — cut to the first '{' if present
  const firstBrace = s.indexOf('{')
  if (firstBrace > 0) s = s.slice(firstBrace)
  // ...and truncate after the matching closing '}' greedily
  const lastBrace = s.lastIndexOf('}')
  if (lastBrace > 0 && lastBrace < s.length - 1) s = s.slice(0, lastBrace + 1)

  let obj: any
  try {
    obj = JSON.parse(s)
  } catch (e: any) {
    throw new Error(`Distiller trả về JSON không parse được: ${e.message}. Raw: ${s.slice(0, 300)}...`)
  }
  const entries = obj?.entries
  if (!Array.isArray(entries)) throw new Error(`Distiller output không có "entries" array. Got: ${JSON.stringify(obj).slice(0, 300)}`)

  return entries.map((e: any, i: number): KBEntryDraft => {
    if (!e.title || !e.content || !e.summary) {
      throw new Error(`Entry ${i} thiếu field bắt buộc (title/summary/content)`)
    }
    return {
      filename: normalizeFilename(e.filename || slugify(e.title)),
      category: e.category ? slugify(e.category) : undefined,
      title: String(e.title).slice(0, 120),
      summary: String(e.summary).slice(0, 280),
      content: String(e.content),
      tags: Array.isArray(e.tags) ? e.tags.map((t: any) => slugify(String(t))).filter(Boolean) : [],
    }
  })
}

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'entry'
}

function normalizeFilename(name: string): string {
  let s = String(name || '').trim().toLowerCase()
  s = s.replace(/\.(md|markdown)$/i, '')
  s = slugify(s)
  return `${s || 'entry'}.md`
}

/**
 * Distill raw text into structured KB entries. Auto-accept (no human review) —
 * caller persists them to kb_entries and triggers embedding.
 */
export async function distillRawText(
  text: string,
  opts?: { productHint?: string; providerHint?: string }
): Promise<KBEntryDraft[]> {
  if (!text?.trim()) return []

  const result = await runCompletion({
    provider: opts?.providerHint,          // undefined → uses is_default provider
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(text, opts),
    temperature: 0.3,
    maxTokens: 4000,
  })

  return parseDrafts(result.text)
}
