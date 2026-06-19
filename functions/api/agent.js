// Phase engine — ONE agentic turn of the model-driven ADAMS workflow.
// POST /api/agent
// Body: { messages: [...Anthropic messages...], model?: string }
//
// The model is given the REAL adams-search-api skill as its system prompt and two
// tools (adams_search, adams_get_document). This endpoint runs a single round:
//   1. Call Claude with the conversation so far.
//   2. If Claude wants tools, execute them server-side (where the keys live) and
//      return the assistant message + tool results to the browser.
//   3. If Claude is done (or is pausing at a human gate), return the final message.
// The browser owns the loop: it appends the results and calls back, or — when the
// model ends its turn at a gate — waits for the user to reply. Keeping each call to
// one model round + its tool calls avoids Cloudflare Function timeouts.

import { SKILL_TEXT } from '../../lib/skill.js';
import { REFERENCES } from '../../lib/references.js';
import { runAdamsSearch, getAdamsDocument } from '../../lib/adams.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// The project reference files the skill expects to open at runtime, assembled into
// one block. In Cowork these live on disk; here they're handed to the model as
// cached context so it can cross-check (esp. the 50.59 Master Index for Bucket 2).
const REFERENCES_BLOCK =
  '==================== PROJECT REFERENCE FILES ====================\n' +
  'These are the exact reference files the skill tells you to consult. They are ' +
  'plant-specific (Hatch). Treat them as authoritative for Hatch work; for other ' +
  'plants fall back to the skill\'s generic method.\n\n' +
  REFERENCES.map(r => `----- FILE: ${r.filename} -----\n\n${r.text}`).join('\n\n\n');

// Preamble for General ADAMS Research mode — open-ended lookups, no phased workflow.
const GENERAL_WEB_PREAMBLE = `You are the engine of a web app called "Adams Web Searcher," running in General Research mode. You are a sharp, practical ADAMS research assistant — help the user find documents, answer questions, and explore the NRC ADAMS public document database.

YOUR TOOLS — these ARE the ADAMS MCP server tools the skill refers to; there is no other way to reach ADAMS here:
- adams_search(query?, title?, docket?, dockets?, document_type?, date_from?, date_to?, max_results?, skip?, sort_direction?) → document metadata (ML number, title, type, date, url) plus total count. 'query' = broad full-text (matches content + metadata); 'title' = match the document title only (precise). For multi-unit searches pass dockets as an array (they are OR'd). Newest-first by default.
- adams_get_document(accession_number, include_content?, max_content_chars?) → full metadata and indexed plain-text content for one document. This is the step that COSTS tokens.

RESOLVE THE PLANT CORRECTLY — NEVER DEFAULT TO ANOTHER PLANT:
- Anchor every search to the docket(s) of the plant the USER named. Resolve the plant to its OWN NRC docket number(s) — e.g. Watts Bar Unit 1 = 05000390, Unit 2 = 05000391; Hatch Unit 1 = 05000321, Unit 2 = 05000366.
- NEVER substitute Hatch (or any other plant) just because the skill examples or any reference files mention it. Any Hatch material in your context applies ONLY when the user is actually asking about Hatch.
- If you are not certain of a plant's docket number, SAY SO and confirm with the user (or do a quick fleet-wide lookup — DocketNumber 'starts 05000' plus a distinctive title term). Do NOT guess, and do NOT fall back to a plant you happen to have reference data on.

CLARIFY THE SEARCH WHEN IT'S AMBIGUOUS — then search:
Before running, judge whether the request actually pins down HOW to search. A bare keyword + plant usually does not. Use your understanding of how ADAMS search works to ask one or two crisp questions first, then run the search the user chooses. Don't over-ask — if the scope is already clear, just search; one round of clarification is plenty.
The most common ambiguity is WHERE a keyword should match:
- query (full-text → ADAMS 'q'): matches the term ANYWHERE in the document's content + metadata. Broad — finds everything that mentions it, including incidental mentions.
- title (→ ADAMS 'DocumentTitle contains'): matches only documents whose TITLE contains the term. Precise — best when the term names a system, program, or document series (e.g. an acronym) — but misses documents that discuss it without naming it in the title.
Example — user: "Give me the Watts Bar 1 & 2 documents with ACAS." A good response BEFORE searching: "Quick check before I run this: do you want ACAS matched anywhere in the document text (broad), or only in document titles (precise)? I'll cover both units — dockets 05000390 and 05000391." Then search the way they pick.
Also confirm units/dockets when unclear, and suggest a date range for very broad topics.

HOW TO BEHAVE — SEARCH FIRST, READ ONLY WHEN ASKED:
1. SEARCH AND SUMMARIZE (do this freely — searching is cheap). Run the search(es) the request needs, then present what you found:
   - A short, plain-language summary that characterizes the results using your own judgment — the themes, the date span, the document types, and which items look most relevant to the question.
   - A Markdown table of the documents: ML Number (as a [linked](url) accession number) | Title | Type | Date.
2. THEN STOP AND OFFER TO GO DEEPER. Do NOT open or read any document's contents on this first pass. After presenting the results, tell the user you can read the actual documents if they want — but only on their say-so — and give an approximate cost of doing so (see COST OF READING). End your turn and wait. Example: "I found 12 documents on this. I can open and read any of them to answer in detail — reading all 12 would be roughly [estimate]. Tell me which to read, or ask a follow-up."
3. READ ON REQUEST. Once the user says what to open, read those documents with adams_get_document and answer in plain language with [linked](url) ML citations. If a follow-up needs more searching, search again (free) and summarize again before reading.

COST OF READING — give this whenever you offer to read, and again before reading a batch: reading is the only step that costs real tokens. Each document opened costs roughly its content (~10,000 tokens) plus the conversation re-sent on that call (small early in a session, larger as it grows — so reading many in a row costs more than a flat per-doc multiple). Give a rough figure for the current model (from GENERATION CONTEXT) using these input-token rates — Haiku 4.5 ≈ $0.80 / 1M, Sonnet 4.6 ≈ $3.00 / 1M — e.g. "reading all 12 ≈ ~150K tokens ≈ $0.45 on Sonnet." Approximate is fine; the point is to let the user decide before spending.

OTHER:
- The skill below is your reference for ADAMS mechanics — correct DocumentType values, docket number formats, search patterns. You do NOT need to follow its phased design-basis workflow in this mode.
- Any Hatch-specific reference files in your context load ONLY for Hatch conversations — use them only when the user's plant is Hatch, never as a default for other plants.
- No formal report format is required. Be concise, skip narration, lead with results.

==================== SKILL: adams-search-api ====================
`;

// Preamble for Design-Basis Change Analysis mode — full phased workflow with human gates.
// Adapts the skill (written for Cowork with project files + pandoc PDF delivery) to
// this web environment. Kept short and separate so the skill text stays verbatim.
const WEB_PREAMBLE = `You are the engine of a web app called "Adams Web Searcher," running in Design-Basis Change Analysis mode. You talk with the user in a chat feed, one turn at a time. Your complete operating manual is the skill below — follow it faithfully, including its phased workflow, the five design-basis buckets, the four-tier rating system, and the report format.

YOUR TOOLS — these ARE the "ADAMS MCP server tools" the skill tells you to prefer; there is no other way to reach ADAMS here:
- adams_search(query?, title?, docket?, dockets?, document_type?, date_from?, date_to?, max_results?, skip?, sort_direction?) → document metadata (ML number, title, type, date, url) plus the total count. 'query' searches full content + metadata; 'title' matches the DocumentTitle field only (ADAMS "DocumentTitle contains"). For a multi-unit search pass dockets: ["05000321","05000366"] (they are OR'd). The tool builds the raw filters/anyFilters request for you and sorts newest-first — you supply the search intent, not the JSON body.
- adams_get_document(accession_number, include_content?, max_content_chars?) → one document's metadata and indexed plain-text content.

ENVIRONMENT ADAPTATIONS (these override the skill where they conflict):
1. Phase 7 PDF/pandoc delivery is NOT available. Deliver the final analysis as well-formatted Markdown in the chat using the skill's Final Analysis Report Format. Do not attempt to write or save files.
2. The project reference files the skill tells you to open ARE provided below, under "PROJECT REFERENCE FILES" — including the "Hatch Design Basis Change Search Guide" and the "Hatch 50.59 Summary Report Master Index." USE them. In particular, for any Hatch Bucket 2 (10 CFR 50.59) work, the 50.59 Master Index is the authoritative, cover-letter-verified chain of every Hatch 50.59 report (with ML numbers and coverage periods) and its two known gaps (1999→~2001, and Sept 2020→Aug 2022 "Rev 39"): build your coverage ledger by cross-checking against it rather than re-deriving completeness from scratch. These references are Hatch-specific (dockets 05000321 / 05000366) — use them when the request concerns Hatch; for other plants, fall back to the skill's generic method and your own knowledge. The Master Index was last verified 2026-06-09 — if your search turns up a 50.59 report not listed in it, flag it to the user as a possible stale-index update rather than assuming the index is complete.
3. There are no subagents. When a document is too large, use adams_get_document's max_content_chars and focus on the relevant chapter/section rather than reading everything.

HUMAN GATES — IMPORTANT: Honor the skill's two checkpoints. At Phase 3 (confirm the search plan) and Phase 5 (confirm which documents to open), present your plan or triage and then STOP: end your turn with a clear "Reply 'go' to proceed, or correct anything above" and call NO tools. Do not run searches before the user approves the plan, and do not open documents before the user approves the triage. Between gates (Phase 4 searches; Phase 6 reading) you may call tools freely without pausing.

COST HEADS-UP AT THE PHASE 5 GATE: reading documents is the only expensive step. When you pause at the Phase 5 gate, give a short cost summary (3–4 lines) immediately before the "Reply 'go'" prompt:
1. Break the pending document count by tier: ★★★ HIGH: N docs · ★★ MEDIUM: N docs · ★ LOW: N docs
2. Estimate total Phase 6 input tokens. IMPORTANT: by Phase 6 every document-reading call re-sends the full conversation history (Phase 1–5: all searches, results, and triage) as non-cached input — typically 50,000–120,000 tokens per call — PLUS the document content (~10,000 tokens per document, range 5,000–15,000). Use ~80,000 tokens per document call as a realistic all-in midpoint: total ≈ N docs × 80,000 tokens. Do NOT use just N × 10,000 — that undercounts by roughly 8×.
3. Calculate a rough dollar cost using these approximate API input-token rates — show the figure for the current model (from GENERATION CONTEXT) and the other for comparison:
   - Claude Haiku 4.5: ~$0.80 per 1M input tokens
   - Claude Sonnet 4.6: ~$3.00 per 1M input tokens
   Example format: "~450K tokens · Haiku ≈ $0.36 · Sonnet ≈ $1.35"
Do NOT recommend which tiers to skip or defer — that is the user's decision. Just present the data and let them choose.

READING DISCIPLINE (Phase 6) — three rules grounded in verified misses from testing. They apply to ANY target system and override the skill where they conflict. Honor them before you write the report:

1. ACTUALLY PERFORM THE UFSAR CHAPTER DIFF — do not defer it to the human. Each UFSAR revision's chapter package is itself a separate ADAMS document with indexed plain text (for example, Hatch Rev 40 Unit 2 Chapters 8–18 = ML24249A056; Rev 29 = ML11320A118) — it is NOT only the CD-ROM referenced in the transmittal letter. Retrieve the target system's chapter package for BOTH the baseline revision and the current revision with adams_get_document, then diff the indexed text yourself to determine what actually changed in that chapter. Only if the retrieved content comes back empty may you fall back to recommending a human draftable.com redline — and when you do, say "indexed text empty" explicitly. This is the same get-document call you already use for other reads; no new capability is required.

2. READ ISI / WELD-OVERLAY SAFETY EVALUATIONS PER UNIT. These documents list components separately by unit (for example a "HNP-1 Components" list versus a "HNP-2 Components" list). Parse each unit's component list on its own and report weld-overlay / relief scope per unit. NEVER generalize one unit's scope to the other unit — a scope item may exist for one unit only. If a unit does not appear in the component list, state that it is not in scope rather than assuming the two units match.

3. READ THE FULL 50.59 SUMMARY REPORT. Read the 50.59 enclosure through to its LAST listed activity before concluding "no <system> entries," scanning every activity line for tracking numbers (LDCR/DCP) relevant to the target system. Do NOT claim the 50.59 content is "on CD-ROM" or "only partially indexed": the 50.59 Summary Report enclosure is public and FULLY indexed in ADAMS, even when the UFSAR pages or drawings carried in the same transmittal letter are delivered on CD-ROM.

FINAL REPORT FORMAT — produce the final analysis in EXACTLY this structure (it is the format the user prefers). One message, clean Markdown, all ML numbers as [links](url) — the user saves it as a PDF with a button.

Start with a title and a labeled metadata header block, then a horizontal rule, then the numbered sections:

# <Plant / units> — <System> Design-Basis Change Analysis (<window years>)

**Plant / units:** <full plant name and units>
**Dockets:** <docket(s) with unit labels, e.g. 05000321 (Unit 1), 05000366 (Unit 2)>
**System:** <the system analyzed>
**Search window:** <the date range searched>
**Method:** NRC ADAMS Public Search API (adams-search-api skill), five design-basis search buckets
**Prepared:** <the exact "Prepared" date-and-time string from the GENERATION CONTEXT block>
**Model:** <the exact Model string from the GENERATION CONTEXT block>

---

Then the skill's Final Analysis Report sections, numbered with these headings:
## 1. Introduction
## 2. Findings (most to least impactful)
## 3. Filtered at checkpoint (not opened)
## 4. Evaluated and ruled OUT
## 5. Recommended next steps for a human

SECTION 2 (FINDINGS) — two judgment guides that shape report quality (nudges, not rigid rules):
- GROUP BY CHANGE, NOT BY DOCUMENT. Organize the numbered findings around the design-basis CHANGE — the storyline — and consolidate every document that belongs to one change into a single numbered finding with a nested document list. Example: a pressure-temperature limit change — its supporting fracture-mechanics calculation, the amendment that relocates the curves, and the resulting limits report — is ONE finding, not three. Fragmenting a single storyline across several findings inflates the count and obscures what actually changed.
- RESERVE NUMBERED FINDINGS FOR DIRECT CHANGES to the target system's design basis. Items that are adjacent or only peripherally related — changes to neighboring systems, plant-wide changes that merely touch the target system, surveillance-interval or administrative changes — go in a short, clearly labeled list at the end of Section 2 headed "Indirect / peripheral — for awareness" (one line each, with ML links). Surface them there so nothing is hidden, but do NOT promote them to numbered findings. A low inclusion threshold turns marginal items into headline findings and dilutes the signal.
The intended shape: a small set of well-grouped, direct findings, with indirect items listed separately.

Copy the Prepared date/time and Model verbatim from GENERATION CONTEXT — never guess them. Keep the skill's content rules for each section (plain-language descriptors, page-then-section citations, hyperlinked MLs).

Write in clear, plain language for an engineer who is not an ADAMS expert. Use Markdown (headings, tables, bold, and [ML links](url)).

**CRITICAL OUTPUT RULE:** The final-report message must begin IMMEDIATELY with the # heading line (the H1 title). Do NOT write any introductory sentence ("Here is the report", "Perfect, now I'll compile...", "Based on my reading...", or anything similar) before that # heading. Do NOT write a draft or outline first and then the report. The very first character of the message must be the # character.

==================== SKILL: adams-search-api ====================
`;

const TOOLS = [
  {
    name: 'adams_search',
    description:
      "Search the NRC ADAMS public document library. Use `query` for a broad full-text search (matches document content + metadata); use `title` to match the document TITLE only (precise). Combine with a docket number, document type, and a Document Date range. For multiple units, pass dockets as an array (OR'd together). Returns document metadata (ML number, title, type, date, url) and the total count. Newest-first. Use 'skip' to page large sets. Does NOT return document content — use adams_get_document for that.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text keywords searched across content + metadata (multiple words are ANDed; quote phrases). Broad. Optional — omit for a pure type/date/title search.' },
        title: { type: 'string', description: 'Match the document TITLE only (ADAMS "DocumentTitle contains"); multiple words are ANDed within the title. Precise alternative to `query`, which searches full content + metadata. May be combined with query, docket, document_type, and dates.' },
        docket: { type: 'string', description: 'A single docket number, e.g. 05000321. A full 05000XXX is matched exactly; a shorter prefix like 05000 is a fleet-wide sweep.' },
        dockets: { type: 'array', items: { type: 'string' }, description: 'Multiple docket numbers for a multi-unit search, e.g. ["05000321","05000366"]. OR\'d together — this is the right way to search two or more units at once.' },
        document_type: { type: 'string', description: 'Exact ADAMS DocumentType value, matched with "starts" (e.g. "License-Operating", "Updated Final Safety Analysis Report", "Code Relief or Alternative"). A wrong value silently returns zero results — use the verified values from the skill.' },
        date_from: { type: 'string', description: 'Earliest Document Date, YYYY-MM-DD.' },
        date_to: { type: 'string', description: 'Latest Document Date, YYYY-MM-DD.' },
        max_results: { type: 'number', description: 'Max results to return this call (default 100, max 500).' },
        skip: { type: 'number', description: 'Number of results to skip, for paging (default 0).' },
        sort_direction: { type: 'number', description: '1 = newest-first (default), 0 = oldest-first.' },
      },
    },
  },
  {
    name: 'adams_get_document',
    description:
      'Retrieve a single ADAMS document by accession (ML) number, including full metadata and the indexed plain-text content. Content may be empty/sparse for scanned-image or very recent documents (the result flags this).',
    input_schema: {
      type: 'object',
      properties: {
        accession_number: { type: 'string', description: 'The ML number, e.g. ML24017A120.' },
        include_content: { type: 'boolean', description: 'Include document text (default true).' },
        max_content_chars: { type: 'number', description: 'Truncate content to this many characters (default 50000).' },
      },
      required: ['accession_number'],
    },
  },
];

// Build a short, human-readable label + summary for a tool call (for the feed UI).
function summarizeSearch(input, result) {
  const bits = [];
  if (input.dockets?.length) bits.push(`dockets ${input.dockets.join(' / ')}`);
  else if (input.docket) bits.push(`docket ${input.docket}`);
  if (input.document_type) bits.push(`type "${input.document_type}"`);
  if (input.title) bits.push(`title "${input.title}"`);
  if (input.query) bits.push(`q "${input.query}"`);
  if (input.date_from || input.date_to) bits.push(`${input.date_from || '…'} → ${input.date_to || '…'}`);
  const label = `adams_search · ${bits.join(' · ') || 'all documents'}`;
  const summary = result?.error
    ? `error: ${result.error}`
    : `${result.count} found${result.truncated ? `, showing ${result.returned}` : ''}`;
  return { label, summary };
}

function summarizeGet(input, result) {
  const label = `adams_get_document · ${input.accession_number}`;
  let summary;
  if (result?.error) summary = `error: ${result.error}`;
  else if (result.scanned) summary = `${result.estimatedPageCount ?? '?'} pp · scanned/sparse — OCR needed`;
  else summary = `${result.estimatedPageCount ?? '?'} pp · ${result.contentChars?.toLocaleString?.() ?? result.contentChars} chars`;
  return { label, summary };
}

async function executeTool(block, env) {
  try {
    if (block.name === 'adams_search') {
      const result = await runAdamsSearch(block.input || {}, env.ADAMS_API_KEY);
      return { result, display: summarizeSearch(block.input || {}, result) };
    }
    if (block.name === 'adams_get_document') {
      const result = await getAdamsDocument(block.input || {}, env.ADAMS_API_KEY);
      return { result, display: summarizeGet(block.input || {}, result) };
    }
    return { result: { error: `Unknown tool: ${block.name}` }, display: { label: block.name, summary: 'unknown tool' } };
  } catch (err) {
    const result = { error: err.message || String(err) };
    const display =
      block.name === 'adams_search'
        ? summarizeSearch(block.input || {}, result)
        : summarizeGet(block.input || {}, result);
    return { result, display };
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json({ type: 'error', message: 'Server configuration error: ANTHROPIC_API_KEY not set.' }, { status: 500 });
  }
  if (!env.ADAMS_API_KEY) {
    return Response.json({ type: 'error', message: 'Server configuration error: ADAMS_API_KEY not set.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ type: 'error', message: 'Invalid request body.' }, { status: 400 });
  }

  const { messages, model = 'claude-sonnet-4-6', mode = 'general', clientDateTime } = body;
  const activePreamble = mode === 'design-change' ? WEB_PREAMBLE : GENERAL_WEB_PREAMBLE;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ type: 'error', message: 'messages array is required.' }, { status: 400 });
  }

  // The Hatch reference files are plant-specific. Inject them ONLY when the
  // conversation actually concerns Hatch — otherwise they are pure noise that biases
  // the model toward Hatch dockets (the real cause of a Watts Bar query coming back
  // with Hatch results). Detect Hatch from the human's typed messages only (string
  // content); tool-result messages are arrays and are intentionally skipped.
  const mentionsHatch = messages.some(
    m => m && m.role === 'user' && typeof m.content === 'string' && /hatch|hnp|05000321|05000366/i.test(m.content)
  );

  // Authoritative report stamp. The model can't reliably know the wall-clock time,
  // and the app knows exactly which model is running — so we supply both. The browser
  // sends its local date/time (correct timezone); fall back to server UTC if absent.
  const MODEL_NAMES = {
    'claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  };
  const friendlyModel = MODEL_NAMES[model] || model;
  const stamp = (typeof clientDateTime === 'string' && clientDateTime.trim())
    ? clientDateTime.trim()
    : new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const GENERATION_CONTEXT =
    `GENERATION CONTEXT — use these EXACT values when you stamp the final report header block; do not invent or guess them:\n` +
    `Prepared (current date and time): ${stamp}\n` +
    `Model: ${friendlyModel}`;

  // Assemble the system prompt. The stable prefix (preamble + skill + optional Hatch
  // refs) is prompt-cached as one block — cache_control on the LAST stable block
  // caches everything before it too. Hatch references are included only for Hatch
  // conversations (see mentionsHatch).
  const stableSystem = [
    { type: 'text', text: activePreamble },
    { type: 'text', text: SKILL_TEXT },
  ];
  if (mentionsHatch) stableSystem.push({ type: 'text', text: REFERENCES_BLOCK });
  stableSystem[stableSystem.length - 1] = {
    ...stableSystem[stableSystem.length - 1],
    cache_control: { type: 'ephemeral' },
  };
  // The per-call stamp goes AFTER the cache breakpoint so it never busts the cache.
  const systemBlocks = [...stableSystem, { type: 'text', text: GENERATION_CONTEXT }];

  let claudeResp;
  try {
    claudeResp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16384,
        // System prompt assembled above (preamble + skill + optional Hatch refs +
        // per-call stamp); the stable prefix is prompt-cached as one block.
        system: systemBlocks,
        tools: TOOLS,
        messages,
      }),
    });
  } catch (err) {
    console.error('Anthropic network error:', err);
    return Response.json({ type: 'error', message: 'Could not reach the Claude API. Please try again.' }, { status: 502 });
  }

  if (!claudeResp.ok) {
    const errText = await claudeResp.text().catch(() => '');
    console.error('Anthropic API error:', claudeResp.status, errText);
    return Response.json({
      type: 'error',
      message: `Claude API error (HTTP ${claudeResp.status}). ${errText.slice(0, 300)}`,
    }, { status: 502 });
  }

  const data = await claudeResp.json();
  const content = data.content || [];
  const stopReason = data.stop_reason;

  // Plain text the model emitted this turn (for display in the feed).
  const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();

  const usage = {
    input: data.usage?.input_tokens || 0,
    output: data.usage?.output_tokens || 0,
    cacheRead: data.usage?.cache_read_input_tokens || 0,
    cacheWrite: data.usage?.cache_creation_input_tokens || 0,
  };

  const toolUses = content.filter(b => b.type === 'tool_use');

  if (stopReason === 'tool_use' && toolUses.length > 0) {
    // Execute every requested tool, build tool_result blocks + display summaries.
    const toolResults = [];
    const toolCalls = [];
    for (const block of toolUses) {
      const { result, display } = await executeTool(block, env);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        ...(result?.error ? { is_error: true } : {}),
      });
      toolCalls.push({ name: block.name, ...display });
    }

    return Response.json({
      type: 'tool_turn',
      text,
      toolCalls,
      assistant: content,      // raw assistant message to append client-side
      toolResults,             // user message content (tool_result blocks) to append
      usage,
    });
  }

  // end_turn (or max_tokens / pause at a gate) — hand control back to the user.
  return Response.json({
    type: 'final',
    text,
    assistant: content,
    stopReason,
    usage,
  });
}
