import { EditorState, Compartment, Annotation } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bujoHighlight } from './decorate.js'
import { taskCycle } from './cycle.js'

const spellcheckCompartment = new Compartment()

// Tags a transaction as a remote (host-driven) content update rather than a
// user edit, so the update listener below can tell them apart. This used to
// be tracked via an outer mutable boolean flag toggled around dispatch(),
// which only reliably distinguishes remote vs. local updates if the update
// listener always runs synchronously within that same dispatch call.
// Switched to an annotation (which travels with the transaction itself, so
// it can't race regardless of listener timing) while chasing an Android
// data-loss bug -- that turned out to have a different root cause (see
// relay.js's postMessage patch), but this is still the more robust,
// idiomatic CodeMirror 6 pattern for the problem, so it stays.
const remoteUpdate = Annotation.define()

/**
 * Create a CodeMirror editor bound to `parent`, calling `onChange(docText)`
 * whenever the user edits the document (not when we programmatically set it).
 */
export function createEditor({ parent, doc, onChange, spellcheck = true }) {
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
      taskCycle,
      EditorView.updateListener.of((update) => {
        const isRemote = update.transactions.some((tr) => tr.annotation(remoteUpdate))
        if (update.docChanged && !isRemote) {
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
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: remoteUpdate.of(true),
      })
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
