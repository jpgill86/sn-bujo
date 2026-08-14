// Tap-to-cycle for task bullets: tapping "." "/" "X" ">" or "<" advances it
// to the next state in the bujo task lifecycle. Deliberately built as a thin
// DOM-event layer on top of the existing plain-text document -- no
// Decoration.replace, no widgets, no atomicRanges -- so every other
// interaction (arrow keys, Backspace, selection, copy/paste) keeps behaving
// exactly like plain text, because nothing about how the document is
// modelled or edited has changed. See parseLine()/nextTaskBullet() in
// bujo.js for the pure logic this builds on.
import { StateField, StateEffect } from '@codemirror/state'
import { EditorView, Decoration } from '@codemirror/view'
import { parseLine, nextTaskBullet } from './bujo.js'

const FLASH_MS = 300

/**
 * Resolve the task bullet (if any) at document position `pos`.
 * Returns null if there's no bullet there, or the bullet there isn't one of
 * the five cyclable task states.
 */
export function taskBulletAt(state, pos) {
  const line = state.doc.lineAt(pos)
  const parsed = parseLine(line.text)
  if (!parsed.bullet) return null

  const from = line.from + parsed.bullet.from
  const to = line.from + parsed.bullet.to
  if (pos < from || pos >= to) return null

  const ch = line.text[parsed.bullet.from]
  const next = nextTaskBullet(ch)
  if (next === null) return null

  return { from, to, ch, next }
}

const flashEffect = StateEffect.define()
const clearFlashEffect = StateEffect.define()

const flashField = StateField.define({
  create() {
    return Decoration.none
  },
  update(flashes, tr) {
    flashes = flashes.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        flashes = Decoration.set([
          Decoration.mark({ class: 'cm-bujo-bullet-flash' }).range(e.value.from, e.value.to),
        ])
      } else if (e.is(clearFlashEffect)) {
        flashes = Decoration.none
      }
    }
    return flashes
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * Cycle the task bullet at `pos`, if there is one. Returns true if a change
 * was made (caller should treat the originating event as handled), false if
 * there was nothing cyclable at `pos` (caller should let the event proceed
 * normally, e.g. placing the cursor).
 */
export function cycleTaskBulletAt(view, pos) {
  const hit = taskBulletAt(view.state, pos)
  if (!hit) return false

  view.dispatch({
    changes: { from: hit.from, to: hit.to, insert: hit.next },
    // Deliberately not an `input.*` userEvent -- CodeMirror's history only
    // merges consecutive same-origin edits within `input.*`/`delete.*`
    // families, so this keeps every tap as its own undo step even when two
    // taps land in quick succession.
    userEvent: 'bujo.cycle',
    effects: flashEffect.of({ from: hit.from, to: hit.to }),
  })

  setTimeout(() => {
    if (!view.dom.isConnected) return
    view.dispatch({ effects: clearFlashEffect.of(null) })
  }, FLASH_MS)

  return true
}

// Guards against the ways a tap/click over a bullet's *text* isn't actually
// "the user wants to cycle this bullet": right-click, modified click,
// multi-click (word/line selection), an active selection being released, or
// a drag. Each one closes an accidental-change path called out in review.
function isPlainUnmodifiedClick(event) {
  return (
    event.button === 0 &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.detail <= 1
  )
}

const DRAG_SLOP_PX = 6
const DRAG_SLOP_MS = 600

// Tracks the pending mousedown/touchstart hit until its paired click/touchend.
// Module-scoped rather than per-instance is fine here: a mousedown (or
// touchstart) on one editor instance is always immediately followed by its
// own click/touchend (or neither fires), never interleaved with another
// instance's events.
let pendingMouse = null
let pendingTouch = null

/**
 * CodeMirror extension: tapping/clicking directly on a task bullet's
 * character cycles it instead of placing the cursor there.
 *
 * mousedown does the hit test and, on a hit, returns true so CodeMirror
 * calls preventDefault() -- this is what suppresses cursor placement and
 * focus (and therefore the mobile on-screen keyboard) for a successful tap.
 * The actual mutation happens on the paired click, once we know it wasn't a
 * drag or a multi-click.
 *
 * Real touch input additionally gets its own touchstart/touchend pair
 * (rather than relying solely on the mousedown/click emulation above).
 * On Android specifically, if the editor already has DOM focus (e.g. the
 * user dismissed the on-screen keyboard with the back button but the
 * caret/focus never left the editor), the WebView's native
 * tap-to-reposition-caret behavior isn't reliably suppressed by
 * preventDefault() on the *synthesized* mousedown/click -- only the initial
 * focus grab (when nothing was focused yet) goes through a path our mouse
 * handlers can intercept. touchend is the event that actually gates that
 * native behavior, so a successful tap-on-bullet there gets its own
 * preventDefault() as a more reliable suppressor. Deliberately not
 * preventing default on touchstart itself: that would also block a
 * genuine scroll gesture that happens to start on a bullet, before we can
 * tell a tap from a drag.
 */
export const taskCycle = [
  flashField,
  EditorView.domEventHandlers({
    mousedown(event, view) {
      pendingMouse = null
      if (!isPlainUnmodifiedClick(event)) return false
      if (!view.state.selection.main.empty) return false
      const target = event.target
      if (!(target instanceof Element) || !target.closest('.cm-bujo-bullet')) return false

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos == null) return false
      if (!taskBulletAt(view.state, pos)) return false

      pendingMouse = { pos, x: event.clientX, y: event.clientY, time: Date.now() }
      return true
    },
    click(event, view) {
      const p = pendingMouse
      pendingMouse = null
      if (!p) return false
      if (!isPlainUnmodifiedClick(event)) return false
      if (!withinTapSlop(event.clientX - p.x, event.clientY - p.y, Date.now() - p.time)) {
        return false
      }

      return cycleTaskBulletAt(view, p.pos)
    },
    touchstart(event, view) {
      pendingTouch = null
      if (event.touches.length !== 1) return false
      if (!view.state.selection.main.empty) return false

      const touch = event.touches[0]
      pendingTouch = { x: touch.clientX, y: touch.clientY, time: Date.now() }
      return false // never prevent default here -- would also block scrolling
    },
    touchend(event, view) {
      const p = pendingTouch
      pendingTouch = null
      if (!p) return false
      if (event.touches.length !== 0 || event.changedTouches.length !== 1) return false
      const touch = event.changedTouches[0]
      if (!withinTapSlop(touch.clientX - p.x, touch.clientY - p.y, Date.now() - p.time)) {
        return false
      }

      const pos = view.posAtCoords({ x: p.x, y: p.y })
      if (pos == null) return false
      return cycleTaskBulletAt(view, pos)
    },
  }),
]

function withinTapSlop(dx, dy, dt) {
  return Math.hypot(dx, dy) <= DRAG_SLOP_PX && dt <= DRAG_SLOP_MS
}
