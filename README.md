# Meet

Instant 1-on-1 video meetings with availability mode and push notifications — part of [ProAppStore](https://proappstore.online).

## Dev

```bash
pnpm install && pnpm dev
```

## Build

```bash
pnpm build
```

## Marketing and release

The public product site is `https://about-meet.proappstore.online/`; the runnable app stays at `https://meet.proappstore.online/`.
Edit `marketing/src/site.ts` for product copy. `pnpm build:marketing` emits static HTML and crawl files; `PAS_MARKETING_PREVIEW=true pnpm build:marketing` produces a separate noindex preview. `pnpm test:marketing` checks actual production/preview output.

Push to main for the reusable PAS deployment. Main CI runs the existing app suite and marketing build checks. Keep meeting links, identities and room data out of public marketing copy.

## License

MIT.
