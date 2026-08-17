// Service worker for sn-bujo's own app shell (index.html + its built CSS/JS
// bundle) -- NOT note content, which never touches the network at all (it
// flows through @standardnotes/component-relay's postMessage protocol; see
// relay.js). Without this, the plugin's iframe fails to load at all with no
// network connection, since the host reloads it from the hosted `url` every
// time a note using it is opened. Standard Notes' own built-in Plain Text
// editor doesn't have this problem because it ships inside the host app;
// custom components like this one are always loaded live over HTTP unless
// they cache themselves.
//
// This is a classic (non-module) script -- never imported by main.js, never
// bundled by Vite. scripts/build-sw.mjs runs after `vite build`, reads the
// actual built dist/index.html to find the current build's asset filenames,
// and rewrites the two marked lines below before writing dist/sw.js. Both
// lines are valid, runnable defaults as they appear here, which is what
// lets test/sw.test.js exercise this file directly without a build step.
const CACHE_NAME = 'sn-bujo-dev' // BUILD:CACHE_NAME
const PRECACHE = ['./index.html'] // BUILD:PRECACHE

// Everything this service worker has ever cached is named with this prefix
// (see build-sw.mjs). Used on activate to find old generations to delete --
// filtering by prefix rather than deleting every cache on the origin, since
// GitHub Pages hosts other projects under jpgill86.github.io that may have
// their own service workers and caches sharing this same origin.
const CACHE_PREFIX = 'sn-bujo-'

// The iframe's own src is the directory URL ("https://.../sn-bujo/"), not
// index.html directly -- this is what a navigation request needs to be
// mapped to in the fetch handler below. Resolved against self.location
// (not hardcoded) so this works the same under the real deployed path and
// under `vite preview`'s root path.
const SHELL_URL = new URL('./index.html', self.location).href
const SCOPE_PATH = new URL('./', self.location).pathname

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        // { cache: 'reload' } forces a real network fetch for every
        // precache entry -- without it, the browser's own HTTP cache could
        // hand back a stale response and we'd precache content that
        // doesn't match what index.html actually references.
        await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))
      } catch (err) {
        // Never leave a half-filled generation behind under this name --
        // if a later install ever reused this exact name (it won't, since
        // the name is content-hashed, but defense in depth costs nothing
        // here) it could otherwise mistake a partial cache for a complete
        // one. Rethrow so the browser treats this install as failed and
        // keeps whatever service worker (if any) was previously in charge.
        await caches.delete(CACHE_NAME)
        throw err
      }
      // Safe specifically because this app is a single bundle with no lazy
      // chunks or route-based code-splitting: an already-open client can
      // never end up requesting an asset that only exists in a *newer*
      // cache generation than the one it was loaded from.
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))
      )
      // Not strictly required for offline to work (a fresh navigation is
      // controlled automatically once this SW is active), but without it
      // the very first load after registration shows as "uncontrolled" in
      // DevTools, which is a confusing thing to have to explain away during
      // manual verification.
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // No respondWith() for anything we don't explicitly recognize below --
  // that's what makes every one of these an inert no-op rather than a
  // behavior change: the request just proceeds exactly as it would with no
  // service worker installed at all.
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (!url.pathname.startsWith(SCOPE_PATH)) return

  // A navigation to the iframe's own directory URL needs to resolve to the
  // cached index.html specifically; anything else (the hashed asset files)
  // matches on its own request/URL.
  const key = req.mode === 'navigate' ? SHELL_URL : req

  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(key))
      .then((hit) => hit || fetch(req))
      // Cache-first, deliberately, not network-first: network-first would
      // reintroduce exactly the failure this exists to fix on a hanging or
      // flaky connection (Airplane Mode fails fast; a weak signal can hang
      // until timeout instead). The cost is that a newly released version
      // only becomes visible on the *next* load after this one, since the
      // browser's own out-of-band update check for sw.js itself is what
      // eventually replaces this cache via a fresh install/activate cycle.
      //
      // Every asset match is scoped to this one CACHE_NAME, so a cached
      // index.html can only ever be paired with the hashed JS/CSS from its
      // own build -- there's no code path here that can mix generations.
      //
      // sn-bujo.json / ext.json (the extension manifests) are never
      // precached and never pass through here: the host app fetches those
      // from its own document context, not through this iframe.
      .catch(() => fetch(req))
  )
})
