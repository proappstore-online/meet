import type { APIRoute } from 'astro'
import { isPreview, publicPaths } from '../lib/seo'

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error('The marketing site origin must be configured')
  const urls = isPreview ? [] : publicPaths.map((path) => new URL(path, site).href)
  const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]!)
  const entries = urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
