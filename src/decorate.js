import { ViewPlugin, Decoration } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { parseLine } from './bujo.js'

function buildDecorations(view) {
  const builder = new RangeSetBuilder()

  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const parsed = parseLine(line.text)

      if (parsed.header) {
        builder.add(line.from, line.to, Decoration.mark({ class: 'cm-bujo-header' }))
      }

      if (parsed.timestamp) {
        const cls = parsed.timestamp.approx
          ? 'cm-bujo-timestamp cm-bujo-timestamp-approx'
          : 'cm-bujo-timestamp'
        builder.add(
          line.from + parsed.timestamp.from,
          line.from + parsed.timestamp.to,
          Decoration.mark({ class: cls })
        )
      }

      if (parsed.bullet) {
        builder.add(
          line.from + parsed.bullet.from,
          line.from + parsed.bullet.to,
          Decoration.mark({ class: `cm-bujo-bullet cm-bujo-bullet-${parsed.bullet.kind}` })
        )
      }

      pos = line.to + 1
    }
  }

  return builder.finish()
}

export const bujoHighlight = ViewPlugin.fromClass(
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
