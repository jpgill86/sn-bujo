import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bujoHighlight } from './decorate.js'

const spellcheckCompartment = new Compartment()

/**
 * Create a CodeMirror editor bound to `parent`, calling `onChange(docText)`
 * whenever the user edits the document (not when we programmatically set it).
 */
export function createEditor({ parent, doc, onChange, spellcheck = true }) {
  let applyingRemote = false

  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorState.tabSize.of(2),
      spellcheckCompartment.of(EditorView.contentAttributes.of({ spellcheck: String(spellcheck) })),
      bujoHighlight,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingRemote) {
          onChange(update.state.doc.toString())
        }
      }),
    ],
  })

  const view = new EditorView({ state, parent })

  return {
    view,
    /** Replace the document without triggering onChange (for remote updates). */
    setDoc(text) {
      if (view.state.doc.toString() === text) return
      applyingRemote = true
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      })
      applyingRemote = false
    },
    setSpellcheck(enabled) {
      view.dispatch({
        effects: spellcheckCompartment.reconfigure(
          EditorView.contentAttributes.of({ spellcheck: String(enabled) })
        ),
      })
    },
  }
}
