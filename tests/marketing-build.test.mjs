import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const marketing = fileURLToPath(new URL('../marketing', import.meta.url))

test('real marketing builds publish canonical crawl files and exclude preview pages', { timeout: 180_000 }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'pas-marketing-seo-'))
  const fixture = join(temporary, 'marketing')
  try {
    cpSync(marketing, fixture, {
      recursive: true,
      filter: (path) => !['node_modules', 'dist', '.astro'].includes(basename(path)),
    })
    symlinkSync(realpathSync(join(marketing, 'node_modules')), join(fixture, 'node_modules'), 'dir')
    for (const path of ['astro.config.ts', 'src/site.ts']) {
      const file = join(fixture, path)
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('APPNAME', 'seo-template-check'))
    }
    const origin = 'https://about-meet.proappstore.online'
    const urls = ['/', '/privacy/', '/terms/'].map((path) => new URL(path, origin).href)
    for (const preview of [false, true]) {
      const result = spawnSync('pnpm', ['exec', 'astro', 'build'], {
        cwd: fixture,
        env: { ...process.env, PAS_MARKETING_PREVIEW: String(preview), ASTRO_TELEMETRY_DISABLED: '1' },
        encoding: 'utf8',
        timeout: 80_000,
      })
      assert.equal(result.status, 0, result.stdout + result.stderr + (result.error || ''))
      const read = (path) => readFileSync(join(fixture, 'dist', path), 'utf8')
      const robots = read('robots.txt')
      assert.match(robots, /User-agent: \*\nAllow: \/\n/)
      const xml = read('sitemap.xml')
      assert.match(xml, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/)
      const actual = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
      assert.deepEqual(actual, preview ? [] : urls)
      if (preview) assert.doesNotMatch(robots, /Sitemap:/)
      else assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`))
      for (const [index, path] of ['index.html', 'privacy/index.html', 'terms/index.html'].entries()) {
        const html = read(path)
        const image = html.match(/property="og:image" content="([^"]+)"/)?.[1]
        assert(image, path)
        const imageUrl = new URL(image)
        assert.equal(imageUrl.origin, origin)
        const png = readFileSync(join(fixture, 'dist', imageUrl.pathname))
        assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
        assert(png.readUInt32BE(16) >= 200 && png.readUInt32BE(20) >= 200)
        assert(html.includes('name="twitter:card" content="summary"'))
        assert(html.includes(`name="robots" content="${preview ? 'noindex, nofollow' : 'index, follow'}"`), path)
        assert(html.includes(`rel="canonical" href="${urls[index]}"`), path)
        assert(html.includes(`property="og:url" content="${urls[index]}"`), path)
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
