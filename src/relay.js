import ComponentRelay from '@standardnotes/component-relay'

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
const originalPostMessage = ComponentRelay.prototype.postMessage
ComponentRelay.prototype.postMessage = function patchedPostMessage(...args) {
  if (!this.component.origin || this.component.origin === 'null') {
    this.component.origin = '*'
  }
  return originalPostMessage.apply(this, args)
}

const STANDALONE_STORAGE_KEY = 'sn-bujo-standalone-note'

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
 * @param {{onNote: (text: string) => void, onSpellcheck: (enabled: boolean) => void, onSaveStatus?: (status: 'saving' | 'saved') => void, onDiag?: (stage: string) => void}} handlers
 * @returns {{ save: (text: string) => void }}
 */
export function connect({ onNote, onSpellcheck, onSaveStatus, onDiag }) {
  const isStandalone = window.parent === window
  onDiag?.(isStandalone ? 'standalone' : 'iframe')

  if (isStandalone) {
    const stored = window.localStorage.getItem(STANDALONE_STORAGE_KEY)
    onNote(stored ?? SAMPLE_NOTE)
    onSpellcheck(true)
    return {
      save(text) {
        onSaveStatus?.('saving')
        window.localStorage.setItem(STANDALONE_STORAGE_KEY, text)
        onSaveStatus?.('saved')
      },
    }
  }

  let note = null

  const relay = new ComponentRelay({
    targetWindow: window,
    onReady: () => onDiag?.('ready'),
    // We're a full-pane editor (area: "editor-editor"): our own layout
    // already fills 100% of the iframe and scrolls internally via
    // CodeMirror's own scroller, so we don't want the host resizing the
    // iframe to fit all content. Returning a real scrollHeight-based value
    // here caused notes with real content (but not empty ones) to render
    // blank on Android -- the mobile app appears to actually apply this
    // height to the native WebView, unlike desktop/web where it's ignored
    // for full-pane editors. Returning undefined matches the pattern used
    // by com.sncommunity.advanced-checklist, an official full-pane-style
    // editor confirmed working on Android.
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
  }
}
