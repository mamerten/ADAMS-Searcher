# Hatch Nuclear Plant — Design Basis Change Search Guide


## Mat's ADAMS Mental Model

Documents on a plant's docket fall into four buckets:

### Licensee → NRC

Submitted by the plant operator:

- **Event Reports** — immediate notification of a plant event (hours after occurrence)
- **LER** — formal written follow-up, due within 60 days
- **TS Amendment Request** — request to revise Technical Specifications
- **ISI Alternative Request** — request for an alternative inspection method or frequency
- **SLR Application** — supplements, RAI responses, architectural surveys, etc.
- **BWRVIP Correspondence — to NRC** — submittals and deviation notifications (BWR only)
- **RAI Response** — response to an NRC RAI during a licensing review
- **Biological Report for SLR** — one-time assessment to FWS/NMFS in the SLR process
- **50.59 Annual Report** ("Summary of Facility Changes") — periodic summary of facility changes, tests, and experiments
- **UFSAR** — submitted every two years; reflects all licensing-basis changes since the last revision
- **Required Routine Reports** — fitness for duty; radiological (effluent release, environmental operating)

---

### NRC → Licensee

Issued or sent by the NRC:

- **Integrated Inspection Report (IIR)** — quarterly, covering multiple inspection areas
- **Inspection Annual Assessment** — annual performance rating letter
- **Special Inspections** — topic-specific or reactive inspections outside the routine IIR (fire protection, security, focused engineering, PI&R, etc.)
- **Exam Report** — licensed operator examination results
- **SLR Evaluation Report** — NRC safety evaluation of the SLR application; includes audit reports and RAIs
- **RAI** — information request during a licensing review
- **Various Correspondence** — BWRVIP answer-backs; ISI answers (authorization/denial); TS answers and issuances (including TSTF adoptions); RAIs embedded in other letters

---

### Environmental / NEPA / Section 106

Mostly SLR-driven:

- **SLR documents** — Environmental Assessment (EA), Finding of No Significant Impact (FONSI), Federal Register notices, EA errata
- **Two-way correspondence** — NRC produces the EA; tribes, SHPO, ACHP, FWS, NMFS, and state agencies respond. Both directions appear in ADAMS.

---

### NRC Internal / Administrative

- **NRC publications** — NUREGs, regulatory guides, generic letters, bulletins, information notices (when applicable to the docket)
- **SLR intra-agency coordination** — ACRS notices, Federal Register milestones, FWS/NMFS coordination
- **Public engagement** — meeting notices, summaries, news releases
- **Administrative** — personnel/organizational changes that touch the docket incidentally

---

## What Is a Design Basis?

The set of requirements, limits, and assumptions defining how a system must be built and perform to ensure safety under all analyzed conditions. It is not a single document — it lives across several document types, which is why tracking changes means searching several of them.

---

## High-Level Approaches to Interface with ADAMS

Three ways to get documents out of ADAMS; pick what fits your tools:

**1. Web, manual.** Build the search by hand in the Advanced Search UI at https://adams-search.nrc.gov — set dockets, dates, and filters, run, export. No AI or API key. The fallback when nothing else is available; its mechanics and quirks are covered below.

**2. LLM-built search URL.** An ADAMS search can be expressed as one long JSON-encoded URL. Describe what you want to an LLM, get the URL, paste it into your browser — no UI clicking, no API key. Mat can provide something.

**3. AI assistant connected to ADAMS** (Claude Cowork, ChatGPT Codex, etc.). **Connecting via the ADAMS API is preferred** — faster, more reliable, returns full titles, and pulls a document's indexed text so the AI can actually read it. (Setup in `ADAMS-MCP-Setup`; needs an NRC API subscription key.) The same AI can drive the web UI if no key is available — slower, but works.

---

## ADAMS Search Setup

**URL:** https://adams-search.nrc.gov/home → Advanced Search

**Hatch Docket Numbers** — the per-unit filing identifier; It is a bit strange

| Unit | Docket Number |
|---|---|
| Unit 1 | 05000321 |
| Unit 2 | 05000366 |

Searching **05000321** with "Contains" returns Unit 1 and joint Unit 1 & 2 documents. For Unit 2 only, search 05000366 separately.

**Date Range.** For design-basis change tracking, start from the EPU implementation date. Hatch's completed EPU: applied August 8, 1997; amendments issued October 22, 1998; uprated operation ~1999. For gap analysis supporting the next EPU, search **January 1, 1999 to present**.

**Site note:** the APS site is slow and can freeze when adding filter rows. If it freezes, use a fresh tab and rebuild.

---

## Tips, Tricks, and Gotchas

### AND / OR Logic — Get This Wrong and Your Results Will Be Wrong

ADAMS splits criteria into **ALL** (AND) and **ANY** (OR). Everything in ALL must match; at least one ANY condition must match.

Put **both dockets in ANY (OR)** so you get documents tagged to either unit. Putting one docket in ALL and the other in ANY forces both onto every document — returning only joint filings and silently dropping unit-specific ones. **Date ranges go in ALL (AND).**

Correct structure:
- **ANY:** Docket contains 05000321 / Docket contains 05000366
- **ALL:** Document Date between [start] and [end]

### The "Keyword" Metadata Field Is Sparse — Don't Rely on It

ADAMS has a "Keyword" property NRC staff are supposed to populate, but most documents leave it blank — useless for filtering or categorizing. Terminology: **"Keyword"** = the (unreliable) metadata field; **"search term"** = text typed into the general search box (full-text, works well). The UI confusingly calls both "keyword." In this guide, "search term" always means the search box.

### The Search Bar Searches Content AND Properties — Multiple Words Are AND

The main search bar ("Enter Search Term(s) — Searches Content & Properties") searches document content and metadata together. Multiple words are ANDed — every word must appear somewhere. No OR logic here; OR lives in the Any (OR) tab. So `main steam amendment` returns documents containing all three words — a built-in narrowing without a property filter.

### Search Bar vs. Document Type Property — Very Different Behaviors

A search term matches words anywhere in body or properties, including passing references — more results, more noise. The **Document Type** property targets NRC-assigned tags — fewer, cleaner results.

| Approach | Search | Results |
|---|---|---|
| Full-text keyword | "technical specification amendment" | ~800 (both sides plus noise) |
| Document Type property | issued amendments only | roughly half the volume, NRC issuances only |

Use Document Type for one side of the amendment pair (the issuance); use full-text when you want everything referencing the subject and will filter manually.

⚠️ **The Document Type value differs by interface — and the wrong one fails silently.** In the **API** (and the AI/connector approach), the issued-amendment type is **`License-Operating`**; the literal strings `License Amendment` and `Amendment` return **zero** results with no error. Always use `License-Operating` for issued amendments and `License-Application for Facility Operating License` for licensee applications.

### The Report Button Exports a CSV — A Good Working Tool

After a search, select all results (header-row checkbox selects across all pages), then click **Report** to export a CSV of every selected document's metadata (accession, title, date, type, docket, author, more).

For an initial gap analysis this CSV beats downloading PDFs. Workflow: search → select all → Report → CSV → Excel → filter the **Document Title** column → open only the PDFs you need. Document Title is reliably populated; ignore the mostly-blank Keywords column.

---

## Document Types to Search — By Priority

Five document types give a complete design-basis picture: formal NRC-approved changes first, internal-authority changes second, UFSAR confirmation third, then the two tracks the first three structurally miss — ISI relief requests and the vendor/generic layer.

## Recommended Search Order for Design Basis Gap Analysis

| Step | Document Type | Why |
|---|---|---|
| 1 | TS Amendments | Clearest formal record; discrete dates; easy to scope by system |
| 2 | 50.59 Annual Reports | Captures changes made without NRC approval |
| 3 | UFSAR Submissions | Verification/synthesis; confirms changes reached the licensing basis |
| 4 | ISI / 50.55a Relief Requests and Alternatives | Separate 50.55a track invisible to 1–3; weld overlays and alternative inspection on system welds/nozzles |
| 5 | NUREG-0619 / BWRVIP / Vendor Correspondence | Plant- and vendor-specific design-basis layer (e.g., BWR feedwater-nozzle fatigue) |

**Don't stop at TS amendments.** The cleanest record is a TS amendment, but the most substantive design changes often arrive through other paths. Also look for:

- **Power uprates** — MUR (Measurement Uncertainty Recapture) and EPU packages
- **ISI alternatives / weld overlays** — 10 CFR 50.55a relief requests
- **Nozzle fracture-mechanics / P-T calculations** — Pressure-Temperature limit curves and their analyses

These won't all arrive as TS amendments at all — which is exactly why Buckets 4 and 5 exist. Search and review for them too.

**LERs and event notifications are not design-basis changes.** An LER documents what *happened* during an event — operational, not a design change. Set them aside unless the text explicitly references a corrective design-basis change.

---

### 1. Technical Specification (TS) Amendment Requests and Issuances

The most direct, legally binding record of formal changes requiring NRC approval. Every TS amendment changed something in the licensing basis.

**Pull every issued amendment in the window — do NOT narrow by a system keyword.**
- Dockets 05000321 and 05000366 — both in ANY (OR)
- Date range: your window
- Document Type `License-Operating` (issued NRC amendments), **no system keyword** — then triage all results by title.

**Why no keyword:** a system token like `feedwater` only matches amendments whose indexed text contains that exact string. Amendments that phrase the system differently — *feed pump*, *reactor water level*, *high-energy line break*, *condensate* — drop out silently. The two failure modes aren't symmetric: a no-keyword sweep **over-returns** (extra hits the triage step removes — harmless), while a keyword filter **under-returns** (a real design-basis amendment is never seen — unrecoverable). Take the noise; never take the miss.

**Critical — the Document Type value is `License-Operating`, not "License Amendment."** In the ADAMS API, filtering on `License Amendment` or `Amendment` returns **zero results** — neither string is in the controlled vocabulary, and the API fails silently (an empty set reads like "nothing exists"). The issued-amendment type is **`License-Operating`**. Licensee *applications/requests* are `License-Application for Facility Operating License`.

**What you'll get:** requests (titled "Application to Revise Technical Specifications…") and issuances (titled "Issuance of Amendment Nos. X and Y…"). The issuance is authoritative — it carries the NRC safety evaluation and the changed TS pages.

**Filter tip:** results include TSTF adoptions and fleet-wide SNC items. Review titles to separate Hatch-specific from fleet items.

---

### 2. 50.59 Annual Reports (Summary of Facility Changes)

The licensee's periodic summary of its 50.59s — where you find design-basis changes that never went through a formal amendment (the "motor that grew in horsepower").

**Search setup:**
- Dockets 05000321 and 05000366 — both in ANY (OR)
- Date range: your window

**Search three title conventions separately, then de-duplicate.** Hatch's summary has appeared under three titles:

- `Summary of Facility Changes, Tests, and Experiments`
- `Summary of Changes to the Facility`
- `10 CFR 50.59 Summary Report`

**Don't shortcut with one loose title search.** A single search for `summary of facility changes` matches the words individually and pulls false hits (e.g., "Summary of Public Meeting"). Run the three distinct strings.

**Coverage gaps — NRC inspection fallback.** Licensees occasionally miss a filing, and the earliest reports (~1999–2003) may not be in ADAMS. When a year has none, search NRC inspection reports under **IP 71111.21** (the 50.59 review). These triennial inspections sample the plant's 50.59 evaluations over ~3 years — not a complete substitute, but they surface what the NRC reviewed.

**Limitation:** the report is a summary, not engineering detail — changes by tracking number with a brief description. The underlying evaluation, calculation, and design-change package live in the plant's internal system, not ADAMS. Scan every line for tracking numbers touching your system and flag them for plant-record follow-up. ADAMS gives the list, not the detail.

---

#### How Hatch actually files these (read this — it's the confusing part)

The above is the generic picture. Hatch's 50.59 reporting does two things that don't match the "one annual report" expectation, both verified by pulling the documents (June 2026).

> **The full chain is already worked out — cross-check it, don't re-derive it.** A companion file in this project, **`Hatch 50.59 Summary Report Master Index.md`**, is the authoritative, cover-letter-verified list of every Hatch 50.59 report from 1999 to present — with coverage periods, the inferred boundaries, and the known gaps. Start there. If a search turns up a 50.59 report that isn't on that list, the index is stale — add it.

**It's not annual, and the format changed in 2011.** Hatch files this roughly every **24 months**, and the packaging changed mid-window:

- **Through 2008 — standalone.** Actual title: **"Report of Facility Changes, Tests, and Experiments — Safety Evaluation Summaries"** (*Report of*, not *Summary of* — the generic list above is close but inexact). Find with `Report of Facility Changes Tests Experiments`.
- **2011 onward — bundled into the UFSAR.** The same report became an enclosure in the biennial UFSAR transmittal letter, titled "10 CFR 50.59 Summary Report."

**A Document Type filter MISSES them — the trap.** Filtering by `Updated Final Safety Analysis Report` does **not** return the bundled reports, because the transmittal cover letters are typed **"Letter,"** not "UFSAR." Drop the type filter and use full-text title phrases: `Report of Facility Changes Tests Experiments`, `Submittal of Revision Updated Final Safety Analysis Report`, `10 CFR 50.59 Summary Report`. The type filter alone hides ~half the chain.

**Cadence is irregular — do NOT assume a two-year rhythm.** The regulatory ceiling is ≤24 months (10 CFR 50.71(e)), but Hatch's actual history is lumpy: 24-month standalone reports through 2008, then a ~5-year span (2011→2016), then annual (2018, 2019, 2020), then a ~4-year span (2020→2024). A 2019 schedule exemption is part of why the rhythm shifted. Verify each report's stated coverage period from its cover letter — don't predict the next filing year.

**There are two genuine coverage gaps — don't paper over them.** Reading the cover letters end-to-end shows the chain is *not* fully continuous. Two windows have no 50.59 report in ADAMS at all:

- **1999 → ~2001** — predates the revised 50.59 rule; no standalone report exists before the 2004 one. It may have ridden the annual operating report or early FSAR updates. To close: check the era's annual operating reports / old-rule FSAR submittals, or request from the NRC Public Document Room (PDR).
- **Sept 2020 → Aug 2022 (the "Rev 39" window)** — a report was *required* (a 2020 NRC exemption set Hatch's schedule to Aug 31 of every even-numbered year: 2020 / 2022 / 2024), but no 2022 UFSAR-or-50.59 submittal exists anywhere in ADAMS. Rev 40 picks up in Sept 2022, not 2020. Backstop: the NRC's 2022 triennial 50.59 inspection ([ML22140A110](https://www.nrc.gov/docs/ML2214/ML22140A110.pdf)) sampled the program for this era. To close: request the Rev 39 report directly from SNC.

The middle stretches with no separate filing (e.g. 2009–2010, 2013–2014) are *not* gaps — bundled reports carry a multi-year lookback and fold them in; that was confirmed against the cover letters. For any period with no traceable filing, the NRC triennial 50.59 inspection (IP 71111.21) is the backstop — but flag the gap explicitly for plant-records follow-up rather than assuming a later report swept it up.

**The full 50.59 report chain by reporting period:**

| ML number | Filed | Format / UFSAR Rev | Period covered |
|---|---|---|---|
| [ML040440165](https://www.nrc.gov/docs/ML0404/ML040440165.pdf) | 2004-02-10 | Standalone | 2002–2003 |
| [ML060530028](https://www.nrc.gov/docs/ML0605/ML060530028.pdf) | 2006-02-20 | Standalone | 2004–2005 |
| [ML080601276](https://www.nrc.gov/docs/ML0806/ML080601276.pdf) | 2008-02-29 | Standalone | Jan 2006 – Dec 2007 |
| [ML11320A042](https://www.nrc.gov/docs/ML1132/ML11320A042.pdf) | 2011-10-24 | Bundled, Rev 29 | 2008 – Sept 2011 |
| [ML16244A381](https://www.nrc.gov/docs/ML1624/ML16244A381.pdf) | 2016-08-25 | Bundled, Rev 34 | 2011 – July 2016 |
| [ML18256A066](https://www.nrc.gov/docs/ML1825/ML18256A066.pdf) | 2018-08-30 | Bundled, Rev 36 | 2016 – mid-2018 |
| [ML19282B793](https://www.nrc.gov/docs/ML1928/ML19282B793.pdf) | 2019-09-26 | Bundled, Rev 37 | July 2018 – Aug 2019 |
| [ML20303A178](https://www.nrc.gov/docs/ML2030/ML20303A178.pdf) | 2020-09-29 | Bundled, Rev 38 | Sept 1 2019 – Aug 31 2020 |
| [ML24249A080](https://www.nrc.gov/docs/ML2424/ML24249A080.pdf) | 2024-09-03 | Bundled, Rev 40 | Sept 2022 – July 2024 |

*Fuzzy spots (a report covers the period, but the exact boundary is inferred — these are NOT gaps):* the **Sept 2011 → Dec 2012** start edge of the Rev 34 span (its dated entries run 2013–2015, so the earlier months rest on continuation from Rev 29's stated end), and the **2002–2007** standalone reports, which state only "24-month report" with no printed dates. See `Hatch 50.59 Summary Report Master Index.md` for the full fuzzy-spot / gap breakdown and the closing actions.

---

### 3. UFSAR Submissions

The UFSAR is updated every two years to reflect all facility and licensing-basis changes since the last revision — the most comprehensive snapshot.

**Search setup:**
- Dockets 05000321 and 05000366 — both in ANY (OR)
- Date range: your window
- Search term: `updated final safety analysis report` OR `UFSAR`

**What you'll get:** transmittal letters and individual chapters submitted as separate documents in a package. Each revision is numbered (most recent: Revision 40, September 2024).

**How to use it:** pull the baseline-era revision and the current one, then compare the chapter(s) for your system. Differences are licensing-basis changes — whether they got there via amendment, 50.59, or otherwise.

**Confirm the chapter for the specific unit — don't assume.** Numbering varies by plant and even between units. Don't rely on "Chapter 10 = Steam & Power Conversion" — at Hatch Unit 1, Chapter 10 is Auxiliary Systems. Open the Table of Contents or Active Page List (APL) for that unit, confirm which chapter covers your system, then diff that one chapter across revisions — not the whole package.

**Watch out for SLR FSAR parts.** FSAR documents filed as "Part N of M" under a Subsequent License Renewal submission are baseline snapshots for the SLR review — possibly an older revision with a different part-numbering scheme. Low priority; confirm which chapter they cover from the first page.

**If the baseline revision is legacy microform** with no usable digital text, use the earliest *digital* revision as a proxy baseline and flag the true baseline for manual Public Document Room (PDR) retrieval.

**Visual comparison:** download both revisions and redline on **draftable.com**. Optional — via the ADAMS connector the text comes back directly and can be diffed without downloading — but draftable.com is the easiest human-readable redline.

**Document Type alternative:** filter by `Updated Final Safety Analysis Report` (contains) for a UFSAR-only result set.

---

### 4. ISI / 10 CFR 50.55a Relief Requests and Alternatives

A **separate regulatory track** from amendments and 50.59s — so Buckets 1–3 can't see them. These are requests to use an alternative inspection method, frequency, or repair (weld overlays, alternative NDE, code cases) on pressure-boundary components, approved under 10 CFR 50.55a. For any system with inspected Class 1/2 welds — feedwater nozzle, feedwater piping, recirculation, RPV — this is where changes to the inspection/repair basis live. The feedwater nozzle is one of the most-relieved components in a BWR.

**Search setup:**
- Dockets 05000321 and 05000366 — both in ANY (OR)
- Date range: your window
- **Pull by Document Type, not keyword:** `Code Relief or Alternative` and `Inservice/Preservice Inspection and Test Report`

**Why type, not keyword:** relief requests are titled by *number* ("RR-34," "HNP-ISI-ALT-09"), not by system, so a `feedwater` search skips one covering feedwater-nozzle welds. Pull the full set by type, then read to find which scope your system.

**What you'll get:** numbered relief requests and their NRC safety evaluations; ISI program plans and owner's activity reports per 10-year interval.

**Cross-check:** also search `<system> nozzle` and `weld overlay` to catch items filed as plain "Letter" (how Hatch's RR-32/33 and the 2008 dissimilar-metal weld overlay surfaced).

---

### 5. NUREG-0619 / BWRVIP / Vendor Design-Basis Correspondence

The **plant- and vendor-specific design-basis layer** — the named generic and vendor issues defining how a system is built and monitored. For a BWR feedwater nozzle, that's **NUREG-0619** (feedwater nozzle/sparger thermal-fatigue cracking) and its fatigue-monitoring basis, plus **BWRVIP** correspondence. None of this necessarily appears as an amendment, a 50.59 line, or a UFSAR change, so it needs its own search.

**Search setup:**
- Dockets 05000321 and 05000366 — both in ANY (OR)
- Date range: your window
- **Precise full-text discriminators** (an exact NUREG number, component name, or named basis pinpoints these regardless of title):
  - `NUREG-0619`
  - `feedwater sparger`
  - `feedwater nozzle fatigue`
  - `BWRVIP` (broad net — triage hard; most BWRVIP material is core-shroud/recirc, not feedwater)

**What you'll get:** licensee submittals and deviation notifications referencing the generic issue (e.g., BWRVIP-75/-130); fatigue-monitoring / fracture-mechanics evaluations tied to the nozzle.

**System- and plant-specific.** The terms above are for a BWR feedwater nozzle. For another system, swap in the generic/vendor issues defining *its* design basis. Structure stays the same: a few tight discriminators plus one broad net you triage down.

---

## Filtering

### By System

Add a system keyword to the search box in any search above:

- `main steam amendment` — TS amendments mentioning main steam
- `main steam 50.59` — facility-change reports mentioning main steam
- `main steam safety analysis` — UFSAR chapters covering main steam

This is full-text — it returns any document where the term appears, not necessarily as the subject. Human review confirms which actually changed the design basis.

**Caution for the amendment sweep (Bucket 1):** do not rely on a system keyword to find amendments — it under-returns, because amendments that phrase the system differently drop out silently. Pull all issued amendments by Document Type (`License-Operating`) and triage by title instead. Keyword narrowing is fine as a convenience for the 50.59 and UFSAR content searches, but never as the sole filter for the formal amendment record.

### By Document Type

Use the **Document Type** property (NRC-assigned, less noisy than full-text). Document Type is a **controlled vocabulary** — a wrong label returns zero with no error, so use these verified values (matched with the "starts" operator):

| Document Type Value | What It Returns |
|---|---|
| `License-Operating` | NRC-issued (granted) license/TS amendments |
| `License-Application for Facility Operating License` | Licensee amendment applications / requests |
| `Updated Final Safety Analysis Report` | UFSAR revision packages |
| `Code Relief or Alternative` | ISI 50.55a relief requests / alternatives |
| `Inservice/Preservice Inspection and Test Report` | ISI program plans / owner's activity reports |
| `Letter` | General correspondence, either direction |

Do **not** use `License Amendment` or `Amendment` — both return zero in the API. After CSV export (browser method), filter further by the reliably-populated **Document Title** column.

---

## Quick Reference — Common Document Title Patterns

| Document Type | Typical Title Pattern |
|---|---|
| TS Amendment Request | "Application to Revise Technical Specifications…" |
| TS Amendment Issuance | "Issuance of Amendment Nos. X and Y…" |
| 50.59 Report (standalone, ≤2008) | "Report of Facility Changes, Tests, and Experiments — Safety Evaluation Summaries" |
| 50.59 Report (bundled in UFSAR, 2011→) | "10 CFR 50.59 Summary Report" (enclosure in the UFSAR transmittal letter) |
| UFSAR Submission | "Revision XX to Updated Final Safety Analysis Report" |
| UFSAR Transmittal | "Submittal of UFSAR Update" |
| ISI Relief Request | titled by number, e.g. "Relief Request RR-34" / "HNP-ISI-ALT-09" (not by system) |
| Generic/Vendor Issue | references an identifier, e.g. "NUREG-0619", "BWRVIP-75" |

---

## What ADAMS Will Not Give You

Records that never reached the NRC aren't in ADAMS:

- Individual 50.59 screening and evaluation records
- Design calculations
- Engineering change packages
- Vendor technical documents (unless submitted to NRC)

---

*Search interface: ADAMS Public Search (APS) — https://adams-search.nrc.gov*
*Prepared for Hatch EPU / Design Basis Program Update (DPU) support*
