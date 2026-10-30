# SHROUK | شروق Eyewear

Premium eyewear e-commerce for Egypt (Arabic RTL / English LTR) on Cloudflare Workers.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 (runs in workerd)
npm run lint && npm run typecheck && npm test && npm run build
```

Non-secret config is in `wrangler.jsonc` `vars` (validated by `server/env.ts`). Secrets: `.dev.vars` locally, `wrangler secret put` when deployed. See `docs/` for architecture and phase plan.
