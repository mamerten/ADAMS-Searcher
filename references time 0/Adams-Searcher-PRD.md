# Product Requirements Document: Adams Web Searcher

> **⚠️ Read with the skill — this document is only half the picture.** This PRD is meant to be used **in conjunction with the `adams-search-api` skill** (see §7, "Build approach"). The PRD covers the *what and why*; the skill covers the *how* — the ADAMS API endpoints, authentication, request-body construction, property-name filters, the oldest-first sort quirk, content retrieval, and the result-triage methodology that make the product actually work. **If this PRD is handed to Claude Code (or anyone) without the `adams-search-api` skill, it is missing a large amount of essential, build-critical information** and should not be treated as a complete spec on its own.

## Key Information

| Field | Value |
|---|---|
| Product Name | Adams Web Searcher |
| Owner | Mat Merten |
| Hosting | Cloudflare (subdomain of `matmerten.com`, e.g. `adamsearcher.matmerten.com`) |
| Repo | GitHub (planned; public/private TBD) |
| Status | Active |
| Contact | mmerten@enercon.com |
| Reference | `adams-search-api` skill — the companion build input documenting the APS API mechanics (required reading; see §7) |

---

## 1. Executive Summary

Adams Web Searcher is a desktop web app that lets engineers search the NRC ADAMS public document database in plain language, see clean metadata results, and then have Claude **read the actual document contents and answer questions about them.** That reading-and-analysis step is the reason the tool exists; the search is the setup for it. It removes the need to understand ADAMS' native query language, docket numbers, document-type taxonomies, and pulldown-driven interface.

The user types **one plain-language request** — including the plant, the topic, and the date range, all in words. Claude parses it, **shows the user exactly how it intends to search ADAMS, and asks for confirmation** before running anything. This parse-and-confirm step is the heart of the interface: small wording differences in a request can map to very different ADAMS searches, so the confirmation screen makes Claude's interpretation legible and correctable before any tokens or time are spent.

The tool runs in deliberately separated phases so the user controls *when* the heavier token spend happens — but all three phases are part of the job; Phase 2 is the payoff, not a bonus:

- **Phase 0 — Parse & Confirm:** Claude interprets the request and reads back a concrete search plan. Cheap, fast, fully editable.
- **Phase 1 — Metadata search:** Runs the confirmed plan against the ADAMS API, returns clean metadata rows. ~20% faster than using ADAMS directly.
- **Phase 2 — Document content analysis (the core deliverable):** Claude reads the documents found in Phase 1 and answers the user's question about them. Token-spending, ~50%+ time savings versus a person opening and reading the PDFs themselves.

All AI processing runs on Mat's own paid Claude API tokens, server-side, so end users need no Claude account.

---

## 2. Background & Context

**Problem:** ADAMS is a giant repository (3M+ public documents, mostly PDF) with its own language — docket numbers, accession (ML) numbers, document-type taxonomies, and a pulldown-heavy interface. Engineers who need information from it spend time fighting the interface and then manually opening and reading PDFs.

**Current state:** Users manually navigate ADAMS, build queries by hand, then open documents one by one.

**The insight:** The ADAMS search mechanics are well-defined (and captured in the `adams-search-api` skill) and can be driven directly through the NRC ADAMS Public Search (APS) API: fast, reliable, and returning full document metadata. Wrapping that behind a single natural-language box plus a confirmation step, with Claude doing the translation, is the product. The API's Search endpoint returns metadata; its Get Document endpoint returns the document's indexed plain-text content for Phase 2 — no separate scraping or OCR step in the common case.

---

## 3. Goals & Success Metrics

### Goals

- **Phase 1:** ~20% time savings vs. searching ADAMS manually (no pulldowns, no learning the query language, faster querying).
- **Phase 2:** ~50%+ time savings vs. a user opening and reading the documents themselves.

### Success Metrics

Only two metrics matter:

1. **Adoption** — do people on the team actually use it?
2. **User satisfaction** — do they find it valuable enough to come back?

(No accuracy dashboards, no formal analytics required.)

---

## 4. Users & User Stories

**Primary user:** Engineers who already use ADAMS but don't know its details — the docket/accession/taxonomy "language" — and want to interface with it more quickly.

User stories are intentionally loose. Representative examples:

- *As an engineer who occasionally needs ADAMS documents, I want to describe what I'm looking for in plain words — including the plant and dates — so that I don't have to learn docket numbers, document-type values, or which search box does what.*
- *As an engineer, I want to see how the tool interpreted my request before it runs, so I can catch a wrong plant or the wrong kind of match before wasting time.*

---

## 5. Functional Requirements

### 5.1 Layout & Global Behavior

- **Desktop only.** Mobile is explicitly out of scope.
- **Respects the user's system light/dark mode.**
- **No cross-session persistence** — no saved searches, no history, no user accounts. ("Stateless" in this sense.) Working state for the *active* session (the conversation, the confirmed plan, the Phase 1 result set that Phase 2 reads from) is held in the browser while the user is on the page; nothing is stored server-side between sessions.
- Vertically stacked sections that progressively reveal as the user moves through the flow: text box → (clarification, if needed) → confirmation → results → content analysis.
- **No pulldowns, no pick lists, no date pickers, no document-type dropdowns** anywhere in the flow. Everything is expressed in free text — a starting text block plus, when needed, short clarification exchanges (§5.3) — and then read back on the confirmation card. (The model toggle in §5.7 is the only control.)

### 5.2 Single Natural-Language Entry

- The starting input is **one free-text block.** The user describes everything in words — the plant, the topic, and the date range — e.g. "feedwater design changes at Hatch since the last EPU." There is **no pick list, no plant selector, and no preset plant list**; the user just types what they want, including the plant.
- Claude resolves whatever the user names — including the plant → docket(s) — behind the scenes (per the skill). The user never sees or types a docket number, and the tool is not limited to any fixed set of plants.
- If the request is unclear or incomplete, the system does **not** guess silently — it asks (see the clarification loop in §5.3).

### 5.3 Phase 0 — Parse & Confirm

This is the heart of the search setup. When the user submits the text block, Claude (server-side) parses intent and constructs a concrete ADAMS query, then **stops and shows it for confirmation.** Nothing queries ADAMS until the user approves.

The interpretation work — resolving the plant to docket(s), deciding which ADAMS field each term should search, picking the date field, and converting worded date ranges to concrete dates — follows the rules in the `adams-search-api` skill. The PRD does not restate those rules; the skill is the source of truth and the website implements them in full.

**Clarification loop (when the request is unclear).** If Claude cannot confidently resolve the request, it does **not** guess. It responds with a plain-language question and presents **a new text block** for the user's answer. This repeats as a short back-and-forth — question, answer, question — until the request is clear enough to build a query. This is a conversational exchange, **never** a pick list or menu.

**Then the confirmation card.** Once the request is clear, Claude shows a confirmation card that reads the resolved plan back in plain language — which plant/docket(s) it will search, what it's searching for and where, and the resolved date range — with labels unambiguous enough that the user can catch a misinterpretation. The user approves (**Search**), or edits and resubmits, which re-runs the parse (re-query behavior per §5.6).

The clarification loop and the card together are the safety check: a wrong plant, a wrong kind of match, or a wrong date range is caught here rather than after a search runs.

### 5.4 Phase 1 — Metadata Search & Results

- On **Search**, the backend issues the confirmed query to the ADAMS API and retrieves the matching records. The user never sees any of this machinery.
- **Results display**, one row per document, exactly these four columns **in this order**:

  | # | Column | Notes |
  |---|---|---|
  | 1 | **Accession No. (ML)** | The `ML…` identifier, linked to the document (link format per the skill). |
  | 2 | **Document Title** | Full title as returned by the API. |
  | 3 | **Document Type** | ADAMS classification (full value; comma-separated if multiple). |
  | 4 | **Document Date** | Date only. |

  Date Added and Docket # are intentionally excluded (Date Added isn't relevant to this work; Docket # is redundant once the search is docket-anchored).
- Lead with the **total result count**, then the results.
- **Group results by Mat's mental model of ADAMS** rather than as one flat list — the four origin-based groups from the *Hatch Design Basis Change Search Guide*: **Licensee → NRC**, **NRC → Licensee**, **Environmental / NEPA / Section 106**, and **NRC Internal / Administrative**. (The guide defines what falls in each.)
- **>100 document guardrail:** if the search returns more than 100 documents, stop and prompt: *"This is over 100 documents — are you sure?"* before proceeding. A result set this large usually signals an over-broad search worth narrowing.
- **Download all** for the Phase 1 result set.
- **Copy results as Markdown** button (Accession-linked ML, Title, Doc Type, Doc Date).

### 5.5 Phase 2 — Document Content Analysis (the core deliverable)

- This is the reason the tool exists. Phase 1 produces the list of documents; Phase 2 is where Claude actually **reads those documents and answers the user's question.** The product is not useful without it.
- After Phase 1 results, a text block lets the user describe what to look for **within the documents already found in Phase 1**, and the analysis runs. A token estimate is shown first (§5.8) so the user goes in with eyes open on cost — this is cost *awareness*, not an opt-out; Phase 2 is the point, not a nice-to-have.
- **Works only on the Phase 1 result set** — it does NOT re-query ADAMS or re-download.
- Everything about how this phase runs — content retrieval, the document-reading methodology, any in-flow checkpoints, the analysis, and the final report — **follows the `adams-search-api` skill.** The PRD does not define its own gates or restate the method; the skill is the source of truth and the website implements it (see §7 for the one place the website must diverge: PDF rendering).

### 5.6 Re-query / Iteration Behavior

- If the user edits the original text block and resubmits, everything downstream (the confirmation card, results, Phase 2) is cleared and the flow re-runs from the parse step.

### 5.7 Model Selection

- A **single global toggle** (not one per text block) chooses the Claude model.
- **Defaults to Opus 4.8.** Users can deliberately downgrade to Sonnet if they want lower cost / faster turnaround.
- **Opus is recommended** because of the complexity of this task — interpreting ambiguous natural-language requests, resolving how a request maps to a search, and reading/synthesizing dense regulatory documents all benefit from the stronger model. A short inline note next to the toggle should say as much (e.g. *"Opus recommended — this task is complex; downgrade to Sonnet only if you want to trade some quality for speed/cost."*).

### 5.8 Token Visibility

- Show an **estimated** token count before the Phase 2 analysis runs (cost awareness, not a gate to skip Phase 2).
- Show **actual** tokens consumed (pulled from the Claude API response) after processing completes.
- (Phase 0 parse and Phase 1 metadata are cheap; the estimate matters most right before the Phase 2 read, where the real tokens are spent.)

### 5.9 "How This Works" Link

- Small hyperlink at the bottom of the page opens a modal explaining the big picture:
  - The user types a plain-language request; Claude asks any clarifying questions, translates it into an ADAMS search, and **confirms before running.**
  - Search/metadata comes from the **NRC ADAMS Public Search (APS) API.**
  - Actual document content is pulled via the ADAMS API's **Get Document** endpoint (indexed plain-text content), with a PDF fallback for scanned documents.
  - Analysis runs on **Mat's own paid Claude API tokens.**
  - The Claude API calls happen **server-side in a Cloudflare Pages Function**, so the API key is never exposed in the browser and token usage is controlled/tracked on the backend.
  - Why **Opus 4.8 is the default** (recommended for the complexity of this task) and **Sonnet** is an opt-in downgrade for lower cost / faster turnaround.

### 5.10 Footer

- **Version number** (tied to GitHub releases).
- Contact line: *"Bug reports or feature requests? Email mmerten@enercon.com."*

---

## 6. Non-Functional Requirements

### Performance Targets

- **Phase 0 (parse / each clarification turn):** a few seconds — one model call per turn.
- **Phase 1 (metadata search):** typically under ~30 seconds; longer for a full five-bucket sweep that triages many results. Show progress rather than a frozen spinner.
- **Phase 2 (content analysis):** **no fixed time target — this scales with how many documents are read and how large they are, and can run for several minutes.** It is driven as a series of short backend calls (see §7) with visible per-document progress, so the user always sees forward motion rather than one long hang. Set expectations in the UI ("reading N documents — this may take a few minutes") instead of promising a deadline.

### Security

- Both the Claude API key and the NRC ADAMS API key are stored as encrypted Cloudflare **Secrets** and read only server-side inside a Pages Function. Never client-side, never in any browser asset.

---

## 7. Technical Approach

| Layer | Choice |
|---|---|
| Frontend | Cloudflare Pages (static assets — UI, text box, confirmation card) |
| Backend | Cloudflare **Pages Functions** (server-side code in the project's `/functions` folder — handles ADAMS API calls, content extraction, and Claude API calls) |
| AI | Claude API, backend-only, Mat's paid tokens; **Opus 4.8 default** (recommended), Sonnet optional downgrade |
| Search/metadata | **NRC ADAMS Public Search (APS) API** — `POST /aps/api/search`; metadata, full untruncated titles, reliable querying. |
| Content extraction | **ADAMS Get Document endpoint** — `GET /aps/api/search/{accessionNumber}`; returns indexed plain-text content directly. PDF fetch from the document's `Url` is the fallback for scanned/empty docs. |
| Hosting/domain | `matmerten.com` subdomain on Cloudflare |

The retrieval path is the **ADAMS APS API**, full stop. Claude's role is the translation layer: it converts the user's plain-language request into a structured API query, confirms it, runs it, and formats the results — following the query-construction rules defined in the `adams-search-api` skill.

### Execution model (how the long work fits a serverless backend)

A Cloudflare Pages Function is a **short-lived, stateless serverless invocation** — it answers one request quickly. (Pages Functions run on the same engine as standalone Workers, so this is not a Pages-vs-Worker choice; the constraints are identical either way. Staying on Pages is fine.) This shapes how each phase runs:

- **Phase 0 (parse / clarify) and Phase 1 (search)** fit a single Function call each — a quick round-trip to Claude and/or ADAMS. No special handling needed.
- **Phase 2 (read many documents + analyze)** can run for minutes and must **not** be one long Function call (the browser request would time out). Instead, the **browser drives it as a sequence of short Function calls** — roughly one or a few documents per call — accumulating results and showing per-document progress. Each call stays well within serverless limits, the keys stay server-side, and the user sees continuous progress.
- **Session state** (the conversation, the confirmed plan, the Phase 1 result set Phase 2 reads from) is held **in the browser** for the active session. The backend stays stateless; nothing persists across sessions.

**Known stack limitation — PDF rendering.** The `adams-search-api` skill renders its report PDF with pandoc + xelatex, a native LaTeX toolchain that **cannot run** inside a Cloudflare Function (no arbitrary binaries). The website must therefore produce the report PDF a serverless-compatible way — e.g. a client-side JavaScript PDF library, or an HTML report the user prints to PDF. The website matches the skill's report **content and structure**; the PDF *generation mechanic* is the one place it necessarily diverges from the skill.

### Architecture — one Cloudflare Pages project

The entire app is **one Cloudflare Pages project**, not a separate frontend and backend product:

- **Static frontend** — the UI (text box, confirmation card, results table) ships to the browser as plain Pages assets. Contains no keys, ever.
- **Pages Functions** — a small amount of server-side code in the project's `/functions` folder. This is where the request is received, the two API keys are read, ADAMS and Claude are called, and only the finished results are returned to the browser. Pages Functions run on Cloudflare's edge (the same runtime as Workers) but are managed entirely inside the Pages workflow — no standalone Worker to stand up.
- **Secrets** — both API keys are stored as encrypted **Secrets** in the Pages project settings (Settings → Variables and Secrets) and read at runtime via `context.env` inside a Function. Cloudflare hides the values after they're saved; they are never written into any HTML, JS, or other asset sent to the browser.

### Backend integrations — two keyed APIs plus one keyless fetch

The Pages Functions backend integrates two external APIs, each requiring a credential, plus one keyless document fetch:

| # | Integration | Credential | Used in | Purpose |
|---|---|---|---|---|
| 1 | **NRC ADAMS APS API — Search** (`POST /aps/api/search`) | NRC subscription key (stored as a Secret, sent in the `Ocp-Apim-Subscription-Key` header) | Phase 0 confirm, Phase 1 search | Search execution and metadata retrieval |
| 2 | **NRC ADAMS APS API — Get Document** (`GET /aps/api/search/{ML}`) | Same NRC subscription key | Phase 2 | Pulling a document's indexed plain-text content for analysis |
| 3 | **Anthropic Claude API** | Mat's paid token key (stored as a Secret) | Phase 0 parse, Phase 2 analysis | Plain-language parsing and document content analysis |
| 4 | **PDF fallback fetch** (document `Url` / `nrc.gov` PDF) | None (public) | Phase 2, only when indexed content is empty/scanned | Last-resort full-text retrieval for scanned or very new documents |

Both keys are stored as Secrets and only ever read server-side inside a Function. Integrations #1 and #2 are the same ADAMS API (two endpoints, one key). The PDF fallback (#4) hits public NRC document URLs and needs no credential, but is still an external dependency that can fail (see §9).

> **Note on the ADAMS MCP server:** the `adams-search-api` skill calls the ADAMS API through an installed **MCP server/connector** (preferred) with direct HTTP as a fallback. That connector is a convenience for *interactive Claude use* of the skill. The deployed Pages Function should call the ADAMS HTTP endpoints **directly** (reading the key from a Secret) — it does not depend on the MCP server being installed. The skill's HTTP request/response details are what Claude Code needs to write that Function.

**Why a Function, not client-side:** both API keys must stay hidden. On a pure static Pages site the only place to put a key would be in the browser-side JavaScript, where anyone could open dev tools and read it. The Pages Function exists precisely so the keys live server-side as Secrets and never reach the browser — the user's machine only ever sees the finished results.

### Build approach — Claude Code with two inputs

The app will be built in **Claude Code**, given two inputs:

1. **This PRD** — the *what and why*: the product behavior, the phased flow, the parse-and-confirm UX, the result format, and the Cloudflare Pages architecture above.
2. **The `adams-search-api` skill** — the *how*: the companion skill that documents all the ADAMS APS **API** mechanics — the two endpoints, request/response shapes, filter logic, property names, controlled-vocabulary and sort/date behaviors, pagination, and the full search/triage/reporting methodology (the five design-basis buckets, four-tier triage, and structured report). The PRD does not restate any of this; the skill is the authoritative source and the website is to implement it **in full**.

Claude Code consumes both — the PRD for product intent and the `adams-search-api` skill for the concrete ADAMS integration details — and generates the Pages project (static frontend + Pages Functions). The skill is a **build-time reference**, not a runtime component of the deployed app: the running app calls the ADAMS HTTP API directly from its Pages Function; the skill exists to tell Claude Code how to write that Function correctly.

---

## 8. Scope

### In Scope

- Single natural-language entry box; no plant selector, no pulldowns, no date pickers.
- **Phase 0 parse-and-confirm** — Claude resolves the request into a concrete ADAMS query (per the skill's rules), asks free-text clarifying questions when unclear, and reads the plan back on a confirmation card the user approves.
- Results grouped by Mat's four-group ADAMS mental model.
- Metadata results: Accession (ML, linked), Document Title, Document Type, Document Date.
- >100-document guardrail.
- Download-all and copy-to-Markdown for the Phase 1 results.
- Phase 2 content analysis (the core deliverable) scoped to the Phase 1 result set, following the skill's reading and reporting methodology.
- Global model toggle defaulting to Opus 4.8.
- Token estimate + actual usage display.
- "How this works" modal.
- Versioned footer + feedback email.

### Out of Scope

- Mobile / responsive layout.
- Saved searches or history.
- User authentication.
- Integrations with any other tools.
- Any export beyond copy-to-Markdown and the Phase 1 download-all.
- Plant pick lists / dropdown filters (the parse-and-confirm flow handles this instead).

---

## 9. Error Handling

- **ADAMS API down:** the whole system breaks. Communicate in plain terms ("the NRC ADAMS service appears to be unavailable") and send a notification email to Mat.
- **Claude API down:** the whole system breaks. Communicate this to the user and send a notification email to Mat.
- **Get Document / content-retrieval failure:** notify the user it's broken (same pattern). If indexed content is merely empty (scanned doc), that's not an error — fall back to the PDF and flag lower OCR reliability.
- **Over-broad search (>100 results):** handled by the §5.4 guardrail, not an error.

---

## 10. Dependencies, Risks & Mitigations

| Item | Notes |
|---|---|
| Parse accuracy (key risk) | With no pick list, the plant and the rest of the search are inferred from prose. Mitigated by the Phase 0 clarification loop and confirmation step — the user approves the resolved plan before anything runs. |
| Document-Type vocabulary | Document Type is a controlled list; a user's concept may not map cleanly. Mitigated by confirming the exact type value on the card before searching. |
| ADAMS API reliability | All NRC resources are free; no rate-limit cost concerns. If anything breaks, the only required action is to notify the user. Re-verify behavior against the developer portal if responses look off. |
| Token cost | The only real variable spend, and higher under the Opus 4.8 default. Phase 2 (the core deliverable) is where most tokens go and is non-negotiable. Cost is managed — not avoided — by the user choosing *when* to run it, the token estimate shown first, the >100-document guardrail, and the option to downgrade to Sonnet. The Opus default is a deliberate quality-over-cost choice given the task complexity. |
| ADAMS mechanics confidence | The query mechanics live in the `adams-search-api` skill (vetted); re-verify against the API Developer Portal during build. |

---

## 11. Testing & Acceptance

- Solo user testing by Mat is sufficient for this internal tool.
- "Done" = the full flow works end to end: a plain-language request (with clarifying questions when needed) parses into a correct, clearly-labeled confirmation card; the confirmed search returns the grouped metadata results with working ML links; the >100 guardrail fires; Phase 2 reads and analyzes the documents per the skill's methodology; errors are reported with the email-to-Mat fallback; and token estimate/actuals display.
- **Parse-accuracy spot check:** run a handful of varied requests (single unit, both units, a non-Hatch plant, plant-unknown, vague vs. specific topics, worded date ranges) and confirm the clarification loop and card resolve each correctly.

---

## 12. Open Items

- **Build the website code** — implementing the **full breadth** of the `adams-search-api` skill (all five design-basis buckets, four-tier triage, and the structured report), calling the ADAMS API directly from the Pages Function (direct HTTP, not via the MCP connector). Confirm request/response shapes against the NRC API Developer Portal (`https://adams-api-developer.nrc.gov/`).
