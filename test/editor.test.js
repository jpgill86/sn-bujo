// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { undoDepth, redoDepth } from '@codemirror/commands'
import { createEditor } from '../src/editor.js'

// jsdom doesn't implement layout, so CodeMirror's cursor/selection
// measurement code throws when it asks for a range's client rects. We don't
// need real layout for these tests (only doc/transaction behavior), so stub
// it out to keep the test output free of unrelated noise.
Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
})

// Regression coverage for a real data-loss bug: a remote content update
// (setDoc, used when the host delivers a note's saved text) must never be
// mistaken for a user edit and echoed back via onChange -- doing so can
// overwrite real note content with whatever setDoc happened to be called
// with, and previously did exactly that on Android. See editor.js for the
// full explanation of the transaction-annotation approach this protects.

function makeEditor(onChange) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return createEditor({ parent, doc: '', onChange, spellcheck: true })
}

describe('createEditor remote vs. local updates', () => {
  it('does not call onChange when setDoc sets initial remote content', () => {
    const onChange = vi.fn()
    const editor = makeEditor(onChange)

    editor.setDoc('THU 13 AUG 2026\n  06:00 - out of bed\n')

    expect(onChange).not.toHaveBeenCalled()
    expect(editor.view.state.doc.toString()).toBe('THU 13 AUG 2026\n  06:00 - out of bed\n')
  })

  it('does not call onChange when setDoc replaces content with different remote content', () => {
    const onChange = vi.fn()
    const editor = makeEditor(onChange)

    editor.setDoc('first version')
    editor.setDoc('second version, replacing the first')

    expect(onChange).not.toHaveBeenCalled()
    expect(editor.view.state.doc.toString()).toBe('second version, replacing the first')
  })

  it('does not call onChange or touch the doc when setDoc is a no-op', () => {
    const onChange = vi.fn()
    const editor = makeEditor(onChange)

    editor.setDoc('unchanged')
    onChange.mockClear()
    editor.setDoc('unchanged')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('calls onChange with the new text for a user-originated edit', () => {
    const onChange = vi.fn()
    const editor = makeEditor(onChange)

    editor.setDoc('hello')
    // Dispatching a plain transaction with no remote annotation is what a
    // real keystroke produces.
    editor.view.dispatch({ changes: { from: 5, insert: ' world' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('hello world')
  })

  it('never lets a remote update surface as an empty-content save', () => {
    const onChange = vi.fn()
    const editor = makeEditor(onChange)

    editor.setDoc('important content that must not be lost')
    editor.setDoc('') // e.g. host briefly delivers an empty/transient item
    editor.setDoc('important content that must not be lost')

    expect(onChange).not.toHaveBeenCalled()
    expect(editor.view.state.doc.toString()).toBe('important content that must not be lost')
  })

  it('does not put setDoc updates on the undo stack', () => {
    // Regression coverage for a real bug caught while building the
    // Undo/Redo toolbar: without excluding setDoc from history, loading a
    // note's saved content into the initially-empty editor was itself an
    // undo step -- Undo was enabled the instant a note opened, and tapping
    // it wiped the note back to empty.
    const editor = makeEditor(vi.fn())

    editor.setDoc('loaded from the host')
    expect(undoDepth(editor.view.state)).toBe(0)

    editor.setDoc('a later remote update')
    expect(undoDepth(editor.view.state)).toBe(0)
    expect(redoDepth(editor.view.state)).toBe(0)
  })

  it('clears prior undo history when a remote update replaces the whole document', () => {
    // Not a bug introduced by the addToHistory fix above -- setDoc always
    // does a full 0-to-length replace (there's no diffing against the old
    // content), so CodeMirror's history can't map an earlier changeset's
    // positions through it meaningfully and drops it. Documented here as a
    // known, pre-existing characteristic: an in-flight local edit's undo
    // step doesn't survive a remote update landing on top of it. In
    // practice this is a narrow window, since onChange's debounced save
    // means most edits are already persisted well before another device's
    // update could arrive.
    const onChange = vi.fn()
    const editor = makeEditor(onChange)

    editor.setDoc('start')
    editor.view.dispatch({ changes: { from: 5, insert: ' plus a local edit' } })
    expect(undoDepth(editor.view.state)).toBe(1)

    editor.setDoc('a remote change arrives and replaces everything')

    expect(undoDepth(editor.view.state)).toBe(0)
  })
})

// Regression coverage for a real behavior mismatch with Plain Text: CodeMirror's
// defaultKeymap binds Backspace to deleteCharBackward, which special-cases a
// cursor preceded only by whitespace by deleting back to the previous
// indent-unit tab stop instead of one character. bujo entries are full of
// deep, space-indented continuation lines, so that divergence was very
// noticeable. editor.js overrides Backspace with the strict, always-one-char
// variant -- verify that wiring with a real keydown, not just by asserting
// which command function was passed to keymap.of().
describe('Backspace over runs of leading whitespace', () => {
  function pressBackspace(view) {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true })
    )
  }

  it('deletes exactly one space at a time, not to the previous tab stop', () => {
    const editor = makeEditor(vi.fn())
    editor.setDoc('        content') // 8 leading spaces
    editor.view.dispatch({ selection: { anchor: 8 } })

    pressBackspace(editor.view)

    expect(editor.view.state.doc.toString()).toBe('       content') // 7 spaces
  })

  it('still deletes one full tab character in one keystroke', () => {
    const editor = makeEditor(vi.fn())
    editor.setDoc('\t\tcontent')
    editor.view.dispatch({ selection: { anchor: 2 } })

    pressBackspace(editor.view)

    expect(editor.view.state.doc.toString()).toBe('\tcontent')
  })
})
