# Clark

A personal Project Gutenberg e-reader: search the catalog, add books to a shelf, read with a cleaner typographic experience than gutenberg.org, resume exactly where you left off across devices, and highlight passages with comments that click back to the source location.

Full product scope and design reasoning: [SCOPE.md](./SCOPE.md).

## Stack

Cloudflare Pages (static frontend) + Pages Functions (API proxy) + Baserow (Books/Highlights tables) + Cloudflare R2 (cached book text). PIN-gated, single-user, no framework, no build step.

## Local dev

```
npm install
npm run dev   # http://localhost:8808
```

Requires a `.dev.vars` file (gitignored, never committed):

```
PIN=<your dev PIN>
BASEROW_TOKEN=<Baserow database token>
BASEROW_API_URL=https://api.baserow.io
BASEROW_BOOKS_TABLE_ID=<Books table id>
BASEROW_HIGHLIGHTS_TABLE_ID=<Highlights table id>
```

`wrangler pages dev` emulates the R2 binding locally — no extra setup needed for the `BOOK_CACHE` bucket in dev.

## One-time setup (production)

**Baserow** — create a database with two tables:

`Books`

| Field | Type |
|---|---|
| `title` | Single line text (primary) |
| `gutenberg_id` | Number, integer |
| `author` | Single line text |
| `status` | Single select: `available`, `reading`, `finished` |
| `date_started`, `date_finished` | Date |
| `last_block_index` | Number, integer |
| `source_type` | Single select: `html`, `text` |
| `render_mode` | Single select: `reflow`, `preserve` |
| `block_overrides` | Long text (JSON) |

`Highlights`

| Field | Type |
|---|---|
| (primary field — anything, e.g. an autonumber `highlight_id`) | |
| `book` | Link to table → Books (single relationship, not multiple) |
| `block_index` | Number, integer |
| `passage_text` | Long text |
| `comment` | Long text |

Create a database token scoped to this database with full CRUD (Baserow → Settings → Database tokens).

**Cloudflare** — create the R2 bucket and Pages project, then set production secrets:

```
npx wrangler r2 bucket create clark-book-cache
npx wrangler pages project create clark --production-branch main

npx wrangler pages secret put PIN --project-name clark
npx wrangler pages secret put BASEROW_TOKEN --project-name clark
npx wrangler pages secret put BASEROW_API_URL --project-name clark
npx wrangler pages secret put BASEROW_BOOKS_TABLE_ID --project-name clark
npx wrangler pages secret put BASEROW_HIGHLIGHTS_TABLE_ID --project-name clark
```

**GitHub Actions deploy** — `.github/workflows/deploy.yml` deploys on push to `main`. Requires two repo secrets:

- `CLOUDFLARE_API_TOKEN` — a token scoped to Account → Cloudflare Pages → Edit
- `CLOUDFLARE_ACCOUNT_ID` — from `npx wrangler whoami`

```
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

## Notes

- Gutenberg's own redirect chains are occasionally malformed (a backend inconsistency on their end returns a `Location` header with two URLs mashed together) — `functions/api/books/[id]/content.js` follows redirects manually and defensively rather than trusting `fetch()`'s automatic handling.
- Cloudflare's production `fetch()` is stricter about following an https→http→https redirect downgrade than local dev's Miniflare simulation — same file, same fix.
