import { createEditor } from './editor.js'
import { createToolbar } from './toolbar.js'
import { connect } from './relay.js'
import './styles.css'

const parent = document.getElementById('editor')
const statusEl = document.getElementById('save-status')
const diagEl = document.getElementById('diag-status')
const toolbarEl = document.getElementById('toolbar')

// Shown only while relevant: appears for a save in flight, then a brief
// "Saved" confirmation, then hides itself. Not fully redundant with the
// host's own sync indicator -- that reflects host-level sync status, not
// specifically whether our own save round-trip to the host succeeded. It's
// exactly that gap that made the Android bug invisible for a long time.
let hideSaveStatusTimeout = null
function showSaveStatus(status) {
  if (!statusEl) return
  if (hideSaveStatusTimeout) {
    clearTimeout(hideSaveStatusTimeout)
    hideSaveStatusTimeout = null
  }
  if (status === 'saving') {
    statusEl.hidden = false
    statusEl.textContent = 'Saving…'
  } else if (status === 'saved') {
    statusEl.hidden = false
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    statusEl.textContent = `Saved ${time}`
    hideSaveStatusTimeout = setTimeout(() => {
      statusEl.hidden = true
      hideSaveStatusTimeout = null
    }, 2000)
  }
}

// Rolling trace of connection/handshake milestones, so it's visible on
// screen exactly how far the host <-> component connection got, without
// needing devtools/remote debugging. Whatever stage never appears is where
// it broke.
//
// Hidden by default -- shown only if something's actually wrong, so it
// doesn't take up screen space during normal use. "Wrong" is deliberately
// broader than "threw an error": a previous version of the postMessage
// patch in relay.js caused a real failure that never threw anything, just
// silently dropped every message from the host. So in addition to reacting
// to actual errors/rejections, a one-shot timer reveals the trace if the
// handshake hasn't shown any sign of life within a few seconds -- catching
// that class of silent failure too, not just thrown ones.
const diagStages = []
let sawHealthySignal = false
function showDiag(stage) {
  diagStages.push(stage)
  if (diagEl) diagEl.textContent = diagStages.join(' > ')
  if (stage === 'standalone' || stage === 'ready' || stage === 'item-received') {
    sawHealthySignal = true
  }
  if (diagEl && (stage.startsWith('error:') || stage.startsWith('rejection:'))) {
    diagEl.hidden = false
  }
}

window.addEventListener('error', (event) => {
  showDiag(`error: ${event.message}`)
})
window.addEventListener('unhandledrejection', (event) => {
  showDiag(`rejection: ${event.reason}`)
})

setTimeout(() => {
  if (sawHealthySignal || !diagEl) return
  diagStages.push('stalled: no response from host after 8s')
  diagEl.textContent = diagStages.join(' > ')
  diagEl.hidden = false
}, 8000)

let bridge = null
let toolbar = null

// true is just the initial, optimistic render -- the real, persisted
// preference is host-owned (see relay.js's onHangingIndentPref) and arrives
// asynchronously, same as onSpellcheck below. A brief flash if the real
// value turns out to be off is an acceptable tradeoff for not blocking the
// editor's first paint on a round-trip to the host.
const editor = createEditor({
  parent,
  doc: '',
  spellcheck: true,
  hangingIndent: true,
  onChange: (text) => {
    bridge?.save(text)
  },
  onUpdate: () => toolbar?.sync(),
})

toolbar = createToolbar({
  container: toolbarEl,
  view: editor.view,
  hangingIndent: true,
  onToggleHangingIndent: (enabled) => {
    editor.setHangingIndent(enabled)
    bridge?.setHangingIndentPref(enabled)
  },
})
toolbar.sync() // initial state: undo/redo both disabled, no history yet

bridge = connect({
  onNote: (text) => editor.setDoc(text),
  onSpellcheck: (enabled) => editor.setSpellcheck(enabled),
  onHangingIndentPref: (enabled) => {
    editor.setHangingIndent(enabled)
    toolbar.setHangingIndentPressed(enabled)
  },
  onSaveStatus: showSaveStatus,
  onDiag: showDiag,
})

// Without this, the plugin's iframe fails to load at all with no network
// connection -- the host reloads it from the hosted url every time a note
// using it is opened, and note content itself (which arrives via
// postMessage above, not a network fetch) is beside the point if the editor
// never loads in the first place. See src/sw.js for the caching strategy.
//
// PROD-only: the dev server would otherwise serve a stale cached build
// during local development, which is a well-known footgun with service
// workers. Verify offline behavior against `npm run build && npm run
// preview` instead (see README).
if (import.meta.env.PROD) {
  // The try/catch has to be *inside* this function, wrapping every line,
  // not wrapped around the call to registerServiceWorker() (or around just
  // the code that sets this up) from the outside. This function usually
  // runs deferred, from the 'load' listener below -- a throw from inside an
  // event-listener callback happens on its own fresh call stack and is
  // simply invisible to a try/catch that was only in scope back when
  // addEventListener() was called; it becomes an uncaught global error
  // instead, in the *listener's* stack. An earlier version of this guard
  // made exactly that mistake, confirmed on a real device: it worked when
  // document.readyState happened to already be 'complete' (register() runs
  // synchronously, inside the original try), but the SecurityError from a
  // sandboxed iframe's disabled `navigator.serviceWorker` -- lacking the
  // allow-same-origin flag -- surfaced as an uncaught error (visible as
  // "error: Uncaught SecurityError..." in the connection trace) once it
  // actually ran from the 'load' listener instead, which is the common case.
  function registerServiceWorker() {
    try {
      if (!('serviceWorker' in navigator)) {
        showDiag('sw-unsupported')
        return
      }
      navigator.serviceWorker
        .register('./sw.js')
        .then(() => showDiag('sw-registered'))
        .catch((err) => showDiag(`sw-failed: ${err.message}`))
    } catch (err) {
      // Same defensive posture as prefs.js's localStorage wrapper, for the
      // same class of reason: merely *accessing* navigator.serviceWorker
      // can throw in a sandboxed or opaque-origin context, not just calling
      // register() on it.
      showDiag(`sw-failed: ${err.message}`)
    }
  }
  // Deferred to `load`, not run immediately: the precache's cache:'reload'
  // fetches would otherwise compete for the same connection as the host <->
  // component handshake above, which is already known to be
  // timing-sensitive on Android (see the stalled-handshake detection
  // above). Costs nothing to wait, since the SW only matters for the *next*
  // load anyway.
  if (document.readyState === 'complete') registerServiceWorker()
  else window.addEventListener('load', registerServiceWorker)
}
// Deliberately not gated by relay.js's isStandalone check -- that governs
// the note-content path only. This is about this document's own static
// assets, fetched the same way whether standalone or iframe-embedded; the
// only difference is which browser storage partition the registration
// lands in, which is the browser's business, not ours.
