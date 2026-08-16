import { RangeSetBuilder, countColumn } from '@codemirror/state'
import { ViewPlugin, Decoration } from '@codemirror/view'
import { parseLine } from './bujo.js'

/**
 * The visual column a wrapped continuation of `lineText` should hang-indent
 * to: right where the item's text begins, after any indentation, timestamp,
 * and bullet (reusing parseLine's `content.from` -- the single source of
 * truth for "where does this line's content start", already relied on by
 * decorate.js). Returns 0 for lines that need no hanging indent at all
 * (blank lines, an unindented header) -- callers should treat 0 as "no
 * decoration needed" rather than rendering a zero-width indent.
 *
 * This is a *column*, not the character offset content.from returns
 * directly: those diverge on a tab-indented line, since a tab counts as
 * `tabSize` columns but only one character. countColumn does the same
 * conversion CodeMirror's own tabSize-aware rendering uses internally, so
 * this lines up with however wide a tab actually renders.
 */
export function hangingIndentColumn(lineText, tabSize) {
  const { content } = parseLine(lineText)
  return countColumn(lineText, tabSize, content.from)
}

function buildDecorations(view) {
  const builder = new RangeSetBuilder()

  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const col = hangingIndentColumn(line.text, view.state.tabSize)
      if (col > 0) {
        // Decoration.line is a point decoration -- must be added at the
        // line's own start position with a zero-length range.
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            class: 'cm-bujo-hanging-indent',
            attributes: { style: `--bujo-indent: ${col}ch` },
          })
        )
      }
      pos = line.to + 1
    }
  }

  return builder.finish()
}

// Kept as its own ViewPlugin (separate from bujoHighlight in decorate.js)
// specifically so it can be toggled independently via editor.js's
// hangingIndentCompartment -- folding it into bujoHighlight would make the
// two features impossible to enable/disable separately.
export const bujoHangingIndent = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view)
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)
