import ComponentRelay from '@standardnotes/component-relay'
import { readHangingIndent, writeHangingIndent } from './prefs.js'

// Patches a real bug in @standardnotes/component-relay@2.2.2 (the latest
// version published to npm as of writing). Its postMessage() does:
//   this.contentWindow.parent.postMessage(payload, this.component.origin)
// with no fallback. this.component.origin is set from the *first* incoming
// message's event.origin -- and on Android, the host app's reported origin
// is the literal string "null" (it's loaded in a WebView, not served over a
// real https:// origin the way desktop/web are). Passing the string "null"
// as postMessage's targetOrigin throws a synchronous, uncaught
// "Invalid target origin 'null'" SyntaxError -- confirmed via this
// project's own diagnostic trace. That exception aborts onReady() partway
// through (including the queued streamContextItem flush inside it), which
// is why the host <-> component handshake silently never completes on
// Android: every outgoing message, including the very first one, throws.
//
// The upstream GitHub repo has since fixed this (falls back to '*' when
// origin is falsy or the string "null"), but that fix has never been
// published to npm -- 2.2.2 is still the newest available version. Patch
// the one broken method in place until a fixed version ships.
//
// IMPORTANT: this.component.origin isn't only read by postMessage() -- the
// library's own incoming-message handler also compares every future
// message's event.origin against this same stored value and silently
// drops anything that doesn't match. A first version of this patch
// permanently overwrote this.component.origin to '*' the first time it saw
// a bad value, which fixed the immediate crash but then broke all
// subsequent *incoming* messages, since a real event.origin never equals
// the literal string '*'. That's a silent failure with no thrown error --
// worse than the crash it replaced. This version only substitutes the
// corrected value for the duration of the single outgoing call, then
// restores the original (even if that original is "null") immediately
// after, so incoming-message matching keeps working correctly.
const originalPostMessage = ComponentRelay.prototype.postMessage
ComponentRelay.prototype.postMessage = function patchedPostMessage(...args) {
  const realOrigin = this.component.origin
  const needsFallback = !realOrigin || realOrigin === 'null'
  if (needsFallback) this.component.origin = '*'
  try {
    return originalPostMessage.apply(this, args)
  } finally {
    if (needsFallback) this.component.origin = realOrigin
  }
}

const STANDALONE_STORAGE_KEY = 'sn-bujo-standalone-note'

// Key under the component's own persisted data (see setHangingIndentPref
// below) -- distinct from note content, and distinct from per-note appData
// like spellcheck. This is a device/editor-level display preference, not
// something tied to any one note.
const HANGING_INDENT_DATA_KEY = 'hangingIndent'

const SAMPLE_NOTE = `THU 13 AUG 2026
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

  STEPS
`

/** Build a short plain-text preview for the notes list from the first few non-blank lines. */
function buildPreview(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' • ')
    .slice(0, 200)
}

/**
 * Wire up the editor to its host: either the real Standard Notes app via
 * component-relay, or (when opened directly in a browser, e.g. `npm run dev`)
 * a localStorage-backed standalone mode so the editor is testable with no
 * app involved.
 *
 * @param {{onNote: (text: string) => void, onSpellcheck: (enabled: boolean) => void, onHangingIndentPref: (enabled: boolean) => void, onSaveStatus?: (status: 'saving' | 'saved') => void, onDiag?: (stage: string) => void}} handlers
 * @returns {{ save: (text: string) => void, setHangingIndentPref: (enabled: boolean) => void }}
 */
export function connect({ onNote, onSpellcheck, onHangingIndentPref, onSaveStatus, onDiag }) {
  const isStandalone = window.parent === window
  onDiag?.(isStandalone ? 'standalone' : 'iframe')

  if (isStandalone) {
    const stored = window.localStorage.getItem(STANDALONE_STORAGE_KEY)
    onNote(stored ?? SAMPLE_NOTE)
    onSpellcheck(true)
    onHangingIndentPref(readHangingIndent())
    return {
      save(text) {
        onSaveStatus?.('saving')
        window.localStorage.setItem(STANDALONE_STORAGE_KEY, text)
        onSaveStatus?.('saved')
      },
      setHangingIndentPref(enabled) {
        writeHangingIndent(enabled)
      },
    }
  }

  let note = null

  const relay = new ComponentRelay({
    targetWindow: window,
    onReady: () => {
      onDiag?.('ready')
      // The component's own persisted data (component.data, which is what
      // getComponentDataValueForKey reads) only becomes available right
      // before onReady fires -- reading it any earlier would always see
      // undefined. This is a device/editor-level preference stored by the
      // host itself, not local browser storage, so unlike localStorage it
      // survives regardless of whether this note's iframe gets torn down
      // and recreated on note switches (confirmed this is the real cause of
      // a bug where the hanging-indent toggle silently reverted after
      // navigating away from a note and back -- an earlier version of this
      // preference lived only in localStorage, which is exactly the kind of
      // per-iframe-instance storage that doesn't survive that).
      const stored = relay.getComponentDataValueForKey(HANGING_INDENT_DATA_KEY)
      onHangingIndentPref(stored === undefined ? true : stored)
    },
    // We're a full-pane editor (area: "editor-editor"): our own layout
    // already fills 100% of the iframe and scrolls internally via
    // CodeMirror's own scroller, so we don't need the host to resize the
    // iframe to fit content. Returning undefined (rather than a computed
    // scrollHeight) matches com.sncommunity.advanced-checklist, an official
    // full-pane-style editor confirmed working on Android. This was tried
    // as a fix for the Android blank-note bug; it wasn't the actual cause
    // (see the postMessage patch below for that), but it's still the
    // simpler, more correct choice for this component's layout, so it stays.
    handleRequestForContentHeight: () => undefined,
  })
  onDiag?.('constructed')

  relay.streamContextItem((item) => {
    onDiag?.('item-received')
    note = item
    if (item.isMetadataUpdate) {
      onDiag?.('metadata-only')
      return
    }
    onNote(item.content.text ?? '')
    onDiag?.(item.content.text ? 'content-delivered' : 'content-was-empty')
    const spellcheckValue = relay.getItemAppDataValue?.(item, 'spellcheck')
    onSpellcheck(spellcheckValue !== false)
  })
  onDiag?.('stream-requested')

  return {
    save(text) {
      const capturedNote = note
      if (!capturedNote) {
        onDiag?.('save-skipped-no-note')
        return
      }
      // Standard debounced save (matches com.sncommunity.advanced-checklist,
      // confirmed working on Android). An earlier version of this code
      // bypassed the debouncer, suspecting it of losing saves on
      // navigation-triggered teardown -- that turned out not to be the
      // actual bug (see the postMessage patch above for the real one), and
      // skipping it just meant a new save-history entry on every keystroke.
      onSaveStatus?.('saving')
      relay.saveItemWithPresave(capturedNote, () => {
        capturedNote.content.text = text
        capturedNote.content.preview_plain = buildPreview(text)
      }, () => onSaveStatus?.('saved'))
    },
    setHangingIndentPref(enabled) {
      // Guard against the (unlikely but possible) case of a very fast
      // toggle before the ComponentRegistered handshake has completed --
      // setComponentDataValueForKey throws if component.data hasn't been
      // initialized yet. Losing this one toggle's persistence is harmless;
      // the editor's own display already reflects it either way.
      try {
        relay.setComponentDataValueForKey(HANGING_INDENT_DATA_KEY, enabled)
      } catch (err) {
        onDiag?.(`error: hanging-indent pref not saved (${err.message})`)
      }
    },
  }
}
