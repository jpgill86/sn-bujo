import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { renderServiceWorker } from '../scripts/build-sw.mjs'

// Node environment (this project's default -- see test/bujo.test.js). jsdom
// has no Service Worker implementation at all, and real registration, real
// storage partitioning, and actual offline navigation can't be simulated
// here regardless -- those are manual/on-device only (see the plan's
// verification section). What *can* be tested without a browser is the
// service worker's own event-handler logic in isolation: given a fetch
// event or an install/activate lifecycle event, does it do the right thing?
// That's what this file covers, by literally running src/sw.js's real
// source against small hand-rolled mocks of `self`, `caches`, and `fetch` --
// no bundler, no new dependency, and it exercises the exact same code that
// ships, not a reimplementation of it.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const swSource = readFileSync(path.join(root, 'src', 'sw.js'), 'utf8')

const CACHE_NAME = 'sn-bujo-test-cache'
const PRECACHE = ['https://example.test/sn-bujo/index.html', 'https://example.test/sn-bujo/assets/index-AAAA.js']

function makeSelf() {
  const listeners = {}
  return {
    location: new URL('https://example.test/sn-bujo/'),
    addEventListener(type, handler) {
      listeners[type] = handler
    },
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()) },
    __listeners: listeners,
  }
}

// A minimal stand-in for the Cache Storage API: a Map of cache name -> Map
// of request URL -> stored "response" (just a marker object here; nothing
// in sw.js's logic inspects response bodies). `state.failNextAddAll` lets a
// single test simulate a network failure during precaching without needing
// a whole separate fake.
function makeCaches() {
  const store = new Map()
  const state = { failNextAddAll: false }
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map())
      const entries = store.get(name)
      return {
        async addAll(requests) {
          if (state.failNextAddAll) {
            state.failNextAddAll = false
            throw new Error('simulated network failure')
          }
          for (const req of requests) {
            const url = typeof req === 'string' ? req : req.url
            entries.set(url, { url, cacheMode: typeof req === 'string' ? undefined : req.cache })
          }
        },
        async match(key) {
          const url = typeof key === 'string' ? key : key.url
          return entries.get(url)
        },
      }
    },
    async keys() {
      return [...store.keys()]
    },
    async delete(name) {
      return store.delete(name)
    },
  }
  return { caches, store, state }
}

function makeEvent(overrides = {}) {
  const event = { ...overrides }
  event.waitUntil = (promise) => {
    event.waitUntilPromise = promise
  }
  event.respondWith = (promise) => {
    event.respondWithPromise = promise
  }
  return event
}

// Loads sw.js's real source (rendered with test-specific cache
// name/precache list, same mechanism build-sw.mjs uses for real) and
// invokes it against the given self/caches/fetch, returning the captured
// event listeners so a test can dispatch install/activate/fetch directly.
function loadServiceWorker({ self: fakeSelf, caches, fetch }) {
  const rendered = renderServiceWorker(swSource, { cacheName: CACHE_NAME, precache: PRECACHE })
  const run = new Function('self', 'caches', 'fetch', rendered)
  run(fakeSelf, caches, fetch)
  return fakeSelf.__listeners
}

describe('service worker install', () => {
  it('precaches exactly the configured entries using cache: reload', async () => {
    const fakeSelf = makeSelf()
    const { caches, store } = makeCaches()
    const listeners = loadServiceWorker({ self: fakeSelf, caches, fetch: vi.fn() })

    const event = makeEvent()
    listeners.install(event)
    await event.waitUntilPromise

    const cached = [...store.get(CACHE_NAME).values()]
    expect(cached.map((c) => c.url).sort()).toEqual([...PRECACHE].sort())
    expect(cached.every((c) => c.cacheMode === 'reload')).toBe(true)
    expect(fakeSelf.skipWaiting).toHaveBeenCalled()
  })

  it('deletes the half-filled cache and rethrows when precaching fails', async () => {
    const fakeSelf = makeSelf()
    const { caches, store, state } = makeCaches()
    state.failNextAddAll = true
    const listeners = loadServiceWorker({ self: fakeSelf, caches, fetch: vi.fn() })

    const event = makeEvent()
    listeners.install(event)

    await expect(event.waitUntilPromise).rejects.toThrow('simulated network failure')
    expect(store.has(CACHE_NAME)).toBe(false)
    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled()
  })
})

describe('service worker activate', () => {
  it('deletes other sn-bujo- caches, keeps the current one, and leaves unrelated caches alone', async () => {
    const fakeSelf = makeSelf()
    const { caches, store } = makeCaches()
    // Simulate leftover state from a prior generation plus an unrelated
    // cache belonging to some other project sharing this GitHub Pages origin.
    store.set('sn-bujo-old-generation', new Map())
    store.set(CACHE_NAME, new Map())
    store.set('some-other-project-cache', new Map())

    const listeners = loadServiceWorker({ self: fakeSelf, caches, fetch: vi.fn() })
    const event = makeEvent()
    listeners.activate(event)
    await event.waitUntilPromise

    expect([...store.keys()].sort()).toEqual([CACHE_NAME, 'some-other-project-cache'].sort())
    expect(fakeSelf.clients.claim).toHaveBeenCalled()
  })
})

describe('service worker fetch', () => {
  function setup() {
    const fakeSelf = makeSelf()
    const { caches, store } = makeCaches()
    // Pre-create the cache entry (as if install already ran) so individual
    // tests can populate it directly without also exercising install here.
    store.set(CACHE_NAME, new Map())
    const fetchMock = vi.fn(() => Promise.resolve('network-response'))
    const listeners = loadServiceWorker({ self: fakeSelf, caches, fetch: fetchMock })
    return { listeners, store, fetchMock }
  }

  it('does not intercept non-GET requests', () => {
    const { listeners } = setup()
    const event = makeEvent({ request: { method: 'POST', url: 'https://example.test/sn-bujo/', mode: 'navigate' } })
    listeners.fetch(event)
    expect(event.respondWithPromise).toBeUndefined()
  })

  it('does not intercept cross-origin requests', () => {
    const { listeners } = setup()
    const event = makeEvent({ request: { method: 'GET', url: 'https://other.test/thing.js', mode: 'no-cors' } })
    listeners.fetch(event)
    expect(event.respondWithPromise).toBeUndefined()
  })

  it('does not intercept same-origin requests outside this scope', () => {
    const { listeners } = setup()
    // A sibling GitHub Pages project under the same origin, outside /sn-bujo/.
    const event = makeEvent({ request: { method: 'GET', url: 'https://example.test/other-project/', mode: 'navigate' } })
    listeners.fetch(event)
    expect(event.respondWithPromise).toBeUndefined()
  })

  it('resolves a navigation request to the cached shell (index.html), not a literal directory match', async () => {
    const { listeners, store } = setup()
    store.get(CACHE_NAME).set('https://example.test/sn-bujo/index.html', { url: 'index.html-response' })

    const event = makeEvent({ request: { method: 'GET', url: 'https://example.test/sn-bujo/', mode: 'navigate' } })
    listeners.fetch(event)
    const response = await event.respondWithPromise

    expect(response).toEqual({ url: 'index.html-response' })
  })

  it('resolves a cached asset request from cache', async () => {
    const { listeners, store } = setup()
    const assetUrl = 'https://example.test/sn-bujo/assets/index-AAAA.js'
    store.get(CACHE_NAME).set(assetUrl, { url: 'asset-response' })

    const event = makeEvent({ request: { method: 'GET', url: assetUrl, mode: 'same-origin' } })
    listeners.fetch(event)
    const response = await event.respondWithPromise

    expect(response).toEqual({ url: 'asset-response' })
  })

  it('falls through to fetch() for an uncached in-scope URL', async () => {
    const { listeners, fetchMock } = setup()
    const request = { method: 'GET', url: 'https://example.test/sn-bujo/assets/not-cached.js', mode: 'same-origin' }

    const event = makeEvent({ request })
    listeners.fetch(event)
    const response = await event.respondWithPromise

    expect(response).toBe('network-response')
    expect(fetchMock).toHaveBeenCalledWith(request)
  })
})
