import { createEditor } from './editor.js'
import { connect } from './relay.js'
import './styles.css'

const parent = document.getElementById('editor')
const statusEl = document.getElementById('save-status')
const diagEl = document.getElementById('diag-status')

function showSaveStatus(status) {
  if (!statusEl) return
  if (status === 'saving') {
    statusEl.textContent = 'Saving…'
  } else if (status === 'saved') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    statusEl.textContent = `Saved ${time}`
  }
}

// Rolling trace of connection/handshake milestones, so it's visible on
// screen exactly how far the host <-> component connection got, without
// needing devtools/remote debugging. Whatever stage never appears is where
// it broke.
//
// NOTE: this is deliberately always visible for now, not just on error.
// An earlier version hid it unless an 'error:'/'rejection:' stage was
// recorded, but the postMessage-origin bug this trace helped find has a
// silent failure mode too (see relay.js) -- no thrown error, just messages
// quietly going nowhere. Hiding this by default would hide that. Revisit
// hiding it once behavior has been solid across a few releases.
const diagStages = []
function showDiag(stage) {
  diagStages.push(stage)
  if (diagEl) diagEl.textContent = diagStages.join(' > ')
}

// Same reasoning: surface uncaught errors directly on screen, since devtools
// aren't available on mobile.
window.addEventListener('error', (event) => {
  showDiag(`error: ${event.message}`)
})
window.addEventListener('unhandledrejection', (event) => {
  showDiag(`rejection: ${event.reason}`)
})

let bridge = null

const editor = createEditor({
  parent,
  doc: '',
  spellcheck: true,
  onChange: (text) => {
    bridge?.save(text)
  },
})

bridge = connect({
  onNote: (text) => editor.setDoc(text),
  onSpellcheck: (enabled) => editor.setSpellcheck(enabled),
  onSaveStatus: showSaveStatus,
  onDiag: showDiag,
})
