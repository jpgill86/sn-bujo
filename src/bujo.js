// Pure line parser for the bullet-journal plain text format. No CodeMirror
// dependency here on purpose: this module is the single source of truth for
// "what does this line mean", reused by the decorator now and by any future
// interactive features (e.g. click-to-toggle a task bullet).

// Known bullet characters and what they mean. Add a new one here and it
// immediately gets its own CSS class (cm-bujo-bullet-<kind>) — see
// src/styles.css. Anything not listed here still highlights as a bullet
// via the generic fallback below, just as an "unknown" kind.
export const BULLETS = {
  '-': 'note',
  o: 'event',
  '.': 'task-open',
  '/': 'task-doing',
  X: 'task-done',
  G: 'game',
  W: 'watch',
  R: 'read',
}

const TIMESTAMP_RE = /^~?\d{1,2}:\d{2}(\s?[ap]m)?/i
const HEADER_RE = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+.*\d{4}\s*$/i

// A single uppercase letter (other than A/I, which read as English words)
// or a single ASCII punctuation character, followed by a space or EOL,
// counts as a "bullet" even if it's not in the known map above. This lets
// new bullet types just work without a code change.
const GENERIC_BULLET_RE = /^[A-Z!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~](?=\s|$)/
const GENERIC_BULLET_EXCLUDE = new Set(['A', 'I'])

/**
 * Parse a single line of bullet-journal text.
 * All ranges are relative to the start of `text` (i.e. line-local offsets).
 *
 * @param {string} text a single line, no newline character
 * @returns {{
 *   indent: {from: number, to: number},
 *   timestamp: {from: number, to: number, approx: boolean} | null,
 *   bullet: {from: number, to: number, kind: string} | null,
 *   content: {from: number, to: number},
 *   header: boolean,
 * }}
 */
export function parseLine(text) {
  const indentMatch = /^[ \t]*/.exec(text)
  const indentEnd = indentMatch[0].length
  let pos = indentEnd

  let timestamp = null
  const tsMatch = TIMESTAMP_RE.exec(text.slice(pos))
  if (tsMatch) {
    const raw = tsMatch[0]
    const end = pos + raw.length
    // Require the timestamp to be followed by whitespace or EOL, so
    // "12:345" isn't mistaken for a valid timestamp.
    if (end === text.length || /\s/.test(text[end])) {
      timestamp = { from: pos, to: end, approx: raw.startsWith('~') }
      pos = end
      // consume up to one separating space (keep rest as content/indent-ish)
      if (text[pos] === ' ') pos += 1
    }
  }

  let bullet = null
  {
    const rest = text.slice(pos)
    // Skip a small amount of whitespace between timestamp and bullet
    // (e.g. "06:00  - out of bed" has two spaces).
    const wsMatch = /^[ \t]*/.exec(rest)
    const bulletStart = pos + wsMatch[0].length
    const ch = text[bulletStart]
    const after = text[bulletStart + 1]
    const followedByBoundary = after === undefined || after === ' ' || after === '\t'
    if (ch !== undefined && followedByBoundary) {
      if (Object.prototype.hasOwnProperty.call(BULLETS, ch)) {
        bullet = { from: bulletStart, to: bulletStart + 1, kind: BULLETS[ch] }
      } else if (GENERIC_BULLET_RE.test(ch) && !GENERIC_BULLET_EXCLUDE.has(ch)) {
        bullet = { from: bulletStart, to: bulletStart + 1, kind: 'unknown' }
      }
    }
    if (bullet) {
      pos = bullet.to
      if (text[pos] === ' ') pos += 1
    }
  }

  const header = !timestamp && !bullet && indentEnd === 0 && HEADER_RE.test(text)

  return {
    indent: { from: 0, to: indentEnd },
    timestamp,
    bullet,
    content: { from: pos, to: text.length },
    header,
  }
}
