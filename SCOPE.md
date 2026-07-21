# Clark — Scope Doc

Project Gutenberg e-reader. Named Clark (2026-07-16).

Status: **scoped, not started.** Paused intentionally until Brandon's Claude subscription rolls to the next billing cycle. This doc is the handoff — a future session should be able to build from this without re-deriving the reasoning.

## What this is

An "e-reader" for Project Gutenberg texts: nicer reading experience than gutenberg.org itself, tracks a personal reading "shelf" (available / reading / finished), remembers reading position per book across devices, and lets Brandon highlight passages with comments — click a highlight to jump back to it in the text. Primary use case is being well-read in classics (fiction and poetry) and capturing well-turned phrases — **not** a study/spaced-repetition tool.

## Precedent apps (reference for architecture and look/feel)

Three prior Claude-Code-built apps establish the pattern; details in memory (`project_cannon-app.md`, `project_winston-app.md`, `bits-capture-pwa.md`):

- **Bits** (`~/Projects/bits`) — quick-capture PWA, Cloudflare Pages + Functions + Baserow, PIN auth. ~880 lines.
- **Cannon** (`~/Projects/cannon`) — Gospel Library highlights reader, CSV-imported into Baserow. Same web shape. ~1,100 lines.
- **Winston** (`~/Projects/winston`) — Kindle highlights reader, Playwright-synced into Baserow. Same web shape. ~1,250 lines.

**Reuse directly from Cannon/Winston:** PIN unlock screen, sticky topbar + tabs shell, card list styling, comment-autosave pattern (800ms debounce), theme (light/dark via `prefers-color-scheme`, blue accent `#2563eb` / `#5b9bff` dark, system font, 720px max-width centered shell).

**Explicitly not reusing:** Cannon/Winston's spaced-repetition "Review" tab (Today's Review / All Starred / Shuffle) — decided out of scope; this app is about reading pleasure, not review/recall.

**Net-new vs. all three precedents:** none of Bits/Cannon/Winston render the source document itself — they only manage highlights/notes about content read elsewhere. This app's reading pane (continuous scroll through the actual book, block-level rendering, position tracking) has no analog in any of them and is where nearly all the new engineering effort concentrates.

## Architecture

- Cloudflare Pages (static frontend) + Pages Functions (backend proxy — keeps Baserow token server-side)
- Baserow (paid account — no rate-limit or quota concern at this usage scale) for the Books and Highlights tables
- Cloudflare KV or R2 for caching fetched/cleaned book text (R2 preferred: no egress fees, 10GB/1M-ops free tier is far more than a personal library needs)
- PIN auth, single-user (matches Bits/Cannon/Winston; not building multi-user)

**Cost:** verified against current docs — comfortably free-tier on both Cloudflare (100K Functions requests/day, R2/KV free tiers) and Baserow (paid plan; even free hosted plan has no hard API quota, just a 10-concurrent-request fairness cap) at personal single-user scale. Not a real constraint. See `reference_baserow-paid-account.md`.

**Why web app, not Electron:** considered explicitly. Electron would remove the hosting/auth/proxy layer, but is desktop-only — no iPad/iPhone reach, which matters for a reading app. Cross-device resume (see below) also requires a network-backed sync layer regardless of native vs. web, so Electron doesn't actually remove that complexity, just adds packaging/distribution burden on top. Web/PWA won on device reach.

## Catalog & content pipeline

- Search/browse via [Gutendex](https://gutendex.com) (unofficial JSON API over the full Gutenberg catalog) — full catalog shown, **not filtered** by format availability
- Format badge (HTML vs. text-only) shown per title in search results / book detail, so Brandon knows what he's getting before committing — informational, not a filter
- On "start reading": fetch the book from Gutenberg, preferring the HTML mirror; fall back to plain text if no HTML exists (roughly 70%+ of the catalog by volume may be plaintext-only depending on age/popularity of the transcription — this is a real, regularly-hit path, not a rare edge case)
- Strip Gutenberg's standard boilerplate header/footer (`*** START/END OF THIS PROJECT GUTENBERG EBOOK ***`)
- Parse into **blocks** (blank-line-delimited — this is the single anchor unit used for both resume-position and highlights)
- Cache the cleaned raw text (post-boilerplate-strip, pre-render) in KV/R2 keyed by Gutenberg ID — fetch/clean once per book, not per session

## Rendering: HTML vs. plaintext sources

This was the trickiest design thread — worth preserving the reasoning, not just the conclusion.

- **HTML-sourced books:** render the HTML mostly as-is. HTML doesn't have Gutenberg's plaintext hard-wrap artifact (~70-char fixed width), so there's no "reflow" ambiguity — a browser naturally reflows `<p>` text, and if the transcriber marked verse with per-line `<br>`, that's preserved automatically with zero detection logic needed on our end.
- **Plaintext-sourced books:** the hard-wrap problem is real — undoing it (joining wrapped lines into flowing paragraphs) is necessary for prose but destroys a poem's meaningful line breaks if applied uniformly. Rejected an automatic line-length-variance heuristic (fragile, needed tuning) in favor of **manual control**:
  - Whole-book **render mode** toggle chosen at start-reading time: *Reflow* (narrative/prose — join wrapped lines into paragraphs) vs. *Preserve* (poetry — keep every line break)
  - Per-block **override**: if a specific block renders wrong (e.g. a poem embedded in an otherwise-prose novel, or vice versa — a real case, not hypothetical, per the Shakespeare discussion), click that one block to flip just its rendering without affecting the rest of the book
  - Block boundaries (blank-line splits) are identical regardless of render mode — only a block's *internal* line-joining changes — so toggling mode or overriding a block never shifts anchor indices or breaks existing highlights
  - Stored as: `render_mode` field on the book + a sparse block-index-to-mode override map (not a separate table)

## Data model (Baserow)

**`Books`**
- gutenberg_id, title, author
- status: available / reading / finished
- date_started, date_finished
- last_block_index (resume position anchor)
- render_mode: reflow / preserve (plaintext books only)
- block_overrides: sparse map, block index → overridden mode

**`Highlights`**
- linked to Books
- block_index (anchor — same unit as resume position)
- passage text (snapshotted at creation time, so it still reads correctly even if parsing logic changes later)
- comment
- created_date

## Reading experience (v1)

- Continuous scroll, clean typography, paragraph/stanza spacing
- Chapter headings kept where source markup makes them obvious; **no table of contents / chapter navigation in v1**
- Highlights are **block-level**, not precise character-range (a whole paragraph/stanza highlights as a unit — like Kindle's coarse mode, not exact-selection underlining). Simpler and more robust than character-offset anchoring across reflow.
- Click a highlight (from a highlights list/panel) → jumps back to that block in the reader and briefly flashes it
- **Multiple books can be "reading" simultaneously** — status is per-book, not exclusive. Matters because poetry collections in particular aren't read front-to-back. Shelf view needs a "Currently Reading" section listing all active books (not a single slot), not just one.

## Position tracking & cross-device sync

- Anchor = block index, written to the book's Baserow row
- Writes are **debounced** (not per-scroll-tick) to avoid excessive API chatter
- On mobile specifically, trigger the save on the `visibilitychange` event (fires reliably when Safari backgrounds a tab/PWA), not just a scroll-stop timer or `beforeunload` — iOS doesn't reliably fire unload events, so tying the save to backgrounding is what makes iPad → iPhone handoff actually reliable
- Because position lives in shared Baserow (not per-device storage), opening the book on a different device reads the same last-written position — this is precisely why the web/Baserow approach was chosen over a local-only native app
- Precision is block-level, not pixel/word-level — equivalent to a physical bookmark landing on the right page, not the exact line. Confirmed acceptable.
- Known edge case, accepted as low-risk: if the book were somehow open on two devices simultaneously, last write wins. Not a real risk for actual sequential single-person usage.

## Explicitly out of scope for v1

- Spaced-repetition/flashcard "Review" tab (present in Cannon/Winston, not wanted here)
- Table of contents / chapter navigation
- Precise character-range highlight selection (block-level only)
- Automatic heuristic detection of verse vs. prose (replaced by manual toggle + per-block override)
- Drama/multi-register-specific tuning beyond the general toggle+override mechanism (not near-term reading material)
- Multi-user support (single-user, PIN-gated, like Bits/Cannon/Winston)

## Rough size estimate

Measured against the three precedent apps (actual line counts): Bits ~880, Cannon ~1,100, Winston ~1,250 total lines. This app should land around **~1,700–2,000 lines** — roughly 1.5–2x Winston, the largest precedent. The PIN/theme/Baserow-CRUD/card-list scaffolding (~1,000 lines' worth) is close to free reuse; nearly all the growth is in the parsing pipeline (fetch → boilerplate-strip → block-split → HTML/plaintext branch → cache, ~150–250 lines with no real analog in any precedent) and the reading pane itself (continuous rendering, position tracking, inline highlight creation, click-to-jump, ~250–350 lines — genuinely new, since none of the three precedents render source documents). Treat as planning-grade, not committed.

## Before building: open items

- Set up Baserow base + Books/Highlights tables per the schema above
- Set up Cloudflare Pages project + R2 bucket + PIN secret (mirror Bits/Cannon/Winston's env var pattern)
- Decide exact boilerplate-strip regex and block-splitting logic against a couple of real Gutenberg sample texts (one HTML, one plaintext prose, one plaintext verse) before writing the parser generally
