# sn-bujo — Bullet Journal editor for Standard Notes

A custom [Standard Notes](https://standardnotes.com) editor for daily bullet-journal style plain
text notes. It adds syntax highlighting — subtle timestamps, bold color-coded bullets, normal item
text — and lets you tap a task bullet to cycle its state, while keeping the note's underlying
storage **exactly the plain text you typed**. There is no hidden markup: you can switch a note
back to the built-in Plain Text editor at any time and see the identical text, and exporting a
note produces a clean `.txt` file.

> This project is not affiliated with, endorsed by, or sponsored by the Bullet Journal brand or its
> creator. "Bullet journal" here refers to the generic journaling method.

## Supported format

```
THU 13 AUG 2026
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
```

- **Timestamps** — `HH:MM`, optionally 12-hour with `am`/`pm`, optionally prefixed with `~` to mark
  it as approximate. Rendered in a subtle gray — exact and approximate timestamps look identical;
  the `~` in the text already says "approximate," so there's no separate visual treatment.
- **Bullets** — a single character followed by a space (or end of line):

  | bullet | meaning |
  |---|---|
  | `-` | note |
  | `o` | event |
  | `.` | task, not started |
  | `/` | task, in progress |
  | `X` | task, done |
  | `>` | task, migrated (moved to a later date) |
  | `<` | task, scheduled (moved earlier, e.g. to a future log) |
  | `=` | feeling |
  | `G` | gaming session |
  | `W` | watching (movie/TV) |
  | `R` | reading session |

  Bullets are rendered bold, each in its own color. Any other single punctuation character, or a
  single uppercase letter (other than `A`/`I`, so ordinary sentences aren't misread), is still
  highlighted as a bullet — so inventing a new bullet type just works without editing the plugin.
- **Tap-to-cycle** — tapping/clicking directly on one of the five task bullets (`.` `/` `X` `>`
  `<`) advances it to the next state in that order, wrapping from `<` back to `.`. A brief flash
  confirms the change. This is the only interactive behavior in the editor; every other bullet is
  inert when tapped, and everywhere else the document behaves exactly like plain text — arrow
  keys, Backspace, selection, and typing all work on the bullet character normally, since it's
  never anything but an ordinary character in the underlying text. See
  [`src/cycle.js`](src/cycle.js) for the implementation and the guards against accidental taps
  (right-click, drag, double-click, an active selection, etc.).
- **Undo/Redo toolbar** — two buttons above the text, always visible. Ctrl+Z/Ctrl+Y still work on
  desktop, but this is the only undo available at all on Android, where the on-screen keyboard has
  no undo key — including as the recovery path for an accidental tap-to-cycle. The buttons never
  steal focus or close the on-screen keyboard, and gray out when there's nothing to undo/redo. See
  [`src/toolbar.js`](src/toolbar.js).
- **Hanging indent** — a wrapped line's continuation aligns under the item's text instead of
  running back to the left margin, so long entries stay easy to scan. Toggle it with the third
  toolbar button (on by default; your choice is remembered across notes and sessions). Purely a
  rendered offset — no characters are added to the document, so the stored note and the Plain Text
  editor are unaffected either way. See [`src/indent.js`](src/indent.js).
- **Header** — an unindented line naming a day of the week and containing a 4-digit year (e.g.
  `THU 13 AUG 2026`) is rendered in bold as a date header. Anything after the date (e.g. `THU 13
  AUG 2026  WEEK 33  SO-AND-SO'S BIRTHDAY`) stays bold but renders in a slightly muted shade —
  darker in a dark theme, lighter in a light theme — to set it apart from the date itself.
- Everything else — indentation, item text, blank lines — is left as ordinary text, untouched.

The parser lives entirely in [`src/bujo.js`](src/bujo.js), independent of the editor UI; see
[`test/bujo.test.js`](test/bujo.test.js) for the full behavior spec.

## Local development

Requires Node 20+.

```sh
npm install
npm run dev
```

This starts a Vite dev server on `http://localhost:8001` with CORS enabled and a dev
[`ext.json`](public/ext.json) served alongside it.

- **Standalone**: open `http://localhost:8001` directly in a browser. The editor runs with no
  Standard Notes app involved, seeded with the sample journal above, and persists to
  `localStorage` — this is the fast loop for iterating on highlighting.
- **Inside Standard Notes**: Extensions (bottom-left) → Import Extension → paste
  `http://localhost:8001/ext.json` → Enter. Open any note → Editor menu → Bullet Journal.

Run the parser test suite:

```sh
npm test
```

Build for production (outputs to `dist/`, including the generated `dist/sn-bujo.json` manifest and
`dist/sw.js` service worker):

```sh
npm run build
```

To verify offline behavior, the dev server won't do — it deliberately never registers a service
worker (see "Offline support" below), so use a production build instead:

```sh
npm run build
npm run preview
```

Open `http://localhost:8001`, let it load once, then in DevTools → Application → Service Workers
confirm it's registered and activated, and in the Network tab check "Offline" and reload — the
editor should still load and work.

## Installing on a machine (production)

Once a version has been released (see below), install from the hosted manifest:

Extensions → Import Extension → `https://jpgill86.github.io/sn-bujo/sn-bujo.json`

Because `latest_url` in the manifest points at this same URL, the app will pick up future version
bumps automatically — no need to reinstall on each machine.

## Releasing a new version

1. Bump `"version"` in `package.json`.
2. Commit, then tag and push:
   ```sh
   git tag vX.Y.Z
   git push origin main --tags
   ```
3. GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) builds the
   plugin, publishes `dist/` to GitHub Pages, and attaches a `sn-bujo-dist.zip` to the release for
   the desktop app's offline install path (`download_url` in the manifest). The build also
   generates `dist/sw.js` (see "Offline support" below); no separate release step needed.

One-time setup: in the repo's Settings → Pages, set Source to "GitHub Actions".

## Status indicators

Two small, unobtrusive readouts live at the bottom of the editor:

- **Save status** (bottom-right) — appears only while relevant: "Saving…" while an edit is in
  flight, then "Saved HH:MM:SS" once the host confirms it, then hides itself again after ~2s. A
  quick sanity check that edits are actually reaching the host, not just displayed locally — this
  is a stronger signal than the app's own sync indicator, which reflects host-level sync status
  rather than specifically whether *this* plugin's save round-trip to the host succeeded.
- **Connection trace** (bottom-left) — hidden by default. It records each host↔component
  handshake milestone as it happens and only reveals itself if something goes wrong: a thrown
  error, or no sign of life from the host within a few seconds (some failures — see
  [`src/relay.js`](src/relay.js) — never throw, so this isn't limited to reacting to errors).
  If you ever see it, whatever it stopped at is where the connection broke.

## Offline support

The plugin is loaded by the host app as a live iframe (`src` pointing at the URL in the manifest),
so with no caching it fails to load at all with no network connection — unlike Standard Notes'
built-in Plain Text editor, which ships inside the host app itself. [`src/sw.js`](src/sw.js), a
hand-rolled service worker (built via [`scripts/build-sw.mjs`](scripts/build-sw.mjs)), caches this
plugin's own HTML/CSS/JS shell so it keeps working after a successful online load. Note content
itself was never affected by this — it flows through `@standardnotes/component-relay`'s
`postMessage` protocol, not a network fetch.

⚠️ **Confirmed not working on the Standard Notes Android app as of this writing.** The app embeds
this plugin's iframe with a `sandbox` attribute that omits `allow-same-origin`, which disables
Service Workers entirely — `navigator.serviceWorker` throws a `SecurityError` on access
(`"Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin'
flag"`). This is a host-level restriction; no code change in this plugin can work around it. It's a
long-standing, previously-acknowledged limitation of the mobile app for remotely-loaded editor
plugins generally (not specific to this plugin — see
[standardnotes/forum#3925](https://github.com/standardnotes/forum/issues/3925), where the same
failure is reported for a different editor, and the older
[standardnotes/forum#2040](https://github.com/standardnotes/forum/issues/2040) /
[#827](https://github.com/standardnotes/forum/issues/827) discussions of offline editor support on
mobile going back to 2018). The service worker code stays in this repo anyway: it works correctly
on desktop and web (verified, including as a third-party iframe embed, which is the storage
partitioning shape closest to how the host actually loads it), degrades to today's online-only
behavior with no user-visible error wherever Service Workers aren't available, and would start
working automatically on mobile too if Standard Notes ever adds `allow-same-origin`.

A few things worth knowing:
- **One successful online load is required first** on any platform where it *does* work, and
  separately for each context you use it in — opening the plugin in the Standard Notes app and
  opening `https://jpgill86.github.io/sn-bujo/` directly in a browser tab are different storage
  partitions; each needs its own online load before it can work offline.
- A newly released version becomes visible on the *next* load after it's fetched, since the cache
  is served cache-first (deliberately, so a weak/flaky connection can't hang a load the way
  network-first would — see `src/sw.js` for the reasoning).
- If service worker registration fails or isn't available, the editor just behaves exactly as
  before: online-only, no error shown to the user. `sw-registered` / `sw-active` /
  `sw-install-failed` / `sw-unsupported` / `sw-failed: ...` are recorded in the connection trace
  (below), but — like every other non-error stage — don't cause it to auto-reveal; a failed or
  unsupported service worker isn't user-facing breakage, and the iframe is recreated per note open,
  so auto-revealing on every `sw-*` stage would nag constantly on any platform that blocks service
  workers. Inspect the trace element via remote devtools if you need to confirm which stage a given
  platform reaches.

## Data-integrity guarantee

The editor reads and writes only `note.content.text` (plus `note.content.preview_plain`, the
notes-list preview snippet) — it never introduces a wrapper format, and the note's `file_type` is
declared as `txt` in the manifest. Toggling a note between this editor and Plain Text is always
lossless.

## License

[MIT](LICENSE)
