// Generates dist/sw.js — the service worker that lets sn-bujo's own app
// shell (HTML/CSS/JS, not note content — see src/sw.js's own header
// comment) keep working after a network failure, once it's loaded
// successfully at least once. Run after `vite build` (see the "build"
// script); order relative to build-manifest.mjs doesn't matter, since
// neither reads the other's output.
//
// The pure pieces are exported for test/build-sw.test.js. The CLI body only
// runs when this file is executed directly (not when imported by the test
// file), via the process.argv check at the bottom.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * Every `./assets/...` path referenced by a src= or href= attribute in the
 * built index.html -- i.e. exactly the hashed CSS/JS files this build
 * produced. Deduped and sorted for deterministic output.
 *
 * Throws if none are found: that means Vite's output shape changed in a way
 * this script no longer understands, and the service worker would otherwise
 * silently ship precaching an incomplete app shell.
 */
export function extractAssetPaths(html) {
  const paths = new Set()
  for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) {
    paths.add(match[1])
  }
  if (paths.size === 0) {
    throw new Error('No ./assets/ references found in index.html -- did the Vite build output shape change?')
  }
  return [...paths].sort()
}

/**
 * A cache name unique to this exact build. Hashes index.html's own bytes
 * *together with* the asset filenames -- hashing only the asset list would
 * miss a markup-only change to index.html (e.g. editing a <meta> tag)
 * producing the same cache name across two different builds, since the
 * asset filenames themselves wouldn't have changed between them. The
 * version prefix is purely for legibility when inspecting Cache Storage in
 * DevTools; the hash is what actually guarantees uniqueness.
 */
export function cacheNameFor(version, html, assets) {
  const hash = createHash('sha256').update(html).update('\n').update(assets.join('\n')).digest('hex').slice(0, 8)
  return `sn-bujo-${version}-${hash}`
}

/**
 * Replaces the two `// BUILD:*`-marked lines in src/sw.js's source with
 * their real, build-specific values. Throws if a marker is missing or
 * appears more than once rather than silently doing nothing or replacing
 * the wrong line -- a marker mismatch here means the generated service
 * worker would ship with dev placeholder values instead of the real ones.
 */
export function renderServiceWorker(source, { cacheName, precache }) {
  const replacementFor = {
    'BUILD:CACHE_NAME': `const CACHE_NAME = ${JSON.stringify(cacheName)} // BUILD:CACHE_NAME`,
    'BUILD:PRECACHE': `const PRECACHE = ${JSON.stringify(precache)} // BUILD:PRECACHE`,
  }
  let lines = source.split('\n')
  for (const [marker, replacement] of Object.entries(replacementFor)) {
    const matchCount = lines.filter((line) => line.includes(`// ${marker}`)).length
    if (matchCount !== 1) {
      throw new Error(`Expected exactly one line containing "// ${marker}" in src/sw.js, found ${matchCount}`)
    }
    lines = lines.map((line) => (line.includes(`// ${marker}`) ? replacement : line))
  }
  return lines.join('\n')
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const html = readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')
  const swSource = readFileSync(path.join(root, 'src', 'sw.js'), 'utf8')

  const assets = extractAssetPaths(html)
  for (const asset of assets) {
    // Each asset path is relative to dist/index.html (e.g. "./assets/index-XXXX.js").
    if (!existsSync(path.join(root, 'dist', asset))) {
      throw new Error(`index.html references ${asset}, but dist/${asset} does not exist`)
    }
  }

  const precache = ['./index.html', ...assets]
  const cacheName = cacheNameFor(pkg.version, html, assets)
  const rendered = renderServiceWorker(swSource, { cacheName, precache })

  writeFileSync(path.join(root, 'dist', 'sw.js'), rendered)
  console.log(`Wrote dist/sw.js (cache "${cacheName}", ${precache.length} precached files)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
