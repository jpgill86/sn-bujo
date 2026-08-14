import { createEditor } from './editor.js'
import { connect } from './relay.js'
import './styles.css'

const parent = document.getElementById('editor')
const statusEl = document.getElementById('save-status')

function showSaveStatus(status) {
  if (!statusEl) return
  if (status === 'saving') {
    statusEl.textContent = 'Saving…'
  } else if (status === 'saved') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    statusEl.textContent = `Saved ${time}`
  }
}

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
})
