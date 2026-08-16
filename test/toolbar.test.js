// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { undoDepth, redoDepth } from '@codemirror/commands'
import { createEditor } from '../src/editor.js'
import { createToolbar } from '../src/toolbar.js'
import { cycleTaskBulletAt } from '../src/cycle.js'

// jsdom doesn't implement layout, so CodeMirror's cursor/selection
// measurement code throws when it asks for a range's client rects. Same stub
// as test/editor.test.js and test/cycle.test.js -- see those files for the
// full explanation.
Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
})

// These tests cover the command/state layer -- the part that can break
// silently. jsdom has no real touch event support (dispatched "touchend"
// events here are plain Events, not TouchEvents, which is fine since
// toolbar.js's handlers don't read touch-specific properties), and jsdom's
// focus model doesn't reproduce Android's keyboard-follows-focus behavior at
// all. The mousedown/touchstart preventDefault() focus-retention shell is
// intentionally left for manual/on-device verification instead, consistent
// with how test/cycle.test.js scopes itself.

function makeEditorWithToolbar(text, { hangingIndent = true, onToggleHangingIndent } = {}) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)

  const container = document.createElement('div')
  container.innerHTML = `
    <button type="button" id="undo-btn" disabled></button>
    <button type="button" id="redo-btn" disabled></button>
    <button type="button" id="hanging-indent-btn"></button>
  `
  document.body.appendChild(container)

  let toolbar = null
  const editor = createEditor({
    parent,
    doc: text,
    hangingIndent,
    onChange: vi.fn(),
    onUpdate: () => toolbar?.sync(),
  })
  toolbar = createToolbar({ container, view: editor.view, hangingIndent, onToggleHangingIndent })
  toolbar.sync()

  return {
    editor,
    toolbar,
    undoBtn: container.querySelector('#undo-btn'),
    redoBtn: container.querySelector('#redo-btn'),
    hangingIndentBtn: container.querySelector('#hanging-indent-btn'),
  }
}

describe('toolbar', () => {
  it('starts with both buttons disabled when there is no history', () => {
    const { undoBtn, redoBtn } = makeEditorWithToolbar('hello')

    expect(undoBtn.disabled).toBe(true)
    expect(redoBtn.disabled).toBe(true)
  })

  it('enables Undo after an edit, and clicking it reverts the edit', () => {
    const { editor, undoBtn, redoBtn } = makeEditorWithToolbar('hello')

    editor.view.dispatch({ changes: { from: 5, insert: ' world' } })
    expect(editor.view.state.doc.toString()).toBe('hello world')
    expect(undoBtn.disabled).toBe(false)
    expect(redoBtn.disabled).toBe(true)

    undoBtn.click()

    expect(editor.view.state.doc.toString()).toBe('hello')
    expect(undoBtn.disabled).toBe(true)
    expect(redoBtn.disabled).toBe(false)
  })

  it('enables Redo only after an undo, and clicking it reapplies the edit', () => {
    const { editor, undoBtn, redoBtn } = makeEditorWithToolbar('hello')

    editor.view.dispatch({ changes: { from: 5, insert: ' world' } })
    undoBtn.click()
    expect(redoBtn.disabled).toBe(false)

    redoBtn.click()

    expect(editor.view.state.doc.toString()).toBe('hello world')
    expect(redoBtn.disabled).toBe(true)
  })

  it('undoes a tap-to-cycle bullet change', () => {
    // The motivating case: an accidental tap on a task bullet is exactly the
    // scenario this toolbar exists to make recoverable on mobile, where
    // Ctrl+Z isn't available at all.
    const { editor, undoBtn } = makeEditorWithToolbar('. laundry')

    cycleTaskBulletAt(editor.view, 0) // . -> /
    expect(editor.view.state.doc.toString()).toBe('/ laundry')
    expect(undoBtn.disabled).toBe(false)

    undoBtn.click()

    expect(editor.view.state.doc.toString()).toBe('. laundry')
  })

  it('disables Undo again after a remote setDoc replaces the document', () => {
    // Regression coverage for a real bug caught while manually verifying
    // this toolbar: setDoc is also how a note's saved content gets loaded
    // into the (initially empty) editor in the first place. Before
    // editor.js excluded it from history, that initial load was itself an
    // undo step -- Undo lit up the instant a note opened, and tapping it
    // wiped the note back to empty. A later remote update (e.g. a sync from
    // another device) also fully replaces the document, which collapses any
    // prior undo history CodeMirror can no longer map through the
    // replacement -- so both buttons should read as disabled afterward, not
    // just "in sync with whatever undoDepth happens to be."
    const { editor, undoBtn, redoBtn } = makeEditorWithToolbar('hello')

    editor.view.dispatch({ changes: { from: 5, insert: ' world' } })
    expect(undoBtn.disabled).toBe(false)

    editor.setDoc('a totally different remote document')

    expect(undoDepth(editor.view.state)).toBe(0)
    expect(redoDepth(editor.view.state)).toBe(0)
    expect(undoBtn.disabled).toBe(true)
    expect(redoBtn.disabled).toBe(true)
  })

  it('the ghost-click guard prevents a touchend + synthesized click from undoing twice', () => {
    const { editor, undoBtn } = makeEditorWithToolbar('hello')
    // Distinct userEvent per dispatch so CodeMirror's history records these
    // as two separate undo steps rather than coalescing them the way it
    // would for two untagged edits close together in time (the same reason
    // cycle.js explicitly tags its own dispatches -- see its 'bujo.cycle'
    // comment). That keeps the undo boundary this test depends on
    // unambiguous.
    editor.view.dispatch({ changes: { from: 5, insert: ' world' }, userEvent: 'test.a' })
    editor.view.dispatch({ changes: { from: 11, insert: '!' }, userEvent: 'test.b' })
    expect(editor.view.state.doc.toString()).toBe('hello world!')

    undoBtn.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }))
    expect(editor.view.state.doc.toString()).toBe('hello world') // one step undone

    // Browsers that don't suppress the synthesized click after
    // preventDefault() on touchstart/touchend would fire this next -- the
    // guard must ignore it since the touchend already ran Undo.
    undoBtn.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))

    expect(editor.view.state.doc.toString()).toBe('hello world') // still just one step undone
  })

  it('reflects the initial hangingIndent state via aria-pressed', () => {
    const on = makeEditorWithToolbar('hello', { hangingIndent: true })
    expect(on.hangingIndentBtn.getAttribute('aria-pressed')).toBe('true')

    const off = makeEditorWithToolbar('hello', { hangingIndent: false })
    expect(off.hangingIndentBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('toggles aria-pressed and calls onToggleHangingIndent with the new state on each click', () => {
    const onToggleHangingIndent = vi.fn()
    const { hangingIndentBtn } = makeEditorWithToolbar('hello', {
      hangingIndent: true,
      onToggleHangingIndent,
    })

    hangingIndentBtn.click()
    expect(hangingIndentBtn.getAttribute('aria-pressed')).toBe('false')
    expect(onToggleHangingIndent).toHaveBeenLastCalledWith(false)

    hangingIndentBtn.click()
    expect(hangingIndentBtn.getAttribute('aria-pressed')).toBe('true')
    expect(onToggleHangingIndent).toHaveBeenLastCalledWith(true)

    expect(onToggleHangingIndent).toHaveBeenCalledTimes(2)
  })

  it('setHangingIndentPressed updates the button without calling onToggleHangingIndent', () => {
    // This is the path main.js uses when the host's real, persisted
    // preference arrives asynchronously and corrects the toolbar's initial
    // optimistic guess (see relay.js). It must not call
    // onToggleHangingIndent -- that callback is what persists a *user*
    // toggle back to storage, and looping a read back into a write here
    // would be pointless at best and could race with the real value at
    // worst.
    const onToggleHangingIndent = vi.fn()
    const { toolbar, hangingIndentBtn } = makeEditorWithToolbar('hello', {
      hangingIndent: true,
      onToggleHangingIndent,
    })

    toolbar.setHangingIndentPressed(false)

    expect(hangingIndentBtn.getAttribute('aria-pressed')).toBe('false')
    expect(onToggleHangingIndent).not.toHaveBeenCalled()
  })
})
