# meet

A free app on FreeAppStore.

- Subdomain: `meet.freeappstore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

Free, MIT-licensed, no tracking. For platform conventions, read
https://freeappstore.online/skills.md
before writing or changing anything.

## Config & secrets

- Never commit `.env.production` (compliance check fails).
- Public identifiers (OAuth client IDs, Firebase config): set as GitHub repo Variables (`VITE_*` prefix).
- API keys that cost money: use `fas.proxy.fetch()` (app-secret proxy or user key vault).
- Local dev: use `.env.local` (gitignored).
- See "App Config & Secrets" in SKILLS.md for the full guide.
