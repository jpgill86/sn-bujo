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
- **Header** — an unindented line naming a day of the week and containing a 4-digit year (e.g.
  `THU 13 AUG 2026`) is rendered in bold as a date header.
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

Build for production (outputs to `dist/`, including the generated `dist/sn-bujo.json` manifest):

```sh
npm run build
```

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
   the desktop app's offline install path (`download_url` in the manifest).

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

## Data-integrity guarantee

The editor reads and writes only `note.content.text` (plus `note.content.preview_plain`, the
notes-list preview snippet) — it never introduces a wrapper format, and the note's `file_type` is
declared as `txt` in the manifest. Toggling a note between this editor and Plain Text is always
lossless.

## License

[MIT](LICENSE)
