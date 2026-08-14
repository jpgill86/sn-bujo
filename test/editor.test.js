// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
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
})
