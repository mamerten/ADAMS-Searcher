# QF-034 — Qualitative Risk Management Plan (Template Structure), Rev. 2

This is ENERCON's quality-controlled qualitative RMP form. Every RMP you produce in
this mode must reproduce this structure — don't invent additional columns, additional
risk-color categories, or a different matrix than the one below. The app renders your
final risk-exposure table into a real Word document automatically; your job is to
produce the CONTENT (the coversheet facts and the risk-exposure table), not to design
the document layout.

## Coversheet fields

- **Project Number**
- **Project Title**
- **Revision Number** / **Revision Date**
- **Distribution** — External: primary client contact (PM or buyer), subcontractors
  and vendors named in the RMP, other client personnel as warranted by the identified
  risks. Internal: project team, ENERCON management, project file.
- **Prepared by** (Project Manager) / Date
- **Approved by** (PMO) / Date

Draft reasonable values for Project Number, Project Title, and Revision from the
conversation — ask if genuinely unclear rather than guessing a project number. Leave
the Prepared-by / Approved-by names and their dates blank in your output — those are
real signatures a human completes through ENERCON's actual review/approval process;
never fabricate a name or a signature date. Revision should default to "0" / today's
date for a first draft unless the user says otherwise.

## Risk Analysis Matrix — fixed 3×3 grid, reproduce exactly

This is the ONLY valid mapping from Likelihood × Impact to a risk color. Do not
recompute, approximate, or invent a different mapping.

| Likelihood ↓ \ Impact → | Low | Medium | High |
|---|---|---|---|
| **High** (Likely) | Yellow | Red | Red |
| **Medium** (Possible) | Green | Yellow | Red |
| **Low** (Unlikely) | Green | Green | Yellow |

## Qualitative Risk Exposure Table — one row per risk exposure

Produce your final risk exposure list as a Markdown table with exactly these columns,
in this exact order (the app parses this table to build the Word document, so keep the
column order and count stable):

| No. | Risk Exposure | Responsible Organization | Likelihood | Impact | Risk Impact Areas | Risk Impact Details | Compensating Actions | Compensating Action Details |
|---|---|---|---|---|---|---|---|---|

Column-by-column guidance:

1. **No.** — sequence number, 1, 2, 3, …
2. **Risk Exposure** — one specific risk per row, 1–2 sentences or bullet points.
3. **Responsible Organization** — the party/parties most capable of managing this
   specific risk (may be more than one; e.g. "ENERCON Engineering" or "Client / Vendor
   X").
4. **Likelihood** — exactly one of `L`, `M`, or `H` (Low/Medium/High as defined in the
   procedure reference). Do NOT write out "Low"/"Medium"/"High" here — use the single
   letter so the app can compute the risk color deterministically.
5. **Impact** — exactly one of `L`, `M`, or `H`, same rule as Likelihood.
6. **Risk Impact Areas** — which of Quality, Scope, Cost, Schedule are affected;
   list the ones that apply (e.g. "Cost, Schedule"). A risk may affect more than one.
7. **Risk Impact Details** — REQUIRED with real substance for any row whose
   Likelihood/Impact combination resolves to Yellow or Red on the matrix above:
   quantify in dollars, man-hours, or days where the user's input genuinely supports
   it, otherwise describe the impact qualitatively. For Green rows this can be brief
   or "—" — the procedure only requires the areas to be marked for Green, not a
   narrative.
8. **Compensating Actions** — one or more of `AV` (Avoidance), `T` (Transference), `M`
   (Mitigation), `AC` (Acceptance) — see the procedure reference for definitions. Use
   the short codes here, comma-separated if more than one applies (e.g. "M, AC").
9. **Compensating Action Details** — a brief but concrete summary of the specific
   actions and contingency plan for this risk exposure — not just a restatement of the
   code from column 8.

**Do not fill in a "Risk Assessment Color" column yourself** — omit it from your table
entirely. The app computes Green/Yellow/Red deterministically from your Likelihood and
Impact letters using the matrix above and colors the Word document's table
accordingly; a color you typed by hand would just be discarded, so don't waste effort
producing one.

## Escalation callout

If any risk exposure resolves to Red (see the matrix), say so explicitly in your
narrative before or after the table — e.g. "This plan includes N Red risk exposure(s)
requiring review with ENERCON and client management per QPM-003." Don't bury this in
the table alone.

## Worked examples

Not yet provided. When example completed RMPs are added to this reference folder,
calibrate the tone, level of granularity, and typical row count of the Risk Exposure
descriptions and the Details columns against them.
