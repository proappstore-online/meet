# meet

A pro app on ProAppStore.

- Subdomain: `meet.proappstore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Deploy: CF Pages (push to main)

## Config & secrets

- Never commit `.env.production` (compliance check fails).
- Public identifiers (OAuth client IDs, Firebase config): set as GitHub repo Variables (`VITE_*` prefix).
- API keys that cost money: use `app.proxy.fetch()` (app-secret proxy or user key vault).
- Local dev: use `.env.local` (gitignored).
