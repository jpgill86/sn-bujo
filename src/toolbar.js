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
 * Wire up an Undo/Redo toolbar (see index.html for the #undo-btn/#redo-btn
 * markup) to a CodeMirror view. Returns `sync()`, which the caller should
 * invoke on every editor update so the buttons stay correctly
 * enabled/disabled -- including for updates that aren't doc changes at all
 * (an undo/redo itself changes undoDepth/redoDepth without necessarily being
 * a "new" edit).
 */
export function createToolbar({ container, view }) {
  const undoBtn = container.querySelector('#undo-btn')
  const redoBtn = container.querySelector('#redo-btn')

  bindToolbarButton(undoBtn, view, undo)
  bindToolbarButton(redoBtn, view, redo)

  function sync() {
    undoBtn.disabled = undoDepth(view.state) === 0
    redoBtn.disabled = redoDepth(view.state) === 0
  }

  return { sync }
}
