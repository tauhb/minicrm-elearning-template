# Publish checklist — `@rainmaker/agentcrm-mcp`

Follow this before every `npm publish`. **Do NOT run publish now**; this is documentation only.

## Pre-flight

- [ ] `cd apps/customer-portal-giftbox/mcp-server`
- [ ] `npm install` (fresh install, no lockfile issues)
- [ ] Bump `version` in `package.json` (semver: patch for bug/docs, minor for new tools, major for breaking scope/schema changes)
- [ ] Update `CHANGELOG.md` if one exists (create if adding new tools)
- [ ] Confirm `SCOPES` in `src/scopes.ts` matches `CANONICAL_SCOPES` in `api/api-tokens/index.ts` and `SCOPE_GROUPS` in `components/admin/APITokensView.tsx`
- [ ] Confirm every tool in `src/index.ts` mentions its required scope in the description string
- [ ] `npm run build` — must succeed with zero TypeScript errors
- [ ] `ls dist/index.js` — verify the compiled binary exists and has the `#!/usr/bin/env node` shebang preserved (tsc drops it — either add via build post-step or use `esbuild` bundler)
- [ ] Local smoke test:
      ```bash
      AGENTCRM_URL=http://localhost:3001 \
      AGENTCRM_TOKEN=acrm_<staging_token> \
      node dist/index.js
      ```
      Should print `token OK · owner=...` and idle on stdin.
- [ ] Connect from a real Claude Code / Codex instance pointing at the built dist, invoke `crm.leads.list` — verify response.

## npm auth

- [ ] `npm login` (or use org token via `NPM_TOKEN` env)
- [ ] Confirm you're publishing under the `@rainmaker` scope: `npm whoami` shows a user with publish rights to `@rainmaker`
- [ ] First publish: `npm publish --access public` (scoped packages default to private)

## Publish

```bash
npm publish --access public
```

## Post-publish

- [ ] Test install from a clean directory:
      ```bash
      npm install -g @rainmaker/agentcrm-mcp
      which agentcrm-mcp        # should resolve
      agentcrm-mcp               # should print AGENTCRM_URL missing help
      ```
- [ ] Tag the release in git: `git tag mcp-vX.Y.Z && git push --tags`
- [ ] Update the `env.AGENTCRM_URL` example in the CRM's `Settings → API Tokens` view if the config surface changed
- [ ] Announce in team channel with:
      - version
      - new/removed tools
      - migration notes if any scope was renamed

## Known gotchas

- `tsc` strips the `#!/usr/bin/env node` shebang. Options:
  1. Post-build script: `node -e "const f='dist/index.js'; const fs=require('fs'); fs.writeFileSync(f, '#!/usr/bin/env node\\n'+fs.readFileSync(f,'utf8'))"` then `chmod +x dist/index.js`.
  2. Or switch to `esbuild --bundle --platform=node --format=esm --banner:js="#!/usr/bin/env node"` (recommended).
- `@modelcontextprotocol/sdk` releases sometimes rename export paths. If a build fails after updating SDK, check `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'`.
- Never publish with a real customer token in `README.md` or examples. All samples must use `acrm_xxxxxxxx...` placeholders.
