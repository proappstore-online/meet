# meet

A pro app on ProAppStore.

- Subdomain: `meet.proappstore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Deploy: reusable PAS pipeline → R2 (push to main)

## Config & secrets

- Never commit `.env.production` (compliance check fails).
- Public identifiers (OAuth client IDs, Firebase config): set as GitHub repo Variables (`VITE_*` prefix).
- API keys that cost money: use `app.proxy.fetch()` (app-secret proxy or user key vault).
- Local dev: use `.env.local` (gitignored).

## Marketing site

`marketing/` is the public static site at `about-meet.proappstore.online`.
`pnpm build:marketing` builds its three brochure pages, robots and sitemap.
`PAS_MARKETING_PREVIEW=true pnpm build:marketing` builds a separate noindex preview.
CI runs app and marketing checks on main through the required runner router.
