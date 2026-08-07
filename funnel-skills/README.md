# Funnel Skills

Copywriting/design skills bundled with portal, used as AI system prompt when generating funnel step HTML.

## Files

| File | Purpose |
|---|---|
| `sales-skill.md` | Full framework for sales page funnel (PAS+StoryBrand+sections) |
| `leads-skill.md` | Framework for lead magnet landing pages |
| `copywriting-overlay.md` | Voice, tone, VN examples — appended to all types |
| `landing-copy-overlay.md` | Landing copy patterns — appended to all types |

## How it works

1. On portal setup, `npm run seed:funnel-types` reads these files
2. Content upserted into `funnel_types.system_prompt` in Supabase
3. When user generates a funnel step, `funnel-generator.ts` composes:
   - `funnel_types.system_prompt` (skill for chosen type)
   - + style instructions (from style picker)
   - + step-specific context
4. Sends to AI (ChatGPT/Codex) → HTML output

## Editing

**Method 1 — Edit source files**: modify `.md` here, run `npm run seed:funnel-types` to sync to DB.

**Method 2 — Edit in admin UI**: Settings → Funnel Types → Edit any type → modify `system_prompt` field. Saves to DB directly; source files not touched.

If both are used, admin UI value wins (DB is source of truth after seed).

## Adding new funnel type

Either:
- Add new `.md` file here + update `seed-funnel-types.mjs` — good for template shipped with portal
- Or use admin UI → "+ Add funnel type" — good for user-specific types
