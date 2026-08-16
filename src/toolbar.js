import { undo, redo, undoDepth, redoDepth } from '@codemirror/commands'

// A plain <button> takes focus when pressed, which blurs the editor -- and on
// Android, blurring the editor closes the on-screen keyboard and drops the
// cursor. Tapping Undo would "fix" your text and simultaneously kick you out
// of the document. preventDefault() on mousedown is what stops a desktop
// click from moving focus to the button; on touch, preventDefault() on
// touchstart does the same job *and* suppresses the synthesized
// mousedown/click events the browser would otherwise fire afterward -- which
// is why the actual action runs from touchend instead of click. Since the
// synthesized click is suppressed, the touch and mouse paths don't both fire
// for a single tap.
//
// Not every Android browser reliably honors that click suppression, though,
// so a touchend that already ran the action is remembered for ~500ms and the
// click handler ignores anything in that window -- otherwise a single tap
// could silently undo twice.
const GHOST_CLICK_GUARD_MS = 500

function bindToolbarButton(btn, view, run) {
  let lastTouchActionTime = 0

  function runPreservingFocus() {
    const hadFocus = view.hasFocus
    run(view)
    // Conditional on purpose: unconditionally calling view.focus() would pop
    // the Android keyboard open even when the user tapped Undo without
    // having been typing in the first place, which is its own annoyance.
    if (hadFocus && !view.hasFocus) view.focus()
  }

  btn.addEventListener('mousedown', (event) => event.preventDefault())
  btn.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false })
  btn.addEventListener('touchend', (event) => {
    event.preventDefault()
    lastTouchActionTime = Date.now()
    runPreservingFocus()
  })
  btn.addEventListener('click', () => {
    if (Date.now() - lastTouchActionTime < GHOST_CLICK_GUARD_MS) return
    runPreservingFocus()
  })
}

/**
 * Wire up the toolbar (see index.html for the #undo-btn/#redo-btn/
 * #hanging-indent-btn markup) to a CodeMirror view.
 *
 * `hangingIndent` is the toggle's initial (optimistic) state -- the caller's
 * real, persisted preference arrives asynchronously from the host (see
 * relay.js), so this just needs a reasonable default to render with
 * immediately; `setHangingIndentPressed()` (below) is how the toolbar gets
 * corrected once the real value is known. `onToggleHangingIndent(enabled)`
 * fires after each *user-driven* toggle so the caller can apply it to the
 * editor and persist it -- this module only owns the button's own on/off
 * appearance, not the editor state or storage.
 *
 * Returns:
 * - `sync()`, which the caller should invoke on every editor update so the
 *   Undo/Redo buttons stay correctly enabled/disabled -- including for
 *   updates that aren't doc changes at all (an undo/redo itself changes
 *   undoDepth/redoDepth without necessarily being a "new" edit).
 * - `setHangingIndentPressed(enabled)`, for the caller to reflect a state
 *   that came from elsewhere (the host's real persisted preference).
 */
export function createToolbar({ container, view, hangingIndent, onToggleHangingIndent }) {
  const undoBtn = container.querySelector('#undo-btn')
  const redoBtn = container.querySelector('#redo-btn')
  const hangingIndentBtn = container.querySelector('#hanging-indent-btn')

  bindToolbarButton(undoBtn, view, undo)
  bindToolbarButton(redoBtn, view, redo)

  let hangingIndentEnabled = hangingIndent

  // aria-pressed is also the CSS hook for the button's persistent on/off
  // look (styles.css), not just an accessibility attribute -- one write
  // covers both, and can't drift out of sync with itself.
  function setHangingIndentPressed(enabled) {
    hangingIndentEnabled = enabled
    hangingIndentBtn.setAttribute('aria-pressed', String(hangingIndentEnabled))
  }
  setHangingIndentPressed(hangingIndentEnabled)

  bindToolbarButton(hangingIndentBtn, view, () => {
    setHangingIndentPressed(!hangingIndentEnabled)
    onToggleHangingIndent?.(hangingIndentEnabled)
  })

  function sync() {
    undoBtn.disabled = undoDepth(view.state) === 0
    redoBtn.disabled = redoDepth(view.state) === 0
  }

  return { sync, setHangingIndentPressed }
}
