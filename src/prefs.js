// Device-local editor preferences (not part of the note content, so these
// live in localStorage rather than the note itself).

const HANGING_INDENT_KEY = 'sn-bujo-hanging-indent'

/**
 * Whether wrapped lines should hang-indent under the item text. Defaults to
 * true (the more readable rendering) when nothing has been stored yet.
 *
 * Wrapped in try/catch, not just a null check: localStorage access can
 * *throw* (SecurityError) rather than just return null, e.g. under DOM
 * storage disabled in a WebView, or an opaque iframe origin -- relay.js
 * already documents this component seeing origin quirks inside the Android
 * host app, so this isn't defensive boilerplate for a case that can't
 * happen. The editor must still open with a sane default either way.
 */
export function readHangingIndent() {
  try {
    const raw = window.localStorage.getItem(HANGING_INDENT_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

/** Persist the hanging-indent toggle. Failure is silently ignored -- see readHangingIndent(). */
export function writeHangingIndent(enabled) {
  try {
    window.localStorage.setItem(HANGING_INDENT_KEY, String(enabled))
  } catch {
    // Losing persistence of one display preference is harmless.
  }
}
