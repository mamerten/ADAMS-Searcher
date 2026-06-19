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

`npm run dev` automatically re-bundles the reference files first (see below). You need a `.dev.vars` file (git-ignored) with the two secrets:

```
ANTHROPIC_API_KEY = "sk-ant-…"
ADAMS_API_KEY     = "…"          # ADAMS APS subscription key
```

These are read **server-side only**, in the Pages Functions under `functions/api/`.
They never reach the browser. **Never commit `.dev.vars`.**

## The skill is the source of truth — and now lives in this repo

The app does **not** paraphrase the search methodology in code. The real
`adams-search-api` skill is embedded verbatim as the model's system prompt, in
`lib/skill.js` — and **that file is now hand-maintained in this repo.** It began as a
copy of the `adams-search-api` Cowork skill, but the auto-sync tool (`gen-skill.mjs`)
has been removed on purpose: this team app is meant to evolve independently of the
personal Cowork skill, so the two can diverge.

| File | Source | How to change it |
|---|---|---|
| `lib/skill.js` | **hand-edited here** — no longer synced from Cowork | edit the file directly |
| `lib/references.js` | every `.md` in `references/` | edit/add a `.md`, then `npm run sync-refs` |

The reference bundle still auto-builds from the in-repo `references/` folder (it has no
external dependency): `npm run dev` runs `npm run sync-refs` for you via the `predev`
hook. To update a reference file, drop the new `.md` into `references/` and the next run
bundles it.

## Shipping a skill change to production

The skill lives only in `lib/skill.js`, so shipping a change is a normal edit-commit-push:

```
# edit lib/skill.js directly, then:
git add lib/skill.js
git commit -m "Skill: <what changed>"
git push                     # Cloudflare Pages auto-deploys from the connected repo
```

The committed `lib/skill.js` is exactly what deploys — there is no build step that
regenerates it, and Cloudflare has nothing else to rebuild it from. What you commit is
what ships.

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
