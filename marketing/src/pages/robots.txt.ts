import type { APIRoute } from 'astro'
import { isPreview } from '../lib/seo'

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error('The marketing site origin must be configured')
  const sitemap = isPreview ? '' : `\nSitemap: ${new URL('/sitemap.xml', site).href}\n`
  return new Response(`User-agent: *\nAllow: /\n${sitemap}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
