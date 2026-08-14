import { EditorState, Compartment, Annotation } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bujoHighlight } from './decorate.js'

const spellcheckCompartment = new Compartment()

// Tags a transaction as a remote (host-driven) content update rather than a
// user edit, so the update listener below can tell them apart. This is
// attached directly to the transaction rather than tracked via an outer
// mutable flag (the previous approach) because a flag toggled synchronously
// around dispatch() is only reliable if the update listener is guaranteed to
// run synchronously within that same dispatch call. A prior version of this
// file used such a flag and it was implicated in a data-loss bug on Android:
// remote updates could be misread as user edits, triggering a save that
// overwrote real note content with empty text. Annotations travel with the
// transaction itself, so this check can't race regardless of listener timing.
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
