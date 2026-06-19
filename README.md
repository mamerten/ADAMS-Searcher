# Adams Web Searcher

A Cloudflare Pages web app that lets engineers search the NRC ADAMS document database
in plain language. Claude drives the search server-side (on the operator's paid API
tokens), using the real `adams-search-api` skill as its playbook and calling the ADAMS
API directly. Output is a plain-language analysis the user can save as a bookmarked PDF.

## Two modes

The tool operates in two modes, selected by a toggle above the query box:

| Mode | What it does |
|---|---|
| **General ADAMS Research** | Open-ended lookups — find a document, check what's on file, read an amendment, answer a question. Claude searches and summarizes the results as a linked table, then **stops and asks what (if anything) to read** — with an approximate cost — so nothing is opened until you say so. No phases, no formal report. |
| **Design-Basis Change Analysis** | Structured gap analysis — what changed in a system's licensing basis over a date range. Claude follows the five-bucket methodology with two human gates (confirm plan → search & triage → confirm documents → read & report). Produces a formal Design-Basis Change Analysis report with a Save as PDF button. |

The mode is passed to the server on each call and selects a different system-prompt preamble (`GENERAL_WEB_PREAMBLE` vs `WEB_PREAMBLE` in `functions/api/agent.js`). The ADAMS skill text and Hatch reference files are identical in both modes — only the operating instructions around them differ.

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

## The skill is the primary mechanism of the Design-Basis process

The app does **not** paraphrase the search methodology in code. The real
`adams-search-api` skill is embedded verbatim as the model's system prompt. In
**Design-Basis Change Analysis** mode the skill is the **primary mechanism of the
process** — its five-bucket workflow, four-tier triage, human gates, and report format
are what drive that half of the tool. In **General ADAMS Research** mode the same skill
text is still present, but only as a **reference for ADAMS mechanics** (correct
DocumentType values, docket formats, search patterns); the lighter `GENERAL_WEB_PREAMBLE`
drives the behavior there, not the phased workflow.

The skill was originally forked from Mat's Claude Cowork `adams-search-api` skill — the
two share a common ancestor but have since **forked away from each other and now evolve
independently**. This repo's copy is hand-maintained here and is **no longer synced from
Cowork**: the team app owns its own copy and changes it on its own.

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

## Changing the skill and shipping it

> **What was removed, and what wasn't.** The old Cowork **auto-sync** is gone — the app
> no longer pulls the skill from the Claude Cowork app. What remains (and is now the
> *only* way the skill ever changes) is editing it **by hand in this repo**. So "shipping
> a skill change" still exists; it just means editing the Markdown here and pushing — not
> syncing from anywhere. Remember this drives **Design-Basis** mode; to change
> **General** mode's behavior, edit `GENERAL_WEB_PREAMBLE` in `functions/api/agent.js`
> instead.

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
`adams_get_document` — executed server-side where the keys live. In Design-Basis mode
the skill's human gates (confirm plan, confirm documents to open) are natural pause
points: the model ends its turn and the browser shows a reply box. The final report
renders to a bookmarked PDF entirely client-side (jsPDF, vendored in `public/vendor/`)
— zero model tokens.
