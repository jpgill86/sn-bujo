// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readHangingIndent, writeHangingIndent } from '../src/prefs.js'

beforeEach(() => {
  window.localStorage.clear()
})

describe('readHangingIndent / writeHangingIndent', () => {
  it('defaults to true when nothing has been stored yet', () => {
    expect(readHangingIndent()).toBe(true)
  })

  it('round-trips a written value', () => {
    writeHangingIndent(false)
    expect(readHangingIndent()).toBe(false)

    writeHangingIndent(true)
    expect(readHangingIndent()).toBe(true)
  })

  describe('when localStorage access throws', () => {
    // Real-world cause: DOM storage disabled in a WebView, or an opaque
    // iframe origin -- see src/relay.js for other origin quirks this
    // component has hit on Android. The editor must still open with a sane
    // default rather than crash, which is the entire reason these functions
    // wrap storage access in try/catch instead of a plain null check.
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('readHangingIndent falls back to the default instead of throwing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })

      expect(() => readHangingIndent()).not.toThrow()
      expect(readHangingIndent()).toBe(true)
    })

    it('writeHangingIndent silently no-ops instead of throwing', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })

      expect(() => writeHangingIndent(false)).not.toThrow()
    })
  })
})
