# Adams Web Searcher

A Cloudflare Pages web app that lets engineers search the NRC ADAMS document database
in plain language. Claude drives the search server-side (on the operator's paid API
tokens), using the real `adams-search-api` skill as its playbook and calling the ADAMS
API directly. Output is a plain-language analysis the user can save as a bookmarked PDF.

## Local development

```
npm install
npm run dev          # serves on http://localhost:8788
```

`npm run dev` automatically re-bundles the skill + reference files first (see below). You need a `.dev.vars` file (git-ignored) with the two secrets:

```
ANTHROPIC_API_KEY = "sk-ant-…"
ADAMS_API_KEY     = "…"          # ADAMS APS subscription key
```

These are read **server-side only**, in the Pages Functions under `functions/api/`.
They never reach the browser. **Never commit `.dev.vars`.**

## The skill is the source of truth — and now lives in this repo

The app does **not** paraphrase the search methodology in code. The real
`adams-search-api` skill is embedded verbatim as the model's system prompt. It began as
a copy of the `adams-search-api` Cowork skill, but it is **no longer synced from Cowork**
— the team app owns its own copy in this repo and is free to diverge.

You edit the skill as plain Markdown; a small build step bundles it into the JS the app
imports. Both the skill and the references work exactly the same way — in-repo Markdown
source → generated `lib/*.js`:

| Edit this (source) | Run this | Generates (deployed) |
|---|---|---|
| `skill/adams-search-api.md` | `npm run sync-skill` | `lib/skill.js` |
| any `.md` in `references/` | `npm run sync-refs` | `lib/references.js` |

Both sources are **in this repo** — neither reads from Cowork or any external path.
`npm run dev` runs `npm run sync` (both generators) for you via the `predev` hook, so
local dev always reflects your latest edits. You rarely need to run them by hand.

## Shipping a skill change to production

```
# 1. edit skill/adams-search-api.md (plain Markdown)
npm run sync-skill           # regenerate lib/skill.js (or just start the dev server)
git add skill/adams-search-api.md lib/skill.js   # commit BOTH the source and the artifact
git commit -m "Skill: <what changed>"
git push                     # Cloudflare Pages auto-deploys from the connected repo
```

`lib/skill.js` is the committed artifact that actually deploys — Cloudflare's build
servers run no generator, so whatever `lib/skill.js` you push is exactly what ships. If
you edit the `.md` but forget to regenerate, you'll commit a stale `lib/skill.js`;
`npm run dev` regenerates it for you, which is the easy safeguard.

> **Committed, not ignored:** the Markdown sources (`skill/`, `references/`) **and** the
> generated `lib/skill.js` / `lib/references.js` are all intentionally tracked in git.
> The generated files are what deploy — do not add them to `.gitignore`.

## Deployment

Cloudflare Pages, building from the connected GitHub repo:

- **Build output directory:** `public` (see `wrangler.toml`)
- **Functions:** `functions/api/` (server-side; hold the two secrets as encrypted
  Pages Secrets — set them in the Cloudflare dashboard, the production analog of
  `.dev.vars`)
- No build/compile step regenerates the skill — the committed `lib/*.js` deploy as-is.

A manual deploy from your machine is also available: `npm run deploy`.

## Architecture (one paragraph)

Single endpoint `POST /api/agent` runs **one** model turn per call; the browser owns
the loop (each call stays short to dodge Function timeouts). The model gets the skill +
bundled Hatch references as a cached system prompt and two tools — `adams_search` and
`adams_get_document` — executed server-side where the keys live. The skill's human
gates (confirm plan, confirm documents to open) are natural pause points: the model
ends its turn and the browser shows a reply box. The final report renders to a
bookmarked PDF entirely client-side (jsPDF, vendored in `public/vendor/`) — zero model
tokens.
