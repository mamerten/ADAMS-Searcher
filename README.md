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

`npm run dev` automatically re-syncs the bundled skill + reference files first (see
below). You need a `.dev.vars` file (git-ignored) with the two secrets:

```
ANTHROPIC_API_KEY = "sk-ant-…"
ADAMS_API_KEY     = "…"          # ADAMS APS subscription key
```

These are read **server-side only**, in the Pages Functions under `functions/api/`.
They never reach the browser. **Never commit `.dev.vars`.**

## The skill is the source of truth — how it gets into the app

The app does **not** paraphrase the search methodology in code. The real
`adams-search-api` skill is embedded verbatim as the model's system prompt. Two
generated files carry that content:

| Generated file | Built from | By |
|---|---|---|
| `lib/skill.js` | the installed `adams-search-api/SKILL.md` | `gen-skill.mjs` |
| `lib/references.js` | every `.md` in `references/` | `gen-references.mjs` |

`gen-skill.mjs` auto-discovers the **newest** `SKILL.md` under
`%APPDATA%\Claude\…\skills-plugin` — no hard-coded path. Run the sync manually with:

```
npm run sync          # both skill + references
npm run sync-skill    # skill only
npm run sync-refs     # references only
```

…but you rarely need to: `npm run dev` runs `npm run sync` for you (the `predev` hook),
so local dev always reflects the latest skill.

To update the **reference** files (e.g. the Hatch guides), drop the new `.md` into
`references/` and the next `sync` bundles it.

## Updating the skill, all the way to production

This is the important part. There are **two** sync boundaries, and only the first is
automatic:

```
  SKILL.md (in your Claude app data)        ← you edit this
        │
        │  npm run sync   (automatic on `npm run dev`)     ← BOUNDARY 1: automatic, local
        ▼
  lib/skill.js  (committed artifact)
        │
        │  git commit + git push  →  Cloudflare auto-deploy  ← BOUNDARY 2: MANUAL
        ▼
  Production
```

**Boundary 1 is automatic. Boundary 2 is not — and cannot be.** The source `SKILL.md`
lives in your local Claude app data; that path does **not** exist on Cloudflare's build
servers, so the cloud can never regenerate `lib/skill.js` itself. The committed
`lib/skill.js` is what deploys. Therefore, to ship a skill change:

```
# 1. edit the skill in Claude, then:
npm run sync                 # regenerate lib/skill.js (or just start the dev server)
git add lib/skill.js         # commit the regenerated artifact
git commit -m "Sync skill to Rev N"
git push                     # Cloudflare Pages auto-deploys from the connected repo
```

If you forget step 1, you'll commit a stale skill. The sync output prints the skill's
revision line (e.g. `"ADAMS Public Search — API Method - Rev 5"`) so you can confirm
what you're shipping.

> **Committed, not ignored:** `lib/skill.js` and `lib/references.js` are intentionally
> tracked in git. They are the deployable source of truth — do not add them to
> `.gitignore`.

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
