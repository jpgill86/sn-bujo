import { EditorState, Compartment, Annotation, Transaction } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, deleteCharBackwardStrict } from '@codemirror/commands'
import { bujoHighlight } from './decorate.js'
import { bujoHangingIndent } from './indent.js'
import { taskCycle } from './cycle.js'

const spellcheckCompartment = new Compartment()
const hangingIndentCompartment = new Compartment()

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
export function createEditor({ parent, doc, onChange, onUpdate, spellcheck = true, hangingIndent = true }) {
  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      // defaultKeymap's Backspace is deleteCharBackward, which special-cases
      // runs of leading whitespace: it deletes back to the previous
      // indent-unit tab stop in one keystroke instead of one character. That
      // divergence from plain-text Backspace is exactly what a bujo entry's
      // deep, space-indented continuation lines trigger constantly. Override
      // with the strict, always-one-character variant so Backspace behaves
      // identically to the Plain Text editor's textarea.
      keymap.of([
        { key: 'Backspace', run: deleteCharBackwardStrict, shift: deleteCharBackwardStrict },
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      EditorState.tabSize.of(2),
      spellcheckCompartment.of(EditorView.contentAttributes.of({ spellcheck: String(spellcheck) })),
      hangingIndentCompartment.of(hangingIndent ? bujoHangingIndent : []),
      bujoHighlight,
      taskCycle,
      EditorView.updateListener.of((update) => {
        const isRemote = update.transactions.some((tr) => tr.annotation(remoteUpdate))
        if (update.docChanged && !isRemote) {
          onChange(update.state.doc.toString())
        }
        // Fires on every update, not just doc changes -- undo/redo depth
        // moves on undo/redo transactions themselves (a doc change, but not
        // one that should be mistaken for new user input) and can also
        // reset on a remote setDoc, so the toolbar's enabled/disabled state
        // needs to stay in sync regardless of what kind of update this is.
        onUpdate?.()
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
        // Transaction.addToHistory: false keeps this off the undo stack, the
        // same way remoteUpdate above keeps it out of onChange. Without it,
        // the very first setDoc -- loading the note's saved content into the
        // initially-empty editor -- becomes an undo step, so opening a note
        // ships with Undo already enabled and one tap wipes it back to
        // empty. Caught via the toolbar's own manual verification pass.
        annotations: [remoteUpdate.of(true), Transaction.addToHistory.of(false)],
      })
    },
    setSpellcheck(enabled) {
      view.dispatch({
        effects: spellcheckCompartment.reconfigure(
          EditorView.contentAttributes.of({ spellcheck: String(enabled) })
        ),
      })
    },
    /** Toggle hanging indents for wrapped lines -- display-only, never touches the document. */
    setHangingIndent(enabled) {
      view.dispatch({
        effects: hangingIndentCompartment.reconfigure(enabled ? bujoHangingIndent : []),
      })
    },
  }
}
