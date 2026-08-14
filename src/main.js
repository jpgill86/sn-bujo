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
// it broke. Stays hidden during normal operation and only reveals itself
// once something has actually gone wrong, so it doesn't clutter the editor
// day to day.
const diagStages = []
function showDiag(stage) {
  diagStages.push(stage)
  if (!diagEl) return
  diagEl.textContent = diagStages.join(' > ')
  if (stage.startsWith('error:') || stage.startsWith('rejection:')) {
    diagEl.hidden = false
  }
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
