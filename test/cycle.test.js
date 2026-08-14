// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { undo } from '@codemirror/commands'
import { taskBulletAt, cycleTaskBulletAt } from '../src/cycle.js'
import { createEditor } from '../src/editor.js'

// jsdom doesn't implement layout, so CodeMirror's cursor/selection
// measurement code throws when it asks for a range's client rects. Same
// stub as test/editor.test.js -- see that file for the full explanation.
Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
})

// These tests exercise taskBulletAt/cycleTaskBulletAt directly rather than
// simulating real mouse/touch DOM events -- jsdom has no layout engine, so
// coordinate-based hit testing (posAtCoords) isn't reliable to simulate.
// The thin domEventHandlers shell in cycle.js that resolves a click to a
// position is intentionally left for manual/on-device verification (see the
// plan's verification section) rather than covered here.

function makeEditor(text) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return createEditor({ parent, doc: text, onChange: vi.fn() })
}

describe('taskBulletAt', () => {
  it('resolves a bare task bullet at the start of a line', () => {
    const state = EditorState.create({ doc: '. laundry' })
    const hit = taskBulletAt(state, 0)
    expect(hit).toEqual({ from: 0, to: 1, ch: '.', next: '/' })
  })

  it('resolves a task bullet after indentation and a timestamp', () => {
    const doc = '  06:00 / prep dinner'
    const state = EditorState.create({ doc })
    const bulletPos = doc.indexOf('/')
    const hit = taskBulletAt(state, bulletPos)
    expect(hit).toEqual({ from: bulletPos, to: bulletPos + 1, ch: '/', next: 'X' })
  })

  it('returns null for a position clearly before the bullet (not just its boundary)', () => {
    const doc = '  . laundry'
    const state = EditorState.create({ doc })
    const bulletPos = doc.indexOf('.')
    expect(taskBulletAt(state, bulletPos - 1)).toBeNull()
  })

  it('returns null for a position clearly after the bullet (not just its boundary)', () => {
    const doc = '. laundry'
    const state = EditorState.create({ doc })
    // pos 2 is inside the following space character -- one more than the
    // boundary immediately after the bullet (pos 1, covered below).
    expect(taskBulletAt(state, 2)).toBeNull()
  })

  it('resolves at the boundary position immediately before the bullet', () => {
    // Matches the "from" end of the expanded CSS hit area (styles.css):
    // posAtCoords() resolves a click just left of the glyph to this exact
    // boundary position.
    const state = EditorState.create({ doc: '. laundry' })
    expect(taskBulletAt(state, 0)).not.toBeNull()
  })

  it('resolves at the boundary position immediately after the bullet', () => {
    // Matches the "to" end of the expanded CSS hit area (styles.css):
    // posAtCoords() resolves a click just right of the glyph to this exact
    // boundary position. Regression coverage for a real bug: the original
    // strict `pos < to` upper bound made the right side of the expanded hit
    // area silently inert while the left side worked, since `pos >= from`
    // already happened to include its own boundary.
    const state = EditorState.create({ doc: '. laundry' })
    expect(taskBulletAt(state, 1)).toEqual({ from: 0, to: 1, ch: '.', next: '/' })
  })

  it('returns null for a non-task bullet', () => {
    const state = EditorState.create({ doc: '- a note' })
    expect(taskBulletAt(state, 0)).toBeNull()
  })

  it('returns null for a line with no bullet at all', () => {
    const state = EditorState.create({ doc: 'THU 13 AUG 2026' })
    expect(taskBulletAt(state, 0)).toBeNull()
  })
})

describe('cycleTaskBulletAt', () => {
  it('replaces exactly the bullet character and leaves the rest of the line untouched', () => {
    const editor = makeEditor('  06:00 . prep dinner')
    const pos = editor.view.state.doc.toString().indexOf('.')

    const handled = cycleTaskBulletAt(editor.view, pos)

    expect(handled).toBe(true)
    expect(editor.view.state.doc.toString()).toBe('  06:00 / prep dinner')
  })

  it('fires onChange, the same as any other local edit', () => {
    const onChange = vi.fn()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const editor = createEditor({ parent, doc: '. laundry', onChange })

    cycleTaskBulletAt(editor.view, 0)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('/ laundry')
  })

  it('returns false and makes no change when there is nothing cyclable at pos', () => {
    const editor = makeEditor('- a note')

    const handled = cycleTaskBulletAt(editor.view, 0)

    expect(handled).toBe(false)
    expect(editor.view.state.doc.toString()).toBe('- a note')
  })

  it('records two taps as two separate undo steps', () => {
    const editor = makeEditor('. laundry')

    cycleTaskBulletAt(editor.view, 0) // . -> /
    cycleTaskBulletAt(editor.view, 0) // / -> X
    expect(editor.view.state.doc.toString()).toBe('X laundry')

    undo(editor.view)
    expect(editor.view.state.doc.toString()).toBe('/ laundry')

    undo(editor.view)
    expect(editor.view.state.doc.toString()).toBe('. laundry')
  })
})
