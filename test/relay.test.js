// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { connect } from '../src/relay.js'

// jsdom's window.parent === window by default (no real iframe), so these
// tests exercise the standalone branch of connect() -- the same branch a
// real browser takes when the plugin is opened directly rather than
// embedded by the Standard Notes host. The real-app (ComponentRelay) branch
// needs a live postMessage handshake and is covered by manual/on-device
// verification instead, consistent with how the rest of relay.js is tested.

beforeEach(() => {
  window.localStorage.clear()
})

describe('connect() hanging-indent preference (standalone mode)', () => {
  it('reports the default (true) on first connect when nothing is stored', () => {
    const onHangingIndentPref = vi.fn()
    connect({ onNote: vi.fn(), onSpellcheck: vi.fn(), onHangingIndentPref })

    expect(onHangingIndentPref).toHaveBeenCalledWith(true)
  })

  it('setHangingIndentPref persists so a later connect() sees the stored value', () => {
    // Regression coverage for the real bug this preference's whole storage
    // strategy exists to fix: inside the real app, this same round-trip
    // goes through the host's component data instead of localStorage (see
    // relay.js), specifically because localStorage didn't survive a note's
    // iframe being torn down and recreated on navigation. This test only
    // covers the standalone/localStorage half of that fix, but pins down
    // the contract setHangingIndentPref() must honor either way: what you
    // set is what the next connect() reports.
    const first = connect({ onNote: vi.fn(), onSpellcheck: vi.fn(), onHangingIndentPref: vi.fn() })
    first.setHangingIndentPref(false)

    const onHangingIndentPref = vi.fn()
    connect({ onNote: vi.fn(), onSpellcheck: vi.fn(), onHangingIndentPref })

    expect(onHangingIndentPref).toHaveBeenCalledWith(false)
  })
})
