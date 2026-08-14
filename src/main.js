import { createEditor } from './editor.js'
import { connect } from './relay.js'
import './styles.css'

const parent = document.getElementById('editor')

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
  onThemesChange: () => editor.refreshForThemeChange(),
})
