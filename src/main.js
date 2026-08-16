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
