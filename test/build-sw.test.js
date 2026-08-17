import { describe, it, expect } from 'vitest'
import { extractAssetPaths, cacheNameFor, renderServiceWorker } from '../scripts/build-sw.mjs'

// Node environment (this project's default -- see test/bujo.test.js), not
// jsdom: these test pure functions operating on strings, no DOM involved.

describe('extractAssetPaths', () => {
  const html = `<!doctype html>
<html>
  <head>
    <script type="module" crossorigin src="./assets/index-D0J4vVII.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-O7M7dzBZ.css">
  </head>
  <body>
    <svg viewBox="0 0 20 20"><path d="M3 9"></path></svg>
  </body>
</html>`

  it('extracts every ./assets/ reference from src and href attributes', () => {
    expect(extractAssetPaths(html)).toEqual(['./assets/index-D0J4vVII.js', './assets/index-O7M7dzBZ.css'])
  })

  it('dedupes and sorts the result', () => {
    const withDupe = html.replace('</head>', '<link rel="preload" href="./assets/index-O7M7dzBZ.css"></head>')
    expect(extractAssetPaths(withDupe)).toEqual(['./assets/index-D0J4vVII.js', './assets/index-O7M7dzBZ.css'])
  })

  it('does not mistake unrelated attribute values (e.g. inline SVG markup) for assets', () => {
    // Regression guard: a naive "any src=/href=" scan could pick up
    // incidental strings elsewhere in the document; this fixture's <svg>
    // and <path> elements exist specifically to prove those are ignored.
    expect(extractAssetPaths(html)).toHaveLength(2)
  })

  it('throws when no ./assets/ references are found', () => {
    // This is the alarm for "Vite's output shape changed and this script no
    // longer understands it" -- silently precaching nothing would be worse
    // than a loud failure at build time.
    expect(() => extractAssetPaths('<html><body>no assets here</body></html>')).toThrow(/Vite build output shape/)
  })
})

describe('cacheNameFor', () => {
  const html = '<html>fixture</html>'
  const assets = ['./assets/index-AAAA.js', './assets/index-BBBB.css']

  it('is stable for identical input', () => {
    expect(cacheNameFor('1.0.0', html, assets)).toBe(cacheNameFor('1.0.0', html, assets))
  })

  it('changes when an asset filename changes', () => {
    const changedAssets = ['./assets/index-ZZZZ.js', './assets/index-BBBB.css']
    expect(cacheNameFor('1.0.0', html, assets)).not.toBe(cacheNameFor('1.0.0', html, changedAssets))
  })

  it('changes when only index.html markup changes, even with identical asset names', () => {
    // The specific bug a naive "hash only the asset list" implementation
    // would miss: two different builds (e.g. a <meta> tag edit) that happen
    // to produce the same hashed asset filenames must still get different
    // cache names, or a stale index.html could be served with the wrong
    // (but same-cache-name) precache entry set.
    const differentHtml = '<html>a different build</html>'
    expect(cacheNameFor('1.0.0', html, assets)).not.toBe(cacheNameFor('1.0.0', differentHtml, assets))
  })

  it('includes the version for legibility', () => {
    expect(cacheNameFor('1.2.3', html, assets)).toMatch(/^sn-bujo-1\.2\.3-[0-9a-f]{8}$/)
  })
})

describe('renderServiceWorker', () => {
  const source = [
    'const CACHE_NAME = \'sn-bujo-dev\' // BUILD:CACHE_NAME',
    'const PRECACHE = [\'./index.html\'] // BUILD:PRECACHE',
    'const CACHE_PREFIX = \'sn-bujo-\'',
  ].join('\n')

  it('replaces both marked lines with the real build values', () => {
    const rendered = renderServiceWorker(source, {
      cacheName: 'sn-bujo-1.0.0-abcd1234',
      precache: ['./index.html', './assets/index-AAAA.js'],
    })
    expect(rendered).toContain('const CACHE_NAME = "sn-bujo-1.0.0-abcd1234"')
    expect(rendered).toContain('const PRECACHE = ["./index.html","./assets/index-AAAA.js"]')
  })

  it('leaves every other line byte-identical', () => {
    const rendered = renderServiceWorker(source, { cacheName: 'x', precache: [] })
    expect(rendered.split('\n')[2]).toBe(source.split('\n')[2])
  })

  it('throws when a marker is missing', () => {
    const missing = source.replace(' // BUILD:PRECACHE', '')
    expect(() => renderServiceWorker(missing, { cacheName: 'x', precache: [] })).toThrow(/BUILD:PRECACHE/)
  })

  it('throws when a marker appears more than once', () => {
    const duplicated = `${source}\n${source.split('\n')[0]}`
    expect(() => renderServiceWorker(duplicated, { cacheName: 'x', precache: [] })).toThrow(/BUILD:CACHE_NAME/)
  })
})
