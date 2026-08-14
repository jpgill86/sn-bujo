import ComponentRelay from '@standardnotes/component-relay'

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
 * @param {{onNote: (text: string) => void, onSpellcheck: (enabled: boolean) => void}} handlers
 * @returns {{ save: (text: string) => void }}
 */
export function connect({ onNote, onSpellcheck }) {
  const isStandalone = window.parent === window

  if (isStandalone) {
    const stored = window.localStorage.getItem(STANDALONE_STORAGE_KEY)
    onNote(stored ?? SAMPLE_NOTE)
    onSpellcheck(true)
    return {
      save(text) {
        window.localStorage.setItem(STANDALONE_STORAGE_KEY, text)
      },
    }
  }

  let note = null

  const relay = new ComponentRelay({
    targetWindow: window,
    onReady: () => {},
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

  relay.streamContextItem((item) => {
    note = item
    if (item.isMetadataUpdate) return
    onNote(item.content.text ?? '')
    const spellcheckValue = relay.getItemAppDataValue?.(item, 'spellcheck')
    onSpellcheck(spellcheckValue !== false)
  })

  return {
    save(text) {
      const capturedNote = note
      if (!capturedNote) return
      // Deliberately not saveItemWithPresave, which always debounces
      // (coallesedSavingDelay, 250ms by default) with no way to opt out.
      // component-relay's own streamContextItem only flushes a pending
      // debounced save early when it lives long enough to see the *next*
      // context-item message -- if the host tears the iframe down on
      // navigation before that message and before the debounce timer
      // fires, the pending setTimeout is destroyed with it and the save
      // never reaches the host at all. That caused real data loss on
      // Android: content typed into a note vanished after simply
      // navigating away and back. skipDebouncer sends every edit
      // immediately instead, trading a bit of message-passing efficiency
      // for not losing content.
      relay.saveItems([capturedNote], undefined, true, () => {
        capturedNote.content.text = text
        capturedNote.content.preview_plain = buildPreview(text)
      })
    },
  }
}
