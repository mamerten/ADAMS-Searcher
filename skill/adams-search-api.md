# ADAMS Public Search — API Method - Rev 5

## Context

This skill is written for use by engineers at a nuclear engineering services firm. The primary use
case is nuclear power plant (NPP) licensing work — searching for documents associated with a specific
plant docket: technical specification amendments, inspection reports, LERs, UFSAR updates, ISI
alternatives, SLR documents, 10 CFR 50.59 periodic reports, and similar. The NRC regulates other things
(nuclear materials, fuel cycle facilities, waste repositories) but those are not the primary concern
here. Searches will almost always be anchored to a reactor docket number in the format `05000XXX`.

The user will define what they're looking for. This skill handles how to get it out of ADAMS efficiently
using the ADAMS Public Search API — no browser tab, no DOM scraping.

> **Which skill to use:** This is the **API-based** method. It calls the ADAMS Public Search API and
> reads clean JSON back. It is significantly **faster and more reliable** than the browser method, it
> returns **full (untruncated) document titles**, and it can return a document's **indexed plain-text
> content** directly — so it should be the default whenever an API subscription key or the ADAMS MCP
> server is available. If neither is available (no key, no connector), use the companion
> **adams-search-browser** skill, which drives a real Chrome tab and needs no key.

> **How this skill calls the API (you don't need to manage any of this):** Prefer the installed ADAMS
> **MCP server / connector** tools — call its search tool and its get-document tool. If the connector
> is unavailable or a call fails, fall back to issuing the HTTP requests documented below directly. The
> **subscription key lives in the connector/environment settings** and is sent in the
> `Ocp-Apim-Subscription-Key` header automatically. Never paste, echo, hardcode, or put the key in a
> URL — read it from settings only.

---

## Clarifications to Ask the User (As Needed)

Before running a search, resolve any ambiguity in the request. Ask only when the answer is genuinely
unclear; otherwise proceed. Add new clarification cases here as they come up.

- **Do NOT ask which search buckets to run.** For any design-basis gap analysis, all five
  buckets — Bucket 1 (TS Amendments), Bucket 2 (10 CFR 50.59 Reports), Bucket 3 (UFSAR),
  Bucket 4 (ISI / 10 CFR 50.55a Relief Requests & Alternatives), and Bucket 5 (generic-issue /
  vendor design-basis correspondence) — run by default. The user may explicitly opt a bucket out;
  otherwise run all five without asking.

- **Check the project files FIRST before asking.** The ADAMS Research project folder contains
  reference material (e.g. "Hatch Design Basis Change Search Guide.md") that supplies plant-specific
  inputs — docket numbers, the EPU date/anchor, recommended search windows, document-type values,
  and the gap-analysis method. Read the relevant project guide before asking the user for a date,
  docket, or method that the guide already provides. Example: "since the last EPU" for Hatch resolves
  to a **Document Date window of 1999-01-01 to present** per the guide (EPU amendments issued
  1998-10-22) — do not ask the user or look it up externally when the guide states it.

- **Ambiguous date range** — when the user says something like "dated between X and Y" without
  specifying which date they mean, ask whether they mean **Document Date** (the date on the document
  itself, the API field `DocumentDate`) or **Date Added** (when ADAMS published it, the API field
  `DateAddedTimestamp`). Note to the user that for most work — especially design basis change
  research — they very likely want **Document Date**. Default to Document Date if they don't have a
  preference.

- **Concept term: search query (`q`) vs. Document Type filter** — when the user names a document
  category like "technical specifications," "inspection report," or "amendment," clarify whether they
  want it in the **free-text query (`q`)** or as a **`DocumentType` filter**. They behave very
  differently:
  - In the **`q` query**, the phrase matches anywhere in a document's content or metadata, so results
    are broad and noisy — you get cover letters, NRC correspondence, transmittals, safety
    evaluations, and anything else that merely *mentions* the phrase. Use when the user wants
    everything related to the topic.
  - As a **`DocumentType` filter**, results are restricted to records ADAMS has *classified* as that
    type — far narrower and cleaner. Use when the user wants the actual documents of that kind.
  - Note that Document Type is a controlled vocabulary: a concept may map to one type, several, or
    none exactly. If the user wants the type filter, confirm the exact ADAMS type value before
    running the search.

---

## Which ADAMS Interface to Use

Use the **APS** API (`adams-api.nrc.gov/aps/api`) — it covers all NPP licensing documents and is the
only one of ADAMS's three search systems with a public API. For NPP work it is always the right choice.

---

## API Access & Invocation — Read First

The ADAMS Public Search API is the new NRC API launched in December 2025 (it replaced the retired
Web-Based ADAMS / WBA API). It exposes exactly **two endpoints**, both REST/JSON, both requiring the
subscription key in the `Ocp-Apim-Subscription-Key` header:

| Endpoint | Verb | URL | Purpose |
|---|---|---|---|
| **Search Document Library** | POST | `https://adams-api.nrc.gov/aps/api/search` | Boolean + filtered search; returns a JSON result set (metadata, plus content if requested) |
| **Get Document** | GET | `https://adams-api.nrc.gov/aps/api/search/{accessionNumber}` | One document's full metadata **and indexed plain-text content** |

**Invocation order (MCP first, HTTP fallback):**
1. **Preferred — call the ADAMS connector / MCP server tools.** Use its search tool for the POST search
   and its get-document tool for the GET. The connector injects the key and handles auth.
2. **Fallback — direct HTTP.** If the connector is unavailable or returns an auth/credential error,
   issue the HTTP requests above directly, reading the key from the configured settings. The key goes
   in the header only — never in the URL, never echoed back to the user.

**Best practices (from the NRC API guide):**
- Always narrow with filters; broad full-text-only queries are slow and noisy.
- Expect paged results for large queries — use `skip` to page (see Pagination).
- Counts can drift during the day as the NRC issues new documents; treat a result count as a snapshot.

There are **no tab-freeze, column-config, or DOM-scraping concerns** here — those were browser-method
problems. The API returns structured JSON directly.

---

## Search Request Construction (Primary Method)

The Search Document Library endpoint takes a JSON POST body. This is the API analog of the browser
skill's encoded-URL search object, and the fields map almost one-to-one.

### Request Body Structure

```json
{
  "q": "free-text search terms here",
  "filters": [ ],
  "anyFilters": [ ],
  "legacyLibFilter": true,
  "mainLibFilter": true,
  "sort": "DocumentDate",
  "sortDirection": 1,
  "skip": 0
}
```

- **`q`** = the free-text **search query** (the equivalent of the browser method's top-level
  `keywords` / "Search Term(s)" bar). It searches document content AND metadata. Leave `""` if not
  using free text. ⚠️ This is the free-text box — it is NOT the ADAMS property literally named
  **`Keyword`** (a separate metadata field you filter on like any other property).
- **`filters`** = **AND** logic; every filter here must match. This is the API equivalent of the
  browser method's `all` array. Put **date ranges** and other must-match constraints here.
- **`anyFilters`** = **OR** logic; a result matches if it satisfies any one filter here. This is the
  API equivalent of the browser method's `any` array. Put **docket numbers** here.
- **Docket rule (important):** always put docket number(s) in `anyFilters` (OR) — one entry per
  docket. This is required when searching two or more units (e.g. Hatch 1 `05000321` OR Hatch 2
  `05000366`); putting multiple dockets in `filters` (AND) means "tagged to both at once" and returns
  almost nothing. A single docket also works in `anyFilters`, so always use `anyFilters` for dockets
  and there is one rule to remember.
- Overall logic = (every `filters` entry matches) AND (at least one `anyFilters` entry matches) AND `q`.
- Always set both `legacyLibFilter` and `mainLibFilter` to `true`.
- `sort` / `sortDirection` are sent but the API currently **IGNORES** `sortDirection` — results always
  come back **OLDEST-first**. To present newest-first you must sort **CLIENT-SIDE** after retrieval.
  Because the first page is the oldest records, a newest-first request that spans more than one page (a
  page is 100 results) must re-fetch the **TAIL** page first — `skip = count − pageSize` — then sort that
  page descending in code. The reference implementation `adams_mcp_server.py` (rev 1) already does this
  tail-fetch + client-side sort.
- `skip` — number of results to skip; used for paging (default `0`).
- **Do not request content in the search.** Keep search responses to metadata only for triage; pull
  content per-document with the Get Document endpoint in Phase 6 (see Retrieving Document Content).

### Property Names (use NAMES, not GUIDs)

Unlike the browser method (which needs property GUIDs), the API filters by **property name**. The
common ones for this work:

| Concept | API field name (`field`) |
|---|---|
| Docket Number | `DocketNumber` |
| Document Date | `DocumentDate` |
| Document Title | `DocumentTitle` |
| Document Type | `DocumentType` |
| Keyword (metadata property) | `Keyword` |
| Author | `AuthorName` |
| Date Added | `DateAddedTimestamp` |

Full property list available as filters or returned fields: `AccessionNumber`, `DocumentTitle`,
`AuthorName`, `AuthorAffiliation`, `AddresseeName`, `AddresseeAffiliation`, `DocumentDate`,
`DocumentType`, `Keyword`, `DocketNumber`, `DateAddedTimestamp`, `EstimatedPageCount`, `Url`.

> **Case matters** for property names — use the exact casing above. The current, authoritative list of
> searchable properties is published on the API Developer Portal (`https://adams-api-developer.nrc.gov/`);
> check it if a filter on an uncommon property returns nothing.

### Text Filter Object

Most properties are text filters. Shape: `field`, `value`, `operator`.

```json
{ "field": "DocumentType", "value": "License-Operating", "operator": "starts" }
```

Text operators (pass the quoted string in `operator`):
- `contains` — field contains the term (broadest)
- `notcontains` — field does not contain the term
- `starts` — field starts with the term
- `notstarts` — field does not start with the term
- `equals` — exact match of the whole field value
- `notequals` — not an exact match

For a **specific unit docket** use `equals` (e.g. `DocketNumber equals 05000321`). For a **fleet-wide
sweep of all reactors**, `DocketNumber starts 05000`.

### Verified DocumentType values (use these exact strings)

`DocumentType` is a **controlled vocabulary** matched with the `starts` operator. A wrong string
**silently returns ZERO results** — the API does not error, it simply hands back an empty set, which
reads like "nothing exists" when the real problem is the type label was wrong. Use these verified
values (each matched with `starts`):

| What you want | Exact `DocumentType` value |
|---|---|
| Issued (NRC-granted) license amendments | `License-Operating` — matches "License-Operating (New/Renewal/Amendments) DKT 50" |
| Licensee amendment applications / requests | `License-Application for Facility Operating License` — short prefix; matches "...(Amend/Renewal) DKT 50" |
| UFSAR revision packages | `Updated Final Safety Analysis Report` — matches "...(UFSAR)" and also catches the legacy all-caps type used for pre-1999 baselines |
| ISI relief requests / alternatives | `Code Relief or Alternative` |
| ISI program plans / owner's activity reports | `Inservice/Preservice Inspection and Test Report` |
| General correspondence | `Letter` |

> **Hard rule — do NOT filter amendments by `License Amendment` or `Amendment`.** Both return **ZERO**
> in this API. Neither string is in the controlled vocabulary; the issued-amendment type is
> **`License-Operating`**. (This was wrong in Rev 1 and was caught when the skill ran live.)

### Date Filter Object

There are only two date properties: `DocumentDate` and `DateAddedTimestamp`. Shape: `field` + a
`value` that wraps the comparison expression. Dates are always `YYYY-MM-DD`.

```json
{ "field": "DocumentDate", "value": "(DocumentDate ge '2024-01-01')" }
```

Date operators inside the value expression:
- On or after → `ge` — `(DocumentDate ge '2024-01-01')`
- On or before → `le` — `(DocumentDate le '2024-12-31')`
- Equals → `eq` — `(DateAddedTimestamp eq '2024-01-01')`
- **Between (a date range)** → use **ONE** filter entry whose value combines both bounds with `and`:
  `{ "field": "DocumentDate", "value": "(DocumentDate ge '2025-01-01' and DocumentDate le '2026-06-07')" }`.
  ⚠️ Do **NOT** use two separate `ge` and `le` entries — the API silently ignores them and returns the
  full unfiltered result set. A single-sided bound (only `ge`, or only `le`) may stay as its own entry.

> **Caveat — multi-word `contains` on a property tokenizes loosely.** A property value like
> `summary of facility changes` is matched as an AND of its tokens across the whole field, which can
> produce surprising hits (e.g. it matched "Summary of Public Meeting" titles). Prefer a single
> distinctive token, an exact `equals` Document Type value, or verify the result count looks sane.

### Example Request

Searches Hatch Unit 1 OR Unit 2, Document Date in a range, free-text `50.59`. Dockets go in
`anyFilters` (OR); the date range is a single combined entry in `filters` (AND); the free text is `q`.

```json
{
  "q": "50.59",
  "filters": [
    { "field": "DocumentDate", "value": "(DocumentDate ge '2020-01-01' and DocumentDate le '2026-06-06')" }
  ],
  "anyFilters": [
    { "field": "DocketNumber", "value": "05000321", "operator": "equals" },
    { "field": "DocketNumber", "value": "05000366", "operator": "equals" }
  ],
  "legacyLibFilter": true,
  "mainLibFilter": true,
  "sort": "DocumentDate",
  "sortDirection": 1,
  "skip": 0
}
```

For a single docket, use just one entry in `anyFilters`.

---

## Search-Query Behavior (the `q` field)

The `q` query searches **document content and metadata** — not just titles. This means:
- **Multiple words = Boolean AND.** A search for `main steam amendment` returns documents containing
  all three words somewhere in the text, even if main steam is not the primary subject. Fewer words =
  broader results.
- Use quoted phrases for tighter matching (e.g., `"main steam isolation"` as an exact phrase).
- Results always require human review to confirm actual relevance.

**The same AND behavior applies to a text filter's `value`** with `contains`: multiple words in, say, a
`DocumentTitle contains` value matches titles containing all of those words.

For NPP licensing work, combining a `DocketNumber` filter with the `q` query is the most effective
approach: the docket anchors to the plant, the query narrows by topic.

---

## Reactor Docket Number Reference

Reactor dockets follow the format `05000XXX`. Examples:
- Hatch Unit 1: `05000321`
- Hatch Unit 2: `05000366`

Searching by a unit's docket number will return all documents tagged to that docket, including
joint documents that cover both units or fleet-wide items covering multiple plants. `DocketNumber` is
returned as an array, so joint documents list every docket they're tagged to.

---

## Output / Report Columns

Every search must capture and report these four fields for each document, **in this order**:

| # | Field | API source |
|---|---|---|
| 1 | **Accession No. (ML number)** | `AccessionNumber` (e.g. `ML24017A120`). Hyperlink it (see below). |
| 2 | **Document Title** | `DocumentTitle` — returned **in full** (no truncation). |
| 3 | **Document Type** | `DocumentType` (array; join with commas if multiple). |
| 4 | **Document Date** | `DocumentDate` — the date on the document itself; the field that matters for design basis / 50.59 work. |

> **Date Added and Docket # are intentionally excluded.** Date Added (`DateAddedTimestamp`) is not
> relevant for this work — Document Date is what matters. Docket # is redundant once the search is
> anchored to the docket(s).

### Present these columns in the Claude chat (report)

Present results as a Markdown table with these columns **in this exact order**:

| # | Column | Formatting |
|---|---|---|
| 1 | **Accession No. (ML)** | Render as a hyperlink. Prefer the `Url` field returned by the API; if absent, reconstruct it with the **ML-PDF URL pattern** `https://www.nrc.gov/docs/<first 6 chars of ML>/<full ML number>.pdf`. Display text = the ML number, e.g. `[ML24017A120](…)`. |
| 2 | **Document Title** | The full `DocumentTitle`. Wraps automatically in a Markdown cell. |
| 3 | **Document Type** | As classified by ADAMS (full value, comma-separated if multiple). |
| 4 | **Document Date** | **Date only.** `DocumentDate` is already date-only; if you ever read a timestamp field, strip the time. |

Lead with the total result count (`count` from the response), then the table. The accession-number
hyperlink in column 1 must point to the same document the ML number opens on the ADAMS site.

---

## Standard Search Workflow (mechanics of one search via the API)

This is the step-by-step procedure for executing a **single search** — building the request, calling
the API, and reading the JSON. It is the low-level mechanic, distinct from the higher-level search
*approach* (e.g. the five search buckets in Design-Basis Change Gap Analysis, which decide *what*
searches to run). Run this workflow once per individual search.

1. Build the search request body (`q`, `filters` for date/must-match, `anyFilters` for dockets,
   both library filters `true`). Sorting is done **client-side after retrieval** — the API ignores
   `sortDirection` and always returns oldest-first, so do not rely on the request to order results
   (see the sort note in Request Body Structure for the tail-fetch + client-side sort). Do **not**
   request content here.
2. Call the **ADAMS MCP server's search tool** (preferred). If unavailable, POST the body to
   `https://adams-api.nrc.gov/aps/api/search` with the `Ocp-Apim-Subscription-Key` header (fallback).
3. Read the JSON response: `count` (total matches) and `results[]`. Each result has a `document`
   object — extract `AccessionNumber`, `DocumentTitle` (full), `DocumentType`, `DocumentDate`, and
   `Url`.
4. If `count` exceeds one page of results, page with `skip` until you've collected all `count` items
   (see Pagination). Docket-anchored searches rarely exceed one page.
5. Compile all results and present the summary as a Markdown table (Accession-linked, full Title,
   Doc Type, Document Date) in the Claude chat for user review.

> **Tooling reality — a full-set pull can exceed the inline response/token limit.** A no-keyword
> full-set pull — for example the thorough Bucket 1 amendment sweep (`DocumentType starts
> "License-Operating"` with no system keyword) — can return more results than fit in a single inline
> tool/HTTP response. When that happens, do one of two things: **(a)** page through it with `skip`
> (page size × pages already retrieved) and accumulate; or **(b)** save the raw result set to a file
> and hand that file to a **subagent** with explicit instructions to return **ONLY the triage fields**
> per document — accession number, full title, document type, document date, and assigned rating — so
> the full JSON payload never enters the main thread. Either way the goal is the same: keep the bulky
> payload out of the main context while still triaging every record.

---

## Retrieving Document Content (Get Document)

To read what a document actually says, call the **Get Document** endpoint with the accession number:

```
GET https://adams-api.nrc.gov/aps/api/search/{accessionNumber}
```

It returns the document's full metadata **and** its **indexed plain-text `content`**, plus
`EstimatedPageCount`. This replaces the browser method's fetch-the-PDF-and-OCR step and is what makes
Phase 6 reliable.

- Prefer the **MCP server's get-document tool**; fall back to the GET request directly.
- `content` is the indexed text of the document. It may be **empty or sparse** for scanned-image-only
  documents or very recently added documents. If `content` comes back empty, fall back to fetching the
  PDF at the document's `Url` (or the reconstructed ML-PDF URL) and
  note that OCR reliability is lower.
- Use `EstimatedPageCount` to gauge size before reading; for very large documents, hand the content to
  a subagent that returns a concise structured finding rather than reading it all inline.

---

## Pagination

The search response is paged. **Pagination is only needed when a search returns more results than a
single page** — uncommon for a docket-anchored search. To page, re-issue the same search body with an
increasing `skip` value (skip = page size × pages already retrieved), collecting `results[]` from each
call until the number collected equals `count`. The response also echoes `pageNumber` for reference.

**Do NOT page a multi-page set with `skip` alone.** The MCP server tail-fetches and re-sorts each
page descending, so skip-paging returns overlapping newest-first pages and silently drops the OLDEST
records. For any set with count > one page (e.g. the Bucket 1 `License-Operating` sweep), pull it
twice — `sort_direction` 1 and `sort_direction` 0 — or split the date range, then de-duplicate by
accession. Confirm the oldest expected document appears (for Hatch design-basis work, the 2003
uprate ML032590944).

There are no page-button clicks and no results-per-page control to set — that was a browser concern.

---

## Design-Basis Change Gap Analysis (Five Buckets)

When the user asks for **design-basis changes** to a system (e.g. "changes to the feedwater system
since the last EPU"), there is no single ADAMS field for "design-basis change." Build the answer from
**five** document buckets, all anchored to the same date window and dockets (dockets in
`anyFilters`/OR, date in `filters`/AND). The five buckets together cover the distinct regulatory
tracks a design-basis change can travel: NRC-approved amendments, plant-initiated 50.59 changes, the
UFSAR licensing-basis text itself, the separate ISI/50.55a relief track, and the named generic/vendor
issues that frame the system's design basis. Run fewer than five and a whole track goes uncovered.

**All five searches run by default. Do not ask the user to choose.** Refer to them as Bucket 1
through Bucket 5 consistently — define each at first use so the user always knows which bucket is
which. The user may explicitly opt a bucket out; otherwise run all five.

| Bucket | Category | How to search (API) | What it gives |
|---|---|---|---|
| **Bucket 1** | TS Amendments | `DocumentType starts "License-Operating"`, **NO** system keyword — pull every issued amendment in the window, then triage by title | Formal NRC-approved licensing-basis changes |
| **Bucket 2** | 10 CFR 50.59 Reports | **Drop the type filter**; run distinctive phrases as free-text `q` queries (plant-conditional — see detail) | Plant-initiated changes made without prior NRC approval |
| **Bucket 3** | UFSAR | `DocumentType starts "Updated Final Safety Analysis Report"`, no keyword — then a **chapter diff**, not a list of hits | The licensing-basis text; what actually changed in the target chapter |
| **Bucket 4** | ISI / 10 CFR 50.55a Relief Requests & Alternatives | `DocumentType starts "Code Relief or Alternative"` and `starts "Inservice/Preservice Inspection and Test Report"` — **by type, not keyword** | Weld-overlay / alternative-inspection approvals on pressure-boundary components |
| **Bucket 5** | Generic-issue / vendor design-basis correspondence | **Precise free-text discriminators** (exact NUREG number, component name, named fatigue basis) + one broad net, triaged hard | The named generic/vendor issues that define the system's design basis |

#### Bucket 1 — TS Amendments (the THOROUGH method)

Pull **EVERY** issued amendment in the window — `DocumentType starts "License-Operating"`, dockets in
`anyFilters`, date range in `filters`, **no system keyword in `q`** — then triage all results by
title.

Why no keyword: a single free-text system token (e.g. `feedwater`) only matches amendments whose
indexed text contains that exact string. Amendments that phrase the system differently — *feed pump*,
*reactor water level*, *high-energy line break*, *condensate* — silently drop out. The two failure
directions are not symmetric: a no-keyword sweep **over-returns** (extra mentions the triage step
filters out — harmless), whereas a keyword filter **under-returns** (a real design-basis amendment is
never seen — unrecoverable). Take the noise; never take the miss.

The no-keyword sweep can be large — see the tooling-reality note under Standard Search Workflow for
handling a result set that exceeds the inline response limit (page with `skip`, or hand the saved raw
result to a subagent that returns only the triage fields).

#### Bucket 2 — 10 CFR 50.59 Reports (PLANT-CONDITIONAL)

The 10 CFR 50.59 periodic report lists the changes a licensee made **without prior NRC approval**.
**How it is filed varies by plant, and the format can change over time at a single plant — verify the
plant's convention; do not assume.** It appears one of two ways:
- **STANDALONE** — its own submittal, titled e.g. *"Report of Facility Changes, Tests, and
  Experiments — Safety Evaluation Summaries."*
- **BUNDLED** — carried as an enclosure inside the UFSAR revision transmittal letter, titled e.g.
  *"10 CFR 50.59 Summary Report."*

A single plant can switch between these between reporting periods, so confirm the convention across
the whole window rather than inferring it from one filing.

**Critical search lesson — drop the type filter.** Filtering on
`DocumentType starts "Updated Final Safety Analysis Report"` **HIDES** these reports, because the
cover letters that carry them are typed **`Letter`**, not UFSAR. The type filter alone systematically
misses roughly **half** the reports. To recover the full chain you MUST drop the type filter and run
these as **free-text `q` queries** (the "Search Term(s)" box that searches whole-document content +
metadata — **NOT** a `DocumentTitle` filter). A distinctive phrase works well in `q` precisely because
it is specific; generic phrases (e.g. "Summary of Facility Changes") are noisy. Run queries such as:
- `"Report of Facility Changes Tests Experiments"`
- `"Submittal of Revision Updated Final Safety Analysis Report"`
- `"Final Safety Analysis Reports Revision"`
- `"10 CFR 50.59 Summary Report"`

#### Bucket 2 — Coverage Completeness (do this rigorously)

**Default posture: prove continuity, never presume it.** Account for **EVERY** reporting period from
the baseline date (for Hatch, **January 1, 1999**) to present, and present the accounting as an
**explicit period-by-period coverage ledger** — a table, one row per period:

| Period | Report ML | Status | Note |
|---|---|---|---|
| (e.g. 1999-01 → 2001-08) | ML… | COVERED / UNVERIFIED / GAP | stated coverage dates, or why unverified |

Every period must carry exactly one of three labels:
- **COVERED** — a report is on file whose **stated** coverage dates include this period.
- **UNVERIFIED** — a report appears to cover it, but its coverage dates have not yet been read and
  confirmed (a legitimate search/triage-phase status — see below).
- **GAP** — no report on file accounts for this period.

Do **NOT** assume an unaccounted period was "swept into" a later report's multi-year lookback **unless
the report's stated coverage dates confirm it.** Bundled reports do carry multi-year lookbacks, but
that is a hypothesis to verify against the cover letter — never a presumption that silently closes a
gap.

**Revision-and-date continuity check (for bundled reports).** When the 50.59 report rides inside a
UFSAR transmittal, line up **BOTH** axes across consecutive transmittals:
- the **UFSAR revision numbers**, and
- each report's stated **"covers X to Y"** coverage dates.

A **skipped revision number** (e.g. Rev 38 → Rev 40 with no Rev 39) **OR** a **jump** between one
report's end date and the next report's start date signals a **suspected missing reporting period**.
Run it down with targeted searches — search the **missing revision number** and the **missing
year(s)** directly. If a report turns up, add it to the ledger; if none exists, **flag that period as
a GAP** for plant-records / licensee follow-up. *Why: this is exactly how a real two-year 50.59 hole
(Sept 2020 – Aug 2022) was found this session.*

**Completeness is a Phase 6 (document-reading) result — and that is fine.** Full completeness can only
be **verified** by reading the cover letters' stated coverage periods. At the search/triage phase
(Phase 4/5), it is **correct and acceptable** to report *"here is the chain found, here are the
periods that remain UNVERIFIED until we pull documents."* That is a complete, phase-appropriate
answer — **not a deficiency.** Do not cross into opening documents to close the ledger unless the user
has approved Phase 6 (see the Phase 3/5 gate hard rule in the Phased Workflow).

**Earliest reports may be undated.** The earliest reports may be labeled only **"24-month report"**
with no explicit start/end dates printed. Flag those periods as **"covered but undated"** rather than
forcing a clean COVERED/GAP determination.

**If a period truly has no traceable filing**, fall back to the NRC triennial 50.59 inspection
(inspection procedure **IP 71111.21** — Identification and Resolution of Problems, 50.59 review; the
triennial NRC inspection samples the plant's 50.59 evaluations and is filed in ADAMS under the
docket). If even that is absent, **flag the gap explicitly** for plant-records follow-up rather than
dropping it.

> **Plant Hatch — cross-check against the existing research.** Finding every 50.59 report is easy to
> get wrong, and for **Hatch this has already been researched to near-completion.** Open
> `Hatch 50.59 Summary Report Master Index.md` in this project's files and confirm your ledger holds at
> least every report it lists — then keep searching past its last-covered period, since it is a dated
> snapshot, not the final word. Use it to verify completeness, never to replace the search.

**Set expectations on depth.** These reports are brief by regulation (10 CFR 50.59(d)(2)): they list
only changes that received a full 50.59 evaluation, each as a tracking number (LDCR/DCP), title,
description, and short evaluation summary. The underlying evaluation, calculation, and
engineering-change package lives in the plant's **internal** document control system, **NOT** in
ADAMS. Pull the reports, scan every line for system-relevant tracking numbers, and flag any that
touch the target system for plant-record follow-up. ADAMS gives you the list, not the detail.

#### Bucket 3 — UFSAR (a CHAPTER DIFF, not a search)

This bucket spans two phases. **Phase 4 (search/triage):** the discovery search
`DocumentType starts "Updated Final Safety Analysis Report"` with no keyword and dockets in
`anyFilters` — it works and catches the legacy baseline revision. This identifies the UFSAR revision
*packages* from metadata alone; do no document reading here.

**Phase 6 (read/extract):** the actual deliverable is a **chapter diff**, not a list of hits. Steps
(a)–(c) below all require opening PDFs, so they run only in Phase 6, after the Phase 5 checkpoint:

(a) **Find the target system's chapter from the Table of Contents — never assume a chapter number.**
   Numbering varies by plant and even by unit: at Hatch Unit 1, "Chapter 10" is *Auxiliary Systems*,
   not Steam & Power Conversion. Read the TOC (or Active Page List) for the specific unit first.
(b) **Use each revision's Active Page List to find which revisions actually changed that chapter's
   pages**, and deep-read only those — anchored to the design-basis events found in Buckets 1, 2, 4,
   and 5 (an amendment or 50.59 item tells you *what* changed and *when*; the UFSAR diff confirms how
   the licensing text was updated to match).
(c) **If the earliest needed revision is legacy microform with no usable digital text**, use the
   earliest *digital* revision as the proxy baseline and **flag the true baseline** for manual PDR
   (Public Document Room) retrieval.

#### Bucket 4 — ISI / 10 CFR 50.55a Relief Requests & Alternatives

A **separate regulatory track** from amendments and 50.59 reports. Under 10 CFR 50.55a a licensee
requests relief from, or an alternative to, an ASME Code inspection requirement — this is how
weld-overlay repairs and alternative-inspection approvals on **pressure-boundary components**
(including a system's nozzle and piping welds) get authorized. For a feedwater nozzle, a weld-overlay
approval lives on this track.

Pull the clean set **BY DOCUMENT TYPE, not by keyword**: `DocumentType starts "Code Relief or
Alternative"` and `DocumentType starts "Inservice/Preservice Inspection and Test Report"`. Why not
keyword: relief requests are titled by **number** (e.g. "RR-34"), so a system keyword would never
match them. Then read titles/content to find which ones scope the target system.

**Cross-check** with free-text `"<system> nozzle"` and `"weld overlay"` to catch items that were
mis-typed as plain `Letter` and would otherwise escape the type filter.

#### Bucket 5 — Generic-issue / Vendor Design-Basis Correspondence

Part of a system's design basis is defined not by a plant-specific amendment but by a **named generic
or vendor issue** the plant must address. For a BWR feedwater nozzle, this is the **NUREG-0619**
thermal-fatigue layer (feedwater-nozzle/sparger cracking) and the related **BWRVIP** (BWR Vessel and
Internals Project) correspondence. Other systems and plant types have their own defining
generic/vendor issues.

Search with **PRECISE free-text discriminators**, because these terms pinpoint the documents
regardless of how a title is phrased:
- an **exact identifier** — e.g. the NUREG number (`"NUREG-0619"`), a generic-letter or bulletin number
- a **component name** — e.g. `"feedwater sparger"`
- a **named basis** — the specific fatigue or cracking basis the issue is known by

Then cast **one deliberately broad net** (e.g. `"BWRVIP"`) and **triage it down hard** — most material
under a broad program name is unrelated to the target system, so the broad net exists to catch the
stray relevant item, not to be reported wholesale.

This bucket is **system-agnostic**: choose the discriminator terms that fit the actual system and
plant type in front of you. The examples above are for a BWR feedwater nozzle; a PWR steam generator,
a main-steam line, or a reactor-coolant-pump seal would each have a different set of defining issues.

---

## Phased Workflow — Interpret → Confirm → Search → Confirm → Read → Approve → Deliver

For any non-trivial request, run seven phases with two human gates: one before any search runs
(Phase 3, confirm the search plan) and one before any document is opened (Phase 5, confirm what
to read). Phase 4 is cheap metadata work; Phase 6 is expensive and is where interpretive errors
compound.

> **Hard rule — answering at a gate stays at the gate's phase.** When work is paused at the Phase 3
> or Phase 5 checkpoint and the user asks a probing question, answer it **at the current phase's
> level only** — search results, metadata, and inventory. Do **NOT** silently cross into Phase 6 and
> start opening documents to chase the answer. If answering it well would require reading document
> text, **stop and OFFER to open them** — name exactly which documents you would read and why — then
> **wait for approval** before reading anything. *Why: this session the agent jumped from the Phase 5
> gate straight into document reading to chase a 50.59 question, and the user had to halt it.*

### Phase 1 — Query Receipt
The user enters their request. Read it fully before doing anything else.

### Phase 2 — Interpretation & Search Plan
Repeat the query back in plain language and state exactly how you intend to execute it. Cover:

- **Dockets:** list the specific docket numbers you will search and which units they correspond to.
- **Search method for each term:** state whether each key term will be searched as free text in the
  `q` query, a `DocumentType` filter, or a `DocumentTitle` filter — and why. Be explicit. Example:
  *"I'll search 'A-CAST' as free text in the `q` query. This matches any document containing that word
  anywhere in its text or metadata — not just documents classified under a specific Document Type. If
  you want Document Type only, say so."*
- **Date range:** state the range you will apply, or note that none was specified.
- **Any ambiguities:** call out anything you resolved with a default assumption so the user can
  correct it before the search runs.

Present this as a short plain-language summary, not a table. End with: *"Reply 'go' to proceed
with this plan, or correct anything above."*

### Phase 3 — Checkpoint: Confirm Search Plan (STOP and wait)
Do not run any search until the user responds. This gate exists so the user can catch
misinterpretations — wrong dockets, wrong search method, wrong date range — before any work runs.

### Phase 4 — Search & Triage (runs after user says "go")
- Run all needed searches — single search or the five design-basis buckets — without pausing
  between them. You may show planned searches inline as you proceed.
- Extract from the **search JSON only** (metadata): accession number, full title, document date,
  document type. **Do not call Get Document / open any document yet.**
- Categorize all results using the four-tier rating system below before proceeding to Phase 5.
  (The five buckets above are *searches*; the four tiers here are the *rating* applied to each
  result. They are different axes — every document returned by any bucket gets exactly one tier.)

Rate every result with one of four tiers before the checkpoint:

- **★★★ HIGH** — directly affects the system's design basis (e.g., power uprate, setpoint
  change, flow measurement basis change, control system replacement). Open first.
- **★★ MEDIUM** — plausibly affects the system but requires reading to confirm (e.g., TS
  amendment touching an adjacent system, 50.59 item with a relevant tracking number,
  UFSAR revision with active pages in the target chapter).
- **★ LOW** — peripheral connection; probably does not affect the design basis but must be
  confirmed by reading (e.g., SLR FSAR parts, drawing packages, TRM sections). Note: FSAR documents
  filed as "Part N of M" under a Subsequent License Renewal (SLR) are baseline snapshots that may
  reflect an earlier revision and use a different part-numbering scheme than the current UFSAR chapter
  packages — confirm which chapter they cover from the first page before reading.
- **— NOISE** — no plausible connection (operator licensing exams, cover letters, LERs /
  event notifications, unrelated plant systems). Exclude without opening.

**LERs and operational events are NOISE for design-basis-change purposes.** A Licensee
Event Report (LER) documents what happened during an event — it is not a change to the
design basis. Categorize all LERs and event notifications as NOISE unless the LER text
explicitly references a corrective design basis change.

All HIGH, MEDIUM, and LOW documents are opened in Phase 6.
Only NOISE documents are excluded.

**Phase 4 output rules:**
- **Chat output only — Phase 4 never writes a file.** All triage results stay in the Claude
  chat response. No markdown report, no saved document. The only file this skill ever produces
  is the approved Phase 7 PDF deliverable.
- **Hyperlink every ML number** using the `Url` field (or the ML-PDF URL pattern from
  Output / Report Columns). No bare accession numbers.
- **Visual cap of 20 documents.** If the combined triage spans more than 20 documents across the
  groups, show the top 20 (highest-rated first, within each bucket) and state plainly that
  more are available on request — e.g. *"Showing 20 of 47 triaged documents; reply for the full
  list."* This keeps the checkpoint readable; the full set is still tracked and available.

### Phase 5 — Checkpoint: Confirm Documents to Open (STOP and wait)
Present results as a triage table with columns: Accession No. | Title | Date | Rating (★★★/★★/★/—) | Rationale (one line). Group by Bucket 1 / Bucket 2 / Bucket 3 / Bucket 4 / Bucket 5, then by rating within each group. After the table, state:

*"Phase 4 complete. All [N] documents rated HIGH, MEDIUM, or LOW will be opened in Phase 6.
[N] documents rated NOISE are excluded. Reply 'go' to proceed, or adjust any ratings before
we open documents."*

Do not open any document until the user responds.

### Phase 6 — Read & Extract (only after the user says "go")

> **Read before you conclude.** Never state what a document says — or rule it in or out — from
> its title or metadata alone. Every characterization, and every entry in the "ruled out" list,
> must come from actually reading the document text. Describing or dismissing a document
> from its title is not allowed.

**Document-reading mechanics (follow in order):**

(a) Retrieve the document's text via the **Get Document** endpoint, by accession number — prefer the
MCP server's get-document tool, fall back to `GET https://adams-api.nrc.gov/aps/api/search/{ML}`. This
returns the indexed plain-text `content` directly; no PDF fetch or OCR needed.

(b) If `content` comes back **empty or sparse** (scanned-image-only or very new documents), fall back
to fetching the PDF at the document's `Url` (or reconstruct the ML-PDF URL), and note that OCR
reliability is lower.

(c) If the content is too large to read inline in the main thread, hand it to a subagent that reads it
fully and returns a concise structured finding. Use `EstimatedPageCount` to anticipate this. Keep the
main thread clean.

(d) Cite locations as **page first, then section** — e.g., "p. 14 (Section 3.2)."

**Scope and batching rules:**
- **Open all non-NOISE documents.** Every document rated HIGH, MEDIUM, or LOW in the
  Phase 5 triage must be opened and read. Do not limit Phase 6 to HIGH-rated documents
  only. LOW-rated documents still get opened — they just get read more briefly.
- **Scope tightly:** focus on the relevant portion — the amendment's safety evaluation, the
  specific UFSAR chapter, the specific calc — not entire packages.
- **Batch and summarize:** emit a short structured finding per document (what changed + citation),
  not full text. For large sets, fan out with subagents.
- **Flag sparse/scanned docs:** if Get Document returned little or no content and the PDF is a scanned
  image, note that OCR is required and reliability is lower; defer or confirm if costly.
- Synthesize findings into a draft analysis and present it **in the chat** for the user to
  review and tweak. **Use the exact structure of the Final Analysis Report Format** (same
  numbered sections, same hyperlinked-ML conventions) so what the user sees in Phase 6 matches
  what the Phase 7 PDF will contain. **Do not write a file in Phase 6** — this is an in-chat
  draft only. The file is created once, in Phase 7, after the user approves.

#### Large multi-chapter bundles

Very large multi-chapter PDFs — for example, a UFSAR (Updated Final Safety Analysis Report, the
plant's master licensing-basis document) submitted as a single "Chapters 8 through 18" bundle — can
return a very large `content` blob. The API does **not** truncate it the way the browser grid did, but
it can be too big to read inline.

**When this happens, chunk it or hand it to a subagent** — read the target chapter/section, not the
whole bundle. This is normal API work, not a dead end.

For a **visual, chapter-by-chapter redline** between two UFSAR revisions, a human can still download
both revisions from their `Url` fields and compare on **draftable.com**. With the API this is now an
*optional* convenience for visual side-by-side review — not a forced escalation, because the API
returns clean text the model can diff directly. When directing the user to this step, always name the
tool as 'draftable.com' — do not use shorthand like 'draftable comparison' alone, as users may not
know what tool is meant.

### Phase 7 — PDF Delivery (only after the user approves the final report)
Once the user has reviewed the draft report in chat (the Phase 6 draft) and confirmed it is ready —
do not create the file speculatively — render the approved report to a bookmarked PDF. **PDF is the
only deliverable. Do NOT save a markdown file** — markdown is only a temporary build source for the
PDF and should not be presented or kept as an output.

- **Filename:** `YYYY-MM-DD - [Plant] [System] Gap Analysis.pdf` (e.g.,
  `2026-06-07 - Watts Bar Feedwater Gap Analysis.pdf`)
- **Content:** the full approved Final Analysis Report, exactly as confirmed — no silent changes.
- **ML number hyperlinks must be preserved.** Every accession number in the report — in
  Findings, in "Filtered at checkpoint," and in "Evaluated and ruled OUT" — must appear as a
  clickable link using the ML-PDF URL pattern. Do not write bare ML numbers. This report
  will be shared; recipients need working links to open each document directly from the file.
- **Destination:** save to the skill's standard project/results folder (the project folder where
  this skill is being run), or to whatever path the user specifies.
- Present the PDF for download. Note that the user may transfer this file to other machines or
  use it as input for further work.

**PDF build recipe:**

1. Write the approved report to a temporary `.md` file (build source only — delete or ignore it
   after the PDF is produced; it is never a deliverable).
2. Render with pandoc:

   ```
   pandoc report.md -o "<name>.pdf" --pdf-engine=xelatex \
     --shift-heading-level-by=-1 -V mainfont=Lato -V sansfont=Lato \
     -V monofont="Liberation Mono" -V geometry:margin=1in -V fontsize=11pt \
     -V colorlinks=true -V linkcolor="[HTML]{2E5A88}" -V urlcolor="[HTML]{2E5A88}" \
     -H header.tex
   ```

3. `--shift-heading-level-by=-1` makes the H1 title a title block and gives the PDF outline its
   sections at level 1 with Findings nested at level 2. Do **NOT** use `--toc`.
4. `header.tex` contains: titlesec sans/colored headings, parskip, `\linespread{1.13}`, enumitem
   list spacing, and a titling-styled title block.
5. **The PDF outline must come from the markdown headings via pandoc/hyperref — never added
   after the fact.** Do not build the PDF another way and then stitch bookmarks in with pypdf
   (`add_outline_item`) or similar: without real heading anchors you can't know the pages, and
   every bookmark lands on page 1. If the pandoc render fails, fix the render — do not fall back
   to a different PDF builder plus manual bookmarks.
6. **Verify bookmark destinations before presenting.** Dump the outline with pypdf and confirm
   bookmarks resolve to distinct, increasing page numbers — not all page 1:

   ```python
   from pypdf import PdfReader
   r = PdfReader("<name>.pdf")
   def walk(o, d=0):
       for b in o:
           if isinstance(b, list): walk(b, d+1)
           else: print(" "*d, b.title, "-> page", r.get_destination_page_number(b)+1)
   walk(r.outline)
   ```

   If every bookmark reports page 1, the outline was not generated from real headings —
   re-render per the recipe above; do not deliver the PDF in that state.
7. **Fonts:** Lato covers the report's special glyphs (— " ² · × ≥ ° – →). If a swapped font
   doesn't cover them, fall back to TeX Gyre Pagella. Keep ML numbers as clickable links.

---

## Final Analysis Report Format

This section governs the deliverable for design-basis or multi-document analysis work — distinct from
the per-search results table produced during Phase 4. Use this format when synthesizing findings
across multiple documents into a final answer.

> **Write for non-experts.** Define every acronym at first use. Give each cited document a
> plain-language "what this is / why you'd open it" descriptor so the reader can evaluate its
> relevance without prior ADAMS or licensing experience. Do not assume the reader knows what a
> License Amendment, LER, ISI alternative, or UFSAR chapter is.

> **Lead with a plain-language bottom line.** For contention-prone or jargon-heavy topics — 50.59
> coverage especially — **lead every chat answer with a one-or-two-sentence plain-language bottom
> line** a non-specialist can follow (e.g. *"covered cleanly through Aug 2020, then a two-year hole
> with no report on file"*), and **only then** give the revision numbers, tracking IDs, and dates.
> *Why: in this session the detail lost the reader until the bottom line came first.*

> **Page numbers are approximate.** All page references are PDF page numbers (the counter your
> PDF viewer shows, starting from page 1 of the file), not the printed page numbers inside the
> document. They are estimates based on how the text was parsed and may be off by a page or two.

### Structure (required, in this order)

**These five sections are the complete structure. Do not add additional sections, tables, or supplementary parts — weave all relevant details into the findings.**

**1. Introductory Paragraph**

A short plain-language summary paragraph, before the numbered findings, that covers:
- What plant and system this analysis covers
- The date range searched
- How many ADAMS documents were reviewed in total (candidates opened, not the full result count)
- One sentence on the overall conclusion (e.g., "The primary design-basis changes to the feedwater
  system since the EPU stem from three license amendments and one ISI alternative request.")

This gives a non-specialist reader enough context to orient themselves before diving into the
numbered findings.

**2. Findings — numbered from most impactful to least**

Number every finding so it can be referenced in discussion. For each:

- A short plain-language description of what changed or was found
- A nested **Documents:** list, with:
  - Each accession number hyperlinked: `[ML25002A257](https://www.nrc.gov/docs/ML2500/ML25002A257.pdf)`
  - After the link: a plain-language descriptor, e.g.:
    *"License Amendment 264 — formal NRC approval of the feedwater nozzle weld overlay; this is
    the document that officially changed the plant's licensing basis."*
  - Under key documents, nested location bullets in the form:
    `p. <N> (Section <x>): <what's there>`
    Example: `p. 14 (Section 3.2): Table of revised flow rates showing the uprated feedwater flow limit`

**3. Filtered at checkpoint (not opened)**

List the documents rated NOISE in Phase 4 and excluded at the Phase 5 checkpoint before any
reading occurred. For readability, sub-group the NOISE tier into:

- **Operational events** (a subset of NOISE) — LERs, event notifications, and similar. For each:
  accession hyperlink, plain-language descriptor, one sentence on why it's an operational event
  rather than a design-basis change.
- **Other noise** — licensing exams, enclosures, cover letters, and other pollution. A brief count
  and description is sufficient; individual entries are not required unless one is borderline.

This section exists so the reader can see the full scope of what ADAMS returned and verify the
filtering judgment, not just the documents that were opened and read.

**4. Evaluated and ruled OUT**

List every candidate that was opened and read but determined not to apply. For each, give:
- The accession hyperlink and plain-language descriptor
- One sentence explaining why it was ruled out (based on reading the document, not its title)

**5. Recommended Next Steps for a Human**

List anything the API method could not complete — documents whose indexed `content` came back empty or
scanned-only (so OCR review is needed), documents that require plant-internal records to interpret,
optional draftable.com redlines for visual chapter comparison, or analysis that exceeds the scope of
automated search. Be specific: name the document, the gap, and the suggested human action (e.g.,
"Download ML22300A100 and compare Section 10.4.7 against the pre-EPU revision on draftable.com").
