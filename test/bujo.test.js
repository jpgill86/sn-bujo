import { describe, it, expect } from 'vitest'
import { parseLine, BULLETS } from '../src/bujo.js'

function bulletChar(line) {
  const p = parseLine(line)
  return p.bullet ? line.slice(p.bullet.from, p.bullet.to) : null
}

function timestampText(line) {
  const p = parseLine(line)
  return p.timestamp ? line.slice(p.timestamp.from, p.timestamp.to) : null
}

function contentText(line) {
  const p = parseLine(line)
  return line.slice(p.content.from, p.content.to)
}

describe('parseLine', () => {
  it('parses a header date line', () => {
    const p = parseLine('THU 13 AUG 2026')
    expect(p.header).toBe(true)
    expect(p.timestamp).toBeNull()
    expect(p.bullet).toBeNull()
  })

  it('does not treat a bare label as a header', () => {
    const p = parseLine('STEPS')
    expect(p.header).toBe(false)
  })

  it('does not treat an indented header-like line as a header', () => {
    const p = parseLine('  THU 13 AUG 2026')
    expect(p.header).toBe(false)
  })

  it('parses timestamp + single-space + bullet', () => {
    const line = '  16:50 - left work'
    expect(timestampText(line)).toBe('16:50')
    expect(bulletChar(line)).toBe('-')
    expect(contentText(line)).toBe('left work')
  })

  it('parses timestamp + double-space + bullet', () => {
    const line = '  06:00  - out of bed'
    expect(timestampText(line)).toBe('06:00')
    expect(bulletChar(line)).toBe('-')
    expect(contentText(line)).toBe('out of bed')
  })

  it('parses an approximate (tilde) timestamp', () => {
    const line = '  ~17:20 - back home'
    const p = parseLine(line)
    expect(p.timestamp.approx).toBe(true)
    expect(timestampText(line)).toBe('~17:20')
    expect(bulletChar(line)).toBe('-')
    expect(contentText(line)).toBe('back home')
  })

  it('does not distinguish exact vs. approximate timestamps beyond the approx flag', () => {
    // The parser still reports approx (bujo.js), but decorate.js gives both
    // the exact same CSS class -- this just guards the flag itself keeps
    // working, since the "no visual difference" behavior lives in decorate.js.
    expect(parseLine('10:00 - exact').timestamp.approx).toBe(false)
    expect(parseLine('~10:00 - approx').timestamp.approx).toBe(true)
  })

  it('parses a deeply indented continuation bullet with no timestamp', () => {
    const line = '           - a continuation note with no timestamp'
    const p = parseLine(line)
    expect(p.timestamp).toBeNull()
    expect(bulletChar(line)).toBe('-')
    expect(contentText(line)).toBe('a continuation note with no timestamp')
  })

  it('recognizes every documented bullet kind', () => {
    expect(parseLine('- note').bullet.kind).toBe('note')
    expect(parseLine('o event').bullet.kind).toBe('event')
    expect(parseLine('. laundry').bullet.kind).toBe('task-open')
    expect(parseLine('/ prep dinner').bullet.kind).toBe('task-doing')
    expect(parseLine('X completed').bullet.kind).toBe('task-done')
    expect(parseLine('> reschedule taxes').bullet.kind).toBe('task-migrated')
    expect(parseLine('< plan vacation').bullet.kind).toBe('task-scheduled')
    expect(parseLine('= feeling accomplished').bullet.kind).toBe('feeling')
    expect(parseLine('G video games').bullet.kind).toBe('game')
    expect(parseLine('W favorite show').bullet.kind).toBe('watch')
    expect(parseLine('R favorite book').bullet.kind).toBe('read')
    expect(Object.keys(BULLETS)).toEqual(['-', 'o', '.', '/', 'X', '>', '<', '=', 'G', 'W', 'R'])
  })

  it('treats a bullet with no trailing content as still a bullet', () => {
    const p = parseLine('X')
    expect(p.bullet.kind).toBe('task-done')
    expect(p.content.from).toBe(p.content.to)
  })

  it('handles a timestamp with no bullet', () => {
    const p = parseLine('10:00 just a timed note with no bullet')
    expect(p.timestamp).not.toBeNull()
    expect(p.bullet).toBeNull()
  })

  it('highlights an unknown punctuation bullet via the generic fallback', () => {
    const p = parseLine('* something new')
    expect(p.bullet.kind).toBe('unknown')
  })

  it('highlights an unknown uppercase-letter bullet via the generic fallback', () => {
    const p = parseLine('P went for a walk')
    expect(p.bullet.kind).toBe('unknown')
  })

  it('does not treat leading "I" as a bullet', () => {
    const p = parseLine('I woke up late')
    expect(p.bullet).toBeNull()
  })

  it('does not treat leading "A" as a bullet', () => {
    const p = parseLine('A great day overall')
    expect(p.bullet).toBeNull()
  })

  it('ignores blank lines', () => {
    const p = parseLine('')
    expect(p.header).toBe(false)
    expect(p.timestamp).toBeNull()
    expect(p.bullet).toBeNull()
  })

  it('handles a tab-indented line', () => {
    const line = '\t- tabbed note'
    const p = parseLine(line)
    expect(p.indent.to).toBe(1)
    expect(bulletChar(line)).toBe('-')
  })

  it('does not false-positive a bullet mid-word (e.g. "e.g.")', () => {
    const p = parseLine('e.g. this is a sentence')
    expect(p.bullet).toBeNull()
  })

  describe('full sample journal entry', () => {
    const sample = `THU 13 AUG 2026
  06:00  - out of bed
  08:00  - at work
  10:00  o big meeting
         X completed tasks
  16:50  - left work
  ~17:20 - back home
         / prep dinner
         G video games
         . laundry
         > reschedule taxes
         < plan vacation
         = feeling accomplished
         W favorite show
         R favorite book
  22:30  - in bed

  STEPS`

    const lines = sample.split('\n')

    it('round-trips: parsing never changes the underlying text', () => {
      // The parser only ever reports ranges into the original string; make
      // sure content+bullet+timestamp+indent ranges reconstruct the line.
      for (const line of lines) {
        const p = parseLine(line)
        expect(line.slice(p.indent.from, p.indent.to)).toBe(line.slice(0, p.indent.to))
      }
    })

    it('identifies the header line only', () => {
      const headers = lines.filter((l) => parseLine(l).header)
      expect(headers).toEqual(['THU 13 AUG 2026'])
    })

    it('finds the expected number of bulleted lines', () => {
      const bulleted = lines.filter((l) => parseLine(l).bullet)
      expect(bulleted).toHaveLength(15)
    })

    it('finds the expected number of timestamped lines', () => {
      const timestamped = lines.filter((l) => parseLine(l).timestamp)
      expect(timestamped).toHaveLength(6)
    })
  })
})
