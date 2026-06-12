# Hatch 50.59 Summary Report — Master Index (1999–present)

**Plant:** Edwin I. Hatch Nuclear Plant, Units 1 & 2
**Dockets:** 05000321 (Unit 1), 05000366 (Unit 2)
**Scope:** Every 10 CFR 50.59 periodic report on the Hatch docket from January 1, 1999 to present
**Last verified:** 2026-06-09 (chain + 2011–2016 span re-checked; Gaps A & B deep-investigated across ADAMS, the granted 10 CFR 50.71(e)(4) exemption, the full Rev 40 50.59 report, and the web)
**Purpose:** Authoritative, verified list of Hatch's 50.59 reports for design-basis gap analysis. Other skills and searches should point here as a cross-check so the 50.59 chain doesn't have to be rediscovered each time. **If your search turns up a 50.59 report not on this list, this index is stale — update it (see "Maintaining this index").**

---

## Why this document exists (and how it was built)

Finding "every 50.59 report" at Hatch is deceptively hard, for two reasons that trip up an ordinary search. This index was built by running the searches to ground and **reading each report's cover letter** to confirm the exact period it covers — not by trusting titles or metadata.

**1. The filing format changed in 2011.** A 10 CFR 50.59 report is the licensee's periodic summary of changes, tests, and experiments it made under its own authority (no prior NRC approval). At Hatch the *packaging* changed midstream:

- **Through 2008 — standalone.** Filed by itself, titled **"Report of Facility Changes, Tests, and Experiments — Safety Evaluation Summaries"** (note *Report of*, not *Summary of*). A 24-month report.
- **2011 onward — bundled.** The same report became an **enclosure inside the biennial UFSAR revision transmittal letter**, titled "10 CFR 50.59 Summary Report." It is no longer filed on its own.

**2. A Document Type filter hides the bundled ones.** Filtering by Document Type `Updated Final Safety Analysis Report` does **not** return the bundled reports, because the transmittal cover letters that carry them are typed **"Letter,"** not "UFSAR." The only reliable way to find the full chain is free-text title-phrase searching, dropping the type filter:

- `Report of Facility Changes Tests Experiments` (standalone era)
- `Submittal of Revision Updated Final Safety Analysis Report` and `10 CFR 50.59 Summary Report` (bundled era)

**How coverage was verified.** Each report's cover letter states the period it covers (e.g., Rev 38: "September 1, 2019 to August 31, 2020"). Those stated periods were read directly and checked for continuity — each report picks up where the prior one ended. Bundled reports carry a multi-year lookback, so a calendar year with no separate filing is normally swept into the next report; that was confirmed, not assumed.

---

## The master chain — every confirmed 50.59 report

All nine entries below were confirmed by reading the cover letter. Coverage periods are the licensee's stated reporting periods (start of the standalone-to-bundled transition is inferred from the prior report's end, where noted).

| # | ML number | Filed | Format / UFSAR Rev | Period covered | Verification |
|---|---|---|---|---|---|
| 1 | [ML040440165](https://www.nrc.gov/docs/ML0404/ML040440165.pdf) | 2004-02-10 | Standalone | Jan 2002 – Dec 2003 | Confirmed — "24 month report" |
| 2 | [ML060530028](https://www.nrc.gov/docs/ML0605/ML060530028.pdf) | 2006-02-20 | Standalone | Jan 2004 – Dec 2005 | Confirmed — "24 month report" |
| 3 | [ML080601276](https://www.nrc.gov/docs/ML0806/ML080601276.pdf) | 2008-02-29 | Standalone | Jan 1 2006 – Dec 31 2007 | Confirmed — explicit dates |
| 4 | [ML11320A042](https://www.nrc.gov/docs/ML1132/ML11320A042.pdf) | 2011-10-24 | Bundled, UFSAR Rev 29 | ~Jan 2008 – Sept 9 2011 | Confirmed — "through September 9, 2011" (start inferred from #3 end) |
| 5 | [ML16244A381](https://www.nrc.gov/docs/ML1624/ML16244A381.pdf) | 2016-08-25 | Bundled, UFSAR Rev 34 | ~Sept 2011 – July 2016 | End confirmed ("through July 2016"); enclosure read — entries datable 2013–2015, none 2011–2012; start inferred (see Fuzzy spots) |
| 6 | [ML18256A066](https://www.nrc.gov/docs/ML1825/ML18256A066.pdf) | 2018-08-30 | Bundled, UFSAR Rev 36 | ~July 2016 – June 30 2018 | Confirmed — "through June 30, 2018" |
| 7 | [ML19282B793](https://www.nrc.gov/docs/ML1928/ML19282B793.pdf) | 2019-09-26 | Bundled, UFSAR Rev 37 | July 1 2018 – Aug 31 2019 | Confirmed — stated reporting period |
| 8 | [ML20303A178](https://www.nrc.gov/docs/ML2030/ML20303A178.pdf) | 2020-09-29 | Bundled, UFSAR Rev 38 | Sept 1 2019 – Aug 31 2020 | Confirmed — stated reporting period |
| 9 | [ML24249A080](https://www.nrc.gov/docs/ML2424/ML24249A080.pdf) | 2024-09-03 | Bundled, UFSAR Rev 40 | Sept 1 2022 – July 31 2024 | Confirmed — stated reporting period |

Read in order, entries 1–9 span **January 2002 → July 31, 2024**. Coverage is continuous *by inference* across the bundled era — the cover letters print only **end** dates, so each bundled report's start is taken from the prior report's end. The inferred boundaries and the true holes are itemized in the two sections below: **fuzzy spots** (a report covers the period, but its exact boundary is inferred) and **open gaps** (no report exists at all).

*Note on depth:* these reports are brief by regulation (10 CFR 50.59(d)(2)) — only changes that received a **full** 50.59 evaluation are listed, each as a tracking number (LDCR/DCP), title, and short summary. The underlying evaluation, calculation, and engineering-change package is internal to Hatch and is **not** in ADAMS.

---

## Fuzzy spots — a report covers the period, but the exact boundary is inferred

These are **not** gaps — a report is on file; only the precise start/end is uncertain. Listed worst-first.

**Sept 2011 → Dec 2012 (~15 months) — the start edge of the Rev 34 span.**

- **Status:** covered by inference; not positively evidenced.
- **Why:** Rev 34 (entry #5) is the only report spanning 2011–2016 — direct search confirms nothing was filed 2012–2015. Its enclosure was read in full (2026-06-09): the 10 evaluated changes are datable to **2013–2015** (earliest LDCR 2013-037), with **no 2011–2012 entries**. So 2013 → July 2016 is confirmed *populated*; only Sept 2011 → Dec 2012 rests on continuation from Rev 29's stated end.
- **Most likely reality:** no full-evaluation 50.59 change occurred in that window.
- **To close:** confirm with SNC that nothing reportable happened Sept 2011 → Dec 2012.

**2002 → 2007 — the standalone "24-month" reports (entries #1–#2).**

- **Status:** covered, but boundary dates are inferred, not printed.
- **Why:** the 2004 and 2006 reports say only "24 month report" with no explicit dates; their windows (2002–03, 2004–05) come from cadence. The 2008 report (entry #3) is the first with explicit dates.
- **To close:** if exact bounds are ever needed, read those two reports for their earliest/latest tracking numbers.

---

## Open gaps — no report on file

Two windows have **no** 50.59 report findable in ADAMS. Both were searched directly and repeatedly — genuine holes, not index oversights.

**Gap A — Jan 1999 → ~2001 (pre-revised-rule era).**

- **Status:** no standalone report exists before the 2004 one (entry #1).
- **Re-investigated 2026-06-09:** a fresh legacy-library search (1999–2003, "Changes, Tests and Experiments") surfaced no pre-2004 standalone 50.59 report — only the TS 5.5.11 alignment amendment and license-renewal material. Gap A stands.
- **Why:** predates the revised 50.59 rule; Hatch's TS 5.5.11 was aligned to it in 2000–2001 ([ML003769397](https://www.nrc.gov/docs/ML0037/ML003769397.pdf), [ML010670340](https://www.nrc.gov/docs/ML0106/ML010670340.pdf)). Under the old rule the changes report was annual and may have ridden the annual operating report or the early FSAR updates (Rev 17A 1999; Rev 18A [ML003681527](https://www.nrc.gov/docs/ML0036/ML003681527.pdf), Jan 2000; Rev 19 [ML012150043](https://www.nrc.gov/docs/ML0121/ML012150043.pdf), July 2001) — but those FSAR cover letters report only FSAR-content changes under NEI 98-03, **not** a 50.59 report.
- **To close:** check the annual operating reports of that era, the old-rule FSAR submittals, or a direct PDR request.

**Gap B — Sept 1 2020 → Aug 31 2022 (the "Rev 39" window). Deep-investigated 2026-06-09.**

- **Status:** a 2022 UFSAR update (the "Rev 39") carrying this window's 50.59 report was a **regulatory obligation**, but **no such submittal exists anywhere in ADAMS** — not even a public cover letter.
- **The 2022 submittal was required.** The NRC **granted** SNC an exemption on Jan 30 2020 ([ML19364A018](https://www.nrc.gov/docs/ML1936/ML19364A018.pdf); request [ML19350C266](https://www.nrc.gov/docs/ML1935/ML19350C266.pdf)) setting the Hatch UFSAR schedule to **August 31 of every even-numbered year** — i.e., 2020, **2022**, 2024 — never exceeding 24 months. A submittal was therefore due Aug 31 2022.
- **Rev 40 starts in 2022, not 2020.** The Rev 40 (2024) 50.59 report was read in full: its earliest entries are **LDCR 2022-016** and **LDCR22-17**, and its commitments / 54.37(b) review periods begin **Sept 1 2022 / Jan 1 2022**. Nothing from 2020–2021 appears — Rev 40 covers ~Sept 2022 → July 2024 only.
- **The 2022 submittal is genuinely absent.** Every Letter-type filing on the Hatch docket from **Jul–Oct 2022 was enumerated (23 documents, including ones dated exactly Aug 31 2022)** — none is a UFSAR revision or 50.59 transmittal. "Revision 39" and UFSAR/50.59 searches across 2021–2026, plus a web search, surface nothing. This is not a late-posting artifact.
- **Backstop:** the NRC's **2022 triennial 50.59 inspection** ([ML22140A110](https://www.nrc.gov/docs/ML2214/ML22140A110.pdf), "Triennial Inspection of Evaluation of Changes, Tests and Experiments") sampled Hatch's 50.59 program covering this era — so the NRC did review 50.59 activity in the window even though the periodic report isn't public.
- **To close:** request the **Sept 2020 – Aug 2022 ("Rev 39") 50.59 report directly from SNC** (a required filing that should exist in plant records), and/or ask the NRC Hatch project manager why the 2022 submittal is not in ADAMS. Review [ML22140A110](https://www.nrc.gov/docs/ML2214/ML22140A110.pdf) for the 50.59 changes the NRC sampled.

---

## Maintaining this index

- **Cadence:** Hatch files the 50.59 report bundled with its UFSAR revision. The regulatory ceiling is ≤24 months (10 CFR 50.71(e)), but Hatch's *actual* history is irregular — 24-month standalone reports through 2008, then a ~5-year span (2011→2016), then annual (2018, 2019, 2020), then a ~4-year span (2020→2024). Do **not** assume a clean two-year rhythm. A 2019 exemption request from the FSAR update schedule ([ML19350C266](https://www.nrc.gov/docs/ML1935/ML19350C266.pdf)) is part of why the cadence shifted. Expect the next report (~Rev 41) sometime after Rev 40 (2024), but verify rather than predict the year.
- **To add the next report:** find the UFSAR revision transmittal letter (search `10 CFR 50.59 Summary Report` or `Submittal of Revision Updated Final Safety Analysis Report`, not a Document Type filter), open the cover letter, read the stated reporting period, and append a row. Update "Last verified."

---

*Built from the NRC ADAMS Public Search API. Companion to the Hatch Design Basis Change Search Guide (Bucket 2).*
