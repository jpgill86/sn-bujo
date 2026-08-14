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
    /**
     * Force a style recalculation and remeasure. Standard Notes swaps the
     * active theme's <link> stylesheet live while our iframe stays mounted;
     * in some hosts the CSS custom-property changes this produces (our
     * colors, which are all `var(--sn-stylekit-*)`) don't visibly repaint
     * until something forces a reflow. Call this from the host's
     * onThemesChange notification.
     */
    refreshForThemeChange() {
      // Reading a layout property forces the browser to flush any pending
      // style recalculation immediately rather than on the next paint.
      void view.dom.offsetHeight
      view.requestMeasure()
    },
  }
}
