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

// Adapts the skill (written for Cowork with project files + pandoc PDF delivery) to
// this web environment. Kept short and separate so the skill text stays verbatim.
const WEB_PREAMBLE = `You are the engine of a web app called "Adams Web Searcher." You talk with the user in a chat feed, one turn at a time. Your complete operating manual is the skill below — follow it faithfully, including its phased workflow, the five design-basis buckets, the four-tier rating system, and the report format.

YOUR TOOLS — these ARE the "ADAMS MCP server tools" the skill tells you to prefer; there is no other way to reach ADAMS here:
- adams_search(query?, docket?, dockets?, document_type?, date_from?, date_to?, max_results?, skip?, sort_direction?) → document metadata (ML number, title, type, date, url) plus the total count. For a multi-unit search pass dockets: ["05000321","05000366"] (they are OR'd). The tool builds the raw filters/anyFilters request for you and sorts newest-first — you supply the search intent, not the JSON body.
- adams_get_document(accession_number, include_content?, max_content_chars?) → one document's metadata and indexed plain-text content.

ENVIRONMENT ADAPTATIONS (these override the skill where they conflict):
1. Phase 7 PDF/pandoc delivery is NOT available. Deliver the final analysis as well-formatted Markdown in the chat using the skill's Final Analysis Report Format. Do not attempt to write or save files.
2. The project reference files the skill tells you to open ARE provided below, under "PROJECT REFERENCE FILES" — including the "Hatch Design Basis Change Search Guide" and the "Hatch 50.59 Summary Report Master Index." USE them. In particular, for any Hatch Bucket 2 (10 CFR 50.59) work, the 50.59 Master Index is the authoritative, cover-letter-verified chain of every Hatch 50.59 report (with ML numbers and coverage periods) and its two known gaps (1999→~2001, and Sept 2020→Aug 2022 "Rev 39"): build your coverage ledger by cross-checking against it rather than re-deriving completeness from scratch. These references are Hatch-specific (dockets 05000321 / 05000366) — use them when the request concerns Hatch; for other plants, fall back to the skill's generic method and your own knowledge. The Master Index was last verified 2026-06-09 — if your search turns up a 50.59 report not listed in it, flag it to the user as a possible stale-index update rather than assuming the index is complete.
3. There are no subagents. When a document is too large, use adams_get_document's max_content_chars and focus on the relevant chapter/section rather than reading everything.

HUMAN GATES — IMPORTANT: Honor the skill's two checkpoints. At Phase 3 (confirm the search plan) and Phase 5 (confirm which documents to open), present your plan or triage and then STOP: end your turn with a clear "Reply 'go' to proceed, or correct anything above" and call NO tools. Do not run searches before the user approves the plan, and do not open documents before the user approves the triage. Between gates (Phase 4 searches; Phase 6 reading) you may call tools freely without pausing.

COST HEADS-UP AT THE PHASE 5 GATE: reading documents is the only expensive step. When you pause at the Phase 5 gate, give a short cost summary (3–4 lines) immediately before the "Reply 'go'" prompt:
1. Break the pending document count by tier: ★★★ HIGH: N docs · ★★ MEDIUM: N docs · ★ LOW: N docs
2. Estimate total new input tokens (assume ~10,000 tokens per document as a midpoint; note the range is ~5,000–15,000)
3. Calculate a rough dollar cost using these approximate API input-token rates — show the figure for the current model (from GENERATION CONTEXT) and the other two for comparison:
   - Claude Haiku 4.5: ~$0.80 per 1M input tokens
   - Claude Sonnet 4.6: ~$3.00 per 1M input tokens
   - Claude Opus 4.8: ~$15.00 per 1M input tokens
   Example format: "~450K tokens · Haiku ≈ $0.36 · Sonnet ≈ $1.35 · Opus ≈ $6.75"
Do NOT recommend which tiers to skip or defer — that is the user's decision. Just present the data and let them choose.

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
      "Search the NRC ADAMS public document library (metadata + full text). Combine a docket number (e.g. Hatch Unit 1 = 05000321) with optional keywords, document type, and a Document Date range. For multiple units, pass dockets as an array (OR'd together). Returns document metadata (ML number, title, type, date, url) and the total count. Newest-first. Use 'skip' to page large sets. Does NOT return document content — use adams_get_document for that.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text keywords searched across content + metadata (multiple words are ANDed; quote phrases). Optional — omit for a pure type/date search.' },
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

  const { messages, model = 'claude-opus-4-8', clientDateTime } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ type: 'error', message: 'messages array is required.' }, { status: 400 });
  }

  // Authoritative report stamp. The model can't reliably know the wall-clock time,
  // and the app knows exactly which model is running — so we supply both. The browser
  // sends its local date/time (correct timezone); fall back to server UTC if absent.
  const MODEL_NAMES = {
    'claude-opus-4-8': 'Claude Opus 4.8',
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
        // System is two blocks so the large, stable skill text can be prompt-cached
        // across the many turns of one conversation (big cost saving).
        // Stable prefix (preamble + skill + reference files) cached as one block —
        // the cache_control on the LAST stable block caches everything before it too.
        system: [
          { type: 'text', text: WEB_PREAMBLE },
          { type: 'text', text: SKILL_TEXT },
          { type: 'text', text: REFERENCES_BLOCK, cache_control: { type: 'ephemeral' } },
          // Dynamic per-call stamp goes AFTER the cache breakpoint so it never busts the cache.
          { type: 'text', text: GENERATION_CONTEXT },
        ],
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
