// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { hangingIndentColumn } from '../src/indent.js'
import { createEditor } from '../src/editor.js'

// jsdom doesn't implement layout, so CodeMirror's cursor/selection
// measurement code throws when it asks for a range's client rects. Same stub
// as the other DOM-backed test files -- see test/editor.test.js for the full
// explanation.
Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
})

const TAB_SIZE = 2 // matches EditorState.tabSize.of(2) in src/editor.js

describe('hangingIndentColumn', () => {
  it('aligns under the item text, after a timestamp and bullet', () => {
    const line = '  16:50  - left work'
    // "left" starts right after "  16:50  - ".
    expect(hangingIndentColumn(line, TAB_SIZE)).toBe(line.indexOf('left'))
  })

  it('aligns under the item text when there is a bullet but no timestamp', () => {
    const line = '  - a continuation note with no timestamp'
    expect(hangingIndentColumn(line, TAB_SIZE)).toBe(line.indexOf('a continuation'))
  })

  it('aligns under bare indented text with no bullet at all', () => {
    const line = '  STEPS'
    expect(hangingIndentColumn(line, TAB_SIZE)).toBe(line.indexOf('STEPS'))
  })

  it('returns 0 for an unindented header line', () => {
    expect(hangingIndentColumn('THU 13 AUG 2026', TAB_SIZE)).toBe(0)
  })

  it('returns 0 for a blank line', () => {
    expect(hangingIndentColumn('', TAB_SIZE)).toBe(0)
  })

  it('converts a tab-indented offset to a visual column, not a raw character count', () => {
    // parseLine's content.from here is a character offset of 2 (one tab +
    // one bullet char + one space = 3 characters before "tabbed", so
    // content.from is 3) -- but the tab itself is worth tabSize columns, not
    // 1, so the resulting column must be wider than the character count.
    const line = '\t- tabbed note'
    const col = hangingIndentColumn(line, TAB_SIZE)
    const charOffset = line.indexOf('tabbed')
    expect(col).toBeGreaterThan(charOffset)
    expect(col).toBe(TAB_SIZE + '- '.length) // tab -> 2 columns, then "- "
  })
})

describe('hanging indent decoration', () => {
  function makeEditor(text, hangingIndent = true) {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    return createEditor({ parent, doc: text, onChange: vi.fn(), hangingIndent })
  }

  function lineElFor(editor, matchText) {
    return [...editor.view.dom.querySelectorAll('.cm-line')].find((el) => el.textContent.includes(matchText))
  }

  it('applies the hanging-indent class and CSS variable to a line that needs one', () => {
    const editor = makeEditor('  06:00  - out of bed')
    const el = lineElFor(editor, 'out of bed')

    expect(el.classList.contains('cm-bujo-hanging-indent')).toBe(true)
    expect(el.style.getPropertyValue('--bujo-indent')).toBe(`${'  06:00  - '.length}ch`)
  })

  it('does not decorate a line with nothing to align under', () => {
    const editor = makeEditor('THU 13 AUG 2026')
    const el = lineElFor(editor, 'THU 13 AUG 2026')

    expect(el.classList.contains('cm-bujo-hanging-indent')).toBe(false)
  })

  it('removes the decoration when toggled off via setHangingIndent', () => {
    const editor = makeEditor('  06:00  - out of bed')
    expect(lineElFor(editor, 'out of bed').classList.contains('cm-bujo-hanging-indent')).toBe(true)

    editor.setHangingIndent(false)

    expect(lineElFor(editor, 'out of bed').classList.contains('cm-bujo-hanging-indent')).toBe(false)
  })

  it('starts with no decoration at all when hangingIndent: false is passed at creation', () => {
    const editor = makeEditor('  06:00  - out of bed', false)
    expect(lineElFor(editor, 'out of bed').classList.contains('cm-bujo-hanging-indent')).toBe(false)
  })

  it('toggling never changes the document text', () => {
    const editor = makeEditor('  06:00  - out of bed')
    const before = editor.view.state.doc.toString()

    editor.setHangingIndent(false)
    editor.setHangingIndent(true)

    expect(editor.view.state.doc.toString()).toBe(before)
  })
})
