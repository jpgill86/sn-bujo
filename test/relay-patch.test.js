// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import ComponentRelay from '@standardnotes/component-relay'
import '../src/relay.js' // side effect: patches ComponentRelay.prototype.postMessage

// Regression coverage for a real bug (twice over): @standardnotes/component-
// relay@2.2.2 calls postMessage(payload, this.component.origin) with no
// fallback, which throws when origin is the literal string "null" (what
// Android's WebView reports as the host's origin). Our first fix patched
// this by permanently overwriting this.component.origin to '*' -- which
// fixed the crash but silently broke every *incoming* message afterward,
// since the library also compares event.origin against this same stored
// value to decide whether to accept a message, and a real origin never
// equals '*'. The corrected patch (src/relay.js) must substitute the
// fallback only for the duration of the one outgoing call and restore the
// real value immediately after.

describe('component-relay postMessage origin patch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses "*" for the outgoing call but restores the original "null" origin afterward', () => {
    const relay = new ComponentRelay({
      targetWindow: window,
      handleRequestForContentHeight: () => undefined,
    })
    relay.component.sessionKey = 'test-session'
    relay.component.origin = 'null'

    const postMessageSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

    relay.postMessage('test-action', {})

    expect(postMessageSpy).toHaveBeenCalledTimes(1)
    expect(postMessageSpy.mock.calls[0][1]).toBe('*')
    // The critical part: incoming-message matching (event.origin ===
    // this.component.origin) must still see the real "null" value, not the
    // '*' substitution, or every future message from the host gets dropped.
    expect(relay.component.origin).toBe('null')
  })

  it('leaves a real origin untouched', () => {
    const relay = new ComponentRelay({
      targetWindow: window,
      handleRequestForContentHeight: () => undefined,
    })
    relay.component.sessionKey = 'test-session'
    relay.component.origin = 'https://app.standardnotes.com'

    const postMessageSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

    relay.postMessage('test-action', {})

    expect(postMessageSpy.mock.calls[0][1]).toBe('https://app.standardnotes.com')
    expect(relay.component.origin).toBe('https://app.standardnotes.com')
  })
})
