// Generates dist/sn-bujo.json — the production manifest — from the "sn"
// block in package.json. Run after `vite build` (see the "build" script).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const homepage = pkg.homepage.endsWith('/') ? pkg.homepage : `${pkg.homepage}/`
const manifestUrl = `${homepage}sn-bujo.json`

// GitHub Actions sets GITHUB_REPOSITORY (owner/repo) and, on a tag push,
// GITHUB_REF_NAME (the tag, e.g. "v0.1.0"). Fall back gracefully for local
// `npm run build`.
//
// NOTE: download_url points at a *built* zip attached to the GitHub Release
// (see .github/workflows/release.yml), not GitHub's auto-generated "source
// code" zip — the source zip contains unbundled src/ files that need a
// Vite build step, so it can't be loaded directly by the desktop app.
const repo = process.env.GITHUB_REPOSITORY ?? `jpgill86/${pkg.name}`
const tag = process.env.GITHUB_REF_NAME ?? `v${pkg.version}`
const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/sn-bujo-dist.zip`

const manifest = {
  identifier: pkg.sn.identifier,
  name: pkg.sn.name,
  content_type: pkg.sn.content_type,
  area: pkg.sn.area,
  version: pkg.version,
  url: homepage,
  download_url: downloadUrl,
  latest_url: manifestUrl,
  file_type: pkg.sn.file_type,
  note_type: pkg.sn.note_type,
  spellcheckControl: pkg.sn.spellcheckControl,
  description: pkg.sn.description,
}

writeFileSync(path.join(root, 'dist', 'sn-bujo.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote dist/sn-bujo.json (version ${pkg.version})`)
