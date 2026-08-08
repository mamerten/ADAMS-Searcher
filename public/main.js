// Adams Web Searcher — client-side driver for the model-led agentic loop.
//
// The model (running server-side with the real adams-search-api skill + two ADAMS
// tools) drives the whole workflow. The browser just:
//   - holds the raw Anthropic `messages` conversation,
//   - calls /api/agent one round at a time,
//   - renders the model's text, its tool calls, and pauses at the human gates,
//   - lets the user reply "go" (or correct) to continue.

// ─── State ────────────────────────────────────────────────────────────────────
// Three fully independent tools sharing one page and one Claude API key. Each mode
// gets its own {messages, running, tokens, rmpFiles} — switching the toggle never
// mixes one mode's conversation into another's, in the browser OR in what gets sent
// to /api/agent (each call only ever sends that mode's own `messages` array).
function freshModeState() {
  return {
    messages: [],   // raw Anthropic message objects (user/assistant, incl. tool blocks)
    running: false, // a loop is in flight
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    rmpFiles: [],   // RMP mode: [{filename, text, error}] extracted client-side from uploads
    lastFinalReportText: null, // most recent final-report text — lets a typed "produce it"
                                // reply export without the user hunting for the button
  };
}
const MODES = ['general', 'design-change', 'rmp'];
const perModeState = {};
MODES.forEach(m => { perModeState[m] = freshModeState(); });

// `state` always aliases the CURRENTLY VISIBLE mode's state — safe for synchronous
// UI code (click/change handlers), which only ever runs while that mode is on screen.
// The async agent loop is the one place a mode switch could happen mid-flight, so it
// captures its own `modeState` explicitly instead of relying on this alias.
let state = perModeState[document.querySelector('input[name="mode"]:checked')?.value || 'general'];

const MAX_AUTOMATED_TURNS = 50; // safety cap on tool rounds per user message

// ─── DOM helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const feedEl = mode => $('feed-' + mode);

function getModel() {
  return document.querySelector('input[name="model"]:checked')?.value || 'claude-sonnet-5';
}

function getMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || 'general';
}

const PLACEHOLDERS = {
  'general':
    'Find a document, look up an amendment, or ask anything about ADAMS.\n\nExample: What are the latest license amendments for Hatch?',
  'design-change':
    'Describe the design-basis change to analyze — include the plant name and date range.\n\nExample: feedwater design changes at Hatch since 1/1/99',
  'rmp':
    'Describe the project — scope, who\'s involved, what concerns you — or just upload documents above.\n\nExample: New switchyard relay upgrade for a client substation, ~9 month schedule, one subcontractor doing the physical install.',
};

// Local date/time for the report stamp (browser knows the right timezone).
function nowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const tz = (d.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop()) || '';
  return { date, dateTime: `${date} ${p(d.getHours())}:${p(d.getMinutes())} ${tz}`.trim() };
}

async function post(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appendToFeed(el, scrollBlock = 'nearest', mode = getMode()) {
  feedEl(mode).appendChild(el);
  // Only auto-scroll if that mode's feed is the one actually on screen — scrolling a
  // hidden background-mode feed would do nothing useful and could jank the layout.
  if (mode === getMode()) {
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: scrollBlock }));
  }
  return el;
}

// Resets ONE mode back to empty — used when starting a brand-new search in it.
// Never touches the other two modes' state.
function clearFeed(mode = getMode()) {
  feedEl(mode).innerHTML = '';
  perModeState[mode] = freshModeState();
  if (mode === getMode()) {
    state = perModeState[mode];
    updateTokenStatus();
    const input = $('rmp-files');
    if (input) input.value = '';
    renderRmpFileList();
  }
}

// ─── RMP mode: file upload + client-side text extraction ────────────────────
// Uploaded project documents (.docx / .pdf) are extracted to plain text entirely in
// the browser (mammoth.js for .docx, pdf.js for .pdf) and attached to the first
// message as delimited text blocks — no server-side file handling, matching the
// rest of the app's zero-storage design.

async function extractDocxText(file) {
  if (!window.mammoth) throw new Error('mammoth.js failed to load — try reloading the page.');
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

async function extractPdfText(file) {
  if (!window.pdfjsLib) throw new Error('pdf.js failed to load — try reloading the page.');
  const arrayBuffer = await file.arrayBuffer();
  const doc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(content.items.map(it => it.str).join(' '));
  }
  return pages.join('\n\n').trim();
}

async function extractFileText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return extractDocxText(file);
  if (name.endsWith('.pdf')) return extractPdfText(file);
  throw new Error('Unsupported file type — only .docx and .pdf are supported.');
}

function renderRmpFileList() {
  const list = $('rmp-file-list');
  if (!list) return;
  list.innerHTML = state.rmpFiles.map((f, i) => `
    <li class="rmp-file-item${f.error ? ' rmp-file-error' : ''}">
      <span class="rmp-file-name">${escHtml(f.filename)}</span>
      <span class="rmp-file-status">${f.loading ? 'reading…' : f.error ? escHtml(f.error) : `${f.text.length.toLocaleString()} chars`}</span>
      <button type="button" class="rmp-file-remove" data-idx="${i}" aria-label="Remove ${escHtml(f.filename)}">&times;</button>
    </li>`).join('');
  list.querySelectorAll('.rmp-file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.rmpFiles.splice(Number(btn.dataset.idx), 1);
      renderRmpFileList();
    });
  });
}

async function handleRmpFilesSelected(fileList) {
  for (const file of Array.from(fileList)) {
    const entry = { filename: file.name, text: '', loading: true, error: null };
    state.rmpFiles.push(entry);
    renderRmpFileList();
    try {
      entry.text = await extractFileText(file);
      if (!entry.text) entry.error = 'No extractable text found (scanned image?)';
    } catch (err) {
      entry.error = err.message || String(err);
    } finally {
      entry.loading = false;
      renderRmpFileList();
    }
  }
}

// Build the delimited upload block appended to the user's first RMP message — the
// exact "===== UPLOADED FILE: <filename> =====" format RMP_WEB_PREAMBLE expects.
function buildRmpUploadBlock() {
  const usable = state.rmpFiles.filter(f => f.text && !f.error);
  if (!usable.length) return '';
  return '\n\n' + usable.map(f => `===== UPLOADED FILE: ${f.filename} =====\n${f.text}`).join('\n\n');
}

// ─── Compact Markdown renderer ───────────────────────────────────────────────
// Covers what the skill's report format uses: headings, bold/italic/code, links,
// ordered/unordered lists, pipe tables, blockquotes, hr, paragraphs.
function inlineMd(text) {
  let s = escHtml(text);
  // inline code first (protect its contents from other rules)
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  // bold then italic
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

function renderMarkdown(md) {
  const lines = (md || '').split('\n');
  let html = '';
  let i = 0;

  const flushList = (items, ordered) => {
    const tag = ordered ? 'ol' : 'ul';
    html += `<${tag}>${items.map(it => `<li>${inlineMd(it)}</li>`).join('')}</${tag}>`;
  };

  while (i < lines.length) {
    let line = lines[i];

    // blank
    if (!line.trim()) { i++; continue; }

    // horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { html += '<hr>'; i++; continue; }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lvl = h[1].length; html += `<h${lvl}>${inlineMd(h[2])}</h${lvl}>`; i++; continue; }

    // pipe table: header row + separator row
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const splitRow = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
      const headers = splitRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i])); i++;
      }
      // Wrapped in a scrollable container — wide tables (the RMP risk-exposure table
      // can run 9 columns) get a horizontal scrollbar instead of being crushed to fit
      // the card width, which is what made them look janky.
      html += '<div class="table-scroll"><table class="md-table"><thead><tr>' +
        headers.map(hd => `<th>${inlineMd(hd)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>';
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      html += `<blockquote>${inlineMd(quote.join(' '))}</blockquote>`;
      continue;
    }

    // unordered list (allow blank lines between items — a "loose" list is still one list)
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
        else if (!lines[i].trim() && i + 1 < lines.length && /^\s*[-*]\s+/.test(lines[i + 1])) { i++; }
        else break;
      }
      flushList(items, false); continue;
    }

    // ordered list — renumber sequentially via <ol>; allow blank lines between items.
    // The model often writes every item as "1." (lazy Markdown numbering); keeping the
    // items in ONE list lets the browser/PDF renumber them 1, 2, 3, … correctly.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
        else if (!lines[i].trim() && i + 1 < lines.length && /^\s*\d+\.\s+/.test(lines[i + 1])) { i++; }
        else break;
      }
      flushList(items, true); continue;
    }

    // paragraph: gather consecutive non-blank, non-block lines
    const para = [];
    while (i < lines.length && lines[i].trim() &&
           !/^(#{1,6})\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) &&
           !/^\s*\d+\.\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) &&
           !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    // Preserve single newlines as line breaks so the report's metadata header block
    // (Plant / Dockets / System / …) stacks on separate lines instead of running on.
    html += `<p>${para.map(inlineMd).join('<br>')}</p>`;
  }
  return html;
}

// ─── Feed elements ──────────────────────────────────────────────────────────────
function appendUserBubble(text, mode = getMode()) {
  const el = document.createElement('div');
  el.className = 'feed-bubble feed-bubble-user';
  el.textContent = text;
  appendToFeed(el, 'nearest', mode);
}

function appendAssistantText(text, mode = getMode()) {
  if (!text) return;
  // Only show a save button on the final deliverable, which every mode's preamble
  // forces to start with "# " (H1 title). Intermediate messages (plan, triage, gate
  // prompts, RMP clarifying questions) start with conversational text.
  const isFinalReport = text.trimStart().startsWith('# ');
  const isRmp = mode === 'rmp';
  const saveLabel = isRmp ? 'Looks great! Produce Word Document' : 'Looks great! Produce PDF Report';
  const saveTitle = isRmp ? 'Save this plan as a Word document (no tokens used)' : 'Save this report as a PDF (no tokens used)';
  const el = document.createElement('div');
  el.className = 'card assistant-card';
  el.innerHTML = `
    <div class="md-body">${renderMarkdown(text)}</div>
    <div class="card-tools">
      <button class="card-tool btn-copy-md" title="Copy this as Markdown">Copy</button>
    </div>
    ${isFinalReport ? `<div class="report-export">
      <button class="btn-primary btn-save-doc" title="${saveTitle}">${saveLabel}</button>
    </div>` : ''}`;

  el.querySelector('.btn-copy-md').addEventListener('click', e => {
    navigator.clipboard.writeText(text).then(() => {
      const b = e.currentTarget, o = b.textContent;
      b.textContent = 'Copied!';
      setTimeout(() => { b.textContent = o; }, 1500);
    });
  });
  if (isFinalReport) {
    el.querySelector('.btn-save-doc').addEventListener('click', () => {
      if (isRmp) rmpToDocx(text); else reportToPdf(text);
    });
    // Remembered so a typed reply like "looks great, produce it" can trigger the same
    // export without the user scrolling back up to find this button (see appendReplyBox).
    perModeState[mode].lastFinalReportText = text;
  }

  // RMP mode: show each row's computed risk level right in the chat table (the app
  // computes it the same deterministic way it colors the Word doc's cells — the model
  // never picks it) so a glance at the table shows which risks are severe.
  if (isRmp) injectRmpRiskLevelColumn(el.querySelector('.md-body'), text);

  // Scroll to the TOP of the card so the user reads top-to-bottom after a long response.
  // Tool calls and loading indicators still use the default 'nearest' (scroll to bottom).
  appendToFeed(el, 'start', mode);
}

// ─── Client-side PDF with correctly-placed bookmarks ──────────────────────────
// Generates the report PDF programmatically with jsPDF (vendored). Because we lay
// the text out ourselves, we know exactly which PAGE each heading lands on, so the
// outline/bookmark entry points to the right page — not all to page 1 (the bug in
// the skill's pandoc output). Uses ZERO model tokens; re-renders text already in hand.

// Parse one line of Markdown into styled runs: [{text, bold, italic, code, url}]
function parseInline(text) {
  const runs = [];
  const re = /(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let last = 0, m;
  const push = (t, style) => { if (t) runs.push({ text: t, ...style }); };
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index), {});
    if (m[1]) push(m[2], { url: m[3] });            // [text](url)
    else if (m[4]) push(m[5], { bold: true });       // **bold**
    else if (m[6]) push(m[7], { italic: true });     // *italic*
    else if (m[8]) push(m[9], { code: true });       // `code`
    last = re.lastIndex;
  }
  push(text.slice(last), {});
  return runs.length ? runs : [{ text: '' }];
}

// Parse the report Markdown into a flat list of block objects.
function parseBlocks(md) {
  const lines = (md || '').split('\n');
  const blocks = [];
  let i = 0;
  const splitRow = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ type: 'h', level: h[1].length, text: h[2] }); i++; continue; }

    // table
    if (line.includes('|') && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const headers = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ type: 'quote', text: quote.join(' ') });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
        else if (!lines[i].trim() && i + 1 < lines.length && /^\s*[-*]\s+/.test(lines[i + 1])) { i++; }
        else break;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list: keep items in one block across blank-line separators so the PDF
    // renderer numbers them 1, 2, 3, … (the model often writes every item as "1.").
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
        else if (!lines[i].trim() && i + 1 < lines.length && /^\s*\d+\.\s+/.test(lines[i + 1])) { i++; }
        else break;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) &&
           !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) &&
           !/^\s*>\s?/.test(lines[i]) && !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    blocks.push({ type: 'p', lines: para });   // keep lines separate (metadata block stacks)
  }
  return blocks;
}

function buildReportDoc(markdown) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const headings = []; // {title, level, page} — mirrors the outline, used for verification

  const MARGIN = 72, PW = 612, PH = 792;            // 1in margins, US Letter
  const LEFT = MARGIN, RIGHT = PW - MARGIN, BOTTOM = PH - MARGIN, CONTENT_W = RIGHT - LEFT;
  const ACCENT = [46, 90, 136];   // #2E5A88 — links + section headings
  const NAVY   = [31, 58, 95];    // #1F3A5F — title + sub-headings
  const LINK = ACCENT, TEXT = [26, 26, 26], MUTED = [108, 116, 128];
  const BODY = 11;                // base body point size

  let y = MARGIN;
  let lastH1 = null, lastH2 = null; // outline parents for nesting

  const page = () => doc.getCurrentPageInfo().pageNumber;
  const needSpace = h => { if (y + h > BOTTOM) { doc.addPage(); y = MARGIN; } };

  // Flow styled runs across lines, wrapping within [LEFT, RIGHT], advancing y.
  function flowRuns(runs, { size, lineGap = 1.4, indent = 0, hangingIndent = 0, color = TEXT, bold = false }) {
    const lineH = size * lineGap;
    let x = LEFT + indent;
    const startX = LEFT + indent;
    const wrapX = LEFT + hangingIndent;
    let lineStart = true;

    const newline = () => { y += lineH; x = wrapX; lineStart = true; needSpace(lineH); };
    needSpace(lineH);

    for (const run of runs) {
      doc.setFont('helvetica', (run.bold || bold) ? 'bold' : (run.italic ? 'italic' : 'normal'));
      if (run.code) doc.setFont('courier', 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...(run.url ? LINK : color));

      const words = run.text.split(/(\s+)/).filter(w => w.length); // keep spaces as tokens
      for (const w of words) {
        if (/^\s+$/.test(w)) { if (!lineStart) { x += doc.getTextWidth(' '); } continue; }
        const ww = doc.getTextWidth(w);
        if (!lineStart && x + ww > RIGHT) newline();
        doc.text(w, x, y);
        if (run.url) doc.link(x, y - size, ww, size + 2, { url: run.url });
        x += ww;
        lineStart = false;
      }
    }
    y += lineH; // end the block's last line
    doc.setTextColor(...TEXT);
  }

  // Replace Unicode chars outside Helvetica's cp1252 charset — they appear in NRC
  // document excerpts and render as garbage (→ becomes !', ≥ becomes "e, etc.)
  const safeMd = markdown
    .replace(/→/g, '->').replace(/←/g, '<-').replace(/⇒/g, '=>')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≠/g, '!=')
    .replace(/…/g, '...');

  const blocks = parseBlocks(safeMd);
  const title = (blocks.find(b => b.type === 'h') || {}).text;
  const fileTitle = (title ? title.replace(/[*`\[\]()]/g, '').trim() : 'ADAMS Analysis');

  for (const b of blocks) {
    if (b.type === 'h') {
      const sizes = { 1: 20, 2: 14, 3: 12, 4: 11, 5: 11, 6: 11 };
      const size = sizes[b.level] || 11;
      const hColor = b.level === 2 ? ACCENT : NAVY;   // section headings accent, others navy
      y += (b.level === 1 ? 4 : (b.level === 2 ? 17 : 11));
      needSpace(size * 1.7);
      // Register the bookmark AFTER the page-break check, so it points to the page
      // the heading actually renders on.
      const plain = b.text.replace(/[*`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
      const pageNum = page();
      if (b.level === 1) { lastH1 = doc.outline.add(null, plain, { pageNumber: pageNum }); lastH2 = null; }
      else if (b.level === 2) { lastH2 = doc.outline.add(lastH1, plain, { pageNumber: pageNum }); }
      else { doc.outline.add(lastH2 || lastH1, plain, { pageNumber: pageNum }); }
      headings.push({ title: plain, level: b.level, page: pageNum });

      flowRuns(parseInline(b.text), { size, lineGap: 1.2, color: hColor, bold: true });
      if (b.level === 2) { // thin accent rule under section headings
        doc.setDrawColor(...ACCENT); doc.setLineWidth(0.6);
        doc.line(LEFT, y - size * 0.35, RIGHT, y - size * 0.35);
      }
      y += (b.level === 1 ? 7 : 3);
    }

    else if (b.type === 'p') {
      (b.lines || [b.text]).forEach(line => flowRuns(parseInline(line), { size: BODY }));
      y += 6;
    }

    else if (b.type === 'ul' || b.type === 'ol') {
      b.items.forEach((it, idx) => {
        const marker = b.type === 'ol' ? `${idx + 1}.` : '•';
        doc.setFont('helvetica', 'normal'); doc.setFontSize(BODY); doc.setTextColor(...TEXT);
        needSpace(BODY * 1.4);
        doc.text(marker, LEFT + 8, y);
        flowRuns(parseInline(it), { size: BODY, indent: 24, hangingIndent: 24 });
        y += 2;
      });
      y += 5;
    }

    else if (b.type === 'quote') {
      const top = y;
      flowRuns(parseInline(b.text), { size: BODY, indent: 14, hangingIndent: 14, color: MUTED });
      doc.setDrawColor(...ACCENT); doc.setLineWidth(2.5);
      doc.line(LEFT + 3, top - BODY, LEFT + 3, y - BODY);
      y += 6;
    }

    else if (b.type === 'hr') {
      needSpace(14);
      doc.setDrawColor(205, 212, 222); doc.setLineWidth(0.6);
      doc.line(LEFT, y, RIGHT, y); y += 14;
    }

    else if (b.type === 'table') {
      doc.autoTable({
        head: [b.headers],
        body: b.rows.map(r => r.map(c => c.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, ''))),
        startY: y + 2,
        margin: { left: LEFT, right: MARGIN },
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, overflow: 'linebreak', minCellWidth: 55, textColor: TEXT, lineColor: [200, 208, 218], lineWidth: 0.4 },
        headStyles: { fillColor: [232, 238, 244], textColor: NAVY, fontStyle: 'bold' },
      });
      y = doc.lastAutoTable.finalY + 12;
    }
  }

  // Page numbers in the footer.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Page ${p} of ${total}`, PW / 2, PH - 28, { align: 'center' });
  }

  return { doc, headings, fileTitle, pages: doc.getNumberOfPages() };
}

function makeFilename(markdown) {
  // Build a short summary from the report's metadata block, then append the date.
  // Prefer "Hatch Feedwater 2026-06-10.pdf" over the full H1 title.
  const plantLine = (markdown.match(/\*\*Plant\s*[/]\s*units:\*\*\s*(.+)/i) || [])[1] || '';
  const systemLine = (markdown.match(/\*\*System:\*\*\s*(.+)/i) || [])[1] || '';

  // Short plant name: word immediately before "Nuclear", else first word
  let plant = '';
  if (plantLine) {
    const m = plantLine.match(/(\w[\w.'-]*)\s+Nuclear/i);
    plant = m ? m[1] : plantLine.split(/[\s,]/)[0].trim();
  }

  // System: strip trailing "System(s)" suffix
  const system = systemLine.trim().replace(/\s+Systems?$/i, '').replace(/[/\\:*?"<>|]/g, '-').trim();

  const parts = [plant, system].filter(Boolean);
  const summary = parts.length ? parts.join(' ') : 'ADAMS Analysis';
  return `${summary} ${nowStamp().date}.pdf`;
}

function reportToPdf(markdown) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('PDF library failed to load — try reloading the page.');
    return;
  }
  const { doc } = buildReportDoc(markdown);
  doc.save(makeFilename(markdown));
}

// ─── RMP mode: client-side Word document generation ─────────────────────────
// Fills the real QF-034.docx template (docxtemplater + pizzip, vendored) rather than
// recreating it from scratch. The app — not the model — computes each row's
// Green/Yellow/Red color deterministically from the fixed Likelihood x Impact matrix
// (extracted from ENERCON's QF-034 template), so a model judgment mistake can never
// produce a mismatched color. Uses ZERO model tokens; re-renders text already in hand.

const RMP_RISK_MATRIX = {
  H: { L: 'Yellow', M: 'Red',    H: 'Red' },
  M: { L: 'Green',  M: 'Yellow', H: 'Red' },
  L: { L: 'Green',  M: 'Green',  H: 'Yellow' },
};
const RMP_COLOR_HEX = { Green: '00B050', Yellow: 'FFFF00', Red: 'FF0000' };

function normalizeLMH(raw) {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'l' || s.startsWith('low') || s.startsWith('unlikely')) return 'L';
  if (s === 'm' || s.startsWith('med') || s === 'possible') return 'M';
  if (s === 'h' || s.startsWith('high') || s.startsWith('likely')) return 'H';
  const first = s[0] ? s[0].toUpperCase() : '';
  return (first === 'L' || first === 'M' || first === 'H') ? first : null;
}

// Returns 'Green'|'Yellow'|'Red', or null if either rating couldn't be parsed —
// never guesses a color it can't justify from the matrix.
function resolveRiskColor(likelihoodRaw, impactRaw) {
  const l = normalizeLMH(likelihoodRaw), i = normalizeLMH(impactRaw);
  if (!l || !i) return null;
  return RMP_RISK_MATRIX[l][i];
}

// Column lookup: exact header match preferred, falls back to a keyword match so
// minor model phrasing drift still resolves correctly.
function findRmpCol(headers, exact, mustInclude, mustExclude = []) {
  const lower = headers.map(h => h.trim().toLowerCase());
  const exactIdx = lower.indexOf(exact);
  if (exactIdx !== -1) return exactIdx;
  for (let i = 0; i < lower.length; i++) {
    if (mustInclude.every(p => lower[i].includes(p)) && !mustExclude.some(p => lower[i].includes(p))) return i;
  }
  return -1;
}

// Locate the risk exposure table: the first pipe table whose header row includes a
// "risk exposure" column (so any other incidental table is ignored).
function parseRmpRiskTable(markdown) {
  const lines = (markdown || '').split('\n');
  const splitRow = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (!line.includes('|')) continue;
    if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) || !lines[i + 1].includes('-')) continue;
    const headers = splitRow(line);
    if (!headers.some(h => /risk\s*exposure/i.test(h))) continue;
    let j = i + 2;
    const rows = [];
    while (j < lines.length && lines[j].includes('|') && lines[j].trim()) { rows.push(splitRow(lines[j])); j++; }
    return { headers, rows };
  }
  return null;
}

const RMP_LEVEL_LABEL = { Green: 'Low', Yellow: 'Medium', Red: 'High' };

// Inserts a computed "Risk Level" column into the CHAT-rendered risk table (not the
// underlying markdown, not the Word doc) right after Impact — same deterministic
// Likelihood x Impact matrix the app uses everywhere else, so what you see here always
// matches what lands in the exported document. `bodyEl` is the .md-body just rendered.
function injectRmpRiskLevelColumn(bodyEl, markdown) {
  const parsed = parseRmpRiskTable(markdown);
  if (!parsed || !bodyEl) return;
  const likIdx = findRmpCol(parsed.headers, 'likelihood', ['likelihood']);
  const impIdx = findRmpCol(parsed.headers, 'impact', ['impact'], ['detail', 'area']);
  if (likIdx < 0 || impIdx < 0) return;

  const tables = bodyEl.querySelectorAll('table.md-table');
  for (const table of tables) {
    const headerRow = table.querySelector('thead tr');
    const headerCells = headerRow ? Array.from(headerRow.children) : [];
    if (!headerCells.some(th => /risk\s*exposure/i.test(th.textContent))) continue; // not the risk table

    const insertAt = impIdx + 1;
    const th = document.createElement('th');
    th.textContent = 'Risk Level';
    headerRow.insertBefore(th, headerRow.children[insertAt] || null);

    Array.from(table.querySelectorAll('tbody tr')).forEach((tr, i) => {
      const row = parsed.rows[i];
      const td = document.createElement('td');
      const color = row ? resolveRiskColor(row[likIdx], row[impIdx]) : null;
      td.innerHTML = color
        ? `<span class="risk-badge risk-badge-${color.toLowerCase()}">${RMP_LEVEL_LABEL[color]}</span>`
        : '?';
      tr.insertBefore(td, tr.children[insertAt] || null);
    });
    break; // one risk table per report
  }
}

// Coversheet fields — RMP_WEB_PREAMBLE prescribes this exact "**Label:** value" format.
function extractRmpCoversheet(markdown) {
  const field = label => (markdown.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i')) || [])[1]?.trim() || '';
  return {
    projectNumber: field('Project Number') || 'TBD',
    projectTitle: field('Project Title') || 'Untitled Project',
    revisionNumber: field('Revision Number') || '0',
    revisionDate: field('Revision Date') || nowStamp().date,
  };
}

// Fills the real QF-034 template instead of recreating it — row heights, fonts,
// spacing, the Distribution / Record-of-Revision / Risk-Analysis-Matrix / Compensating-
// Action-Types boilerplate all come from the actual file untouched (that last one lives
// in a table nested inside a cell, which is why an earlier from-scratch rebuild of this
// mode missed it). The app fills only: Project Number/Title/Revision (coversheet + the
// page-4 echo row) and the risk-exposure rows themselves, via a docxtemplater loop over
// one templated table row. See public/assets/rmp/QF-034-fillable-template.docx and
// rmp-reference/ for how the fillable template was derived from the source QF-034.docx.
let _rmpTemplatePromise = null;
function loadRmpTemplate() {
  if (!_rmpTemplatePromise) {
    _rmpTemplatePromise = fetch('assets/rmp/QF-034-fillable-template.docx').then(r => r.arrayBuffer());
  }
  return _rmpTemplatePromise;
}

// The template's "Risk Assessment Color" cell is tagged «{color}» (guillemets), not a
// bare {color} — page 3's own Risk Analysis Matrix legend also has literal "Red"/
// "Yellow"/"Green" text, so a bare-word search would risk re-shading the wrong cells.
// This walks the rendered document.xml, finds each «Red»/«Yellow»/«Green» marker, sets
// that cell's existing shading fill to match, and strips the marker brackets.
function shadeRmpColorCells(zip) {
  const path = 'word/document.xml';
  const xml = zip.file(path).asText();
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const domDoc = new DOMParser().parseFromString(xml, 'application/xml');
  const tcs = domDoc.getElementsByTagNameNS(ns, 'tc');
  for (let i = 0; i < tcs.length; i++) {
    const tc = tcs[i];
    const ts = tc.getElementsByTagNameNS(ns, 't');
    let combined = '';
    for (let j = 0; j < ts.length; j++) combined += ts[j].textContent;
    const m = combined.match(/^«(Red|Yellow|Green|\?)»$/);
    if (!m) continue;
    const color = m[1];
    const hex = RMP_COLOR_HEX[color] || null;
    if (hex) {
      const tcPr = tc.getElementsByTagNameNS(ns, 'tcPr')[0];
      const shd = tcPr && tcPr.getElementsByTagNameNS(ns, 'shd')[0];
      if (shd) shd.setAttributeNS(ns, 'w:fill', hex);
    }
    if (ts.length) {
      ts[0].textContent = color;
      for (let j = 1; j < ts.length; j++) ts[j].textContent = '';
    }
  }
  zip.file(path, new XMLSerializer().serializeToString(domDoc));
}

// Model dates arrive as free text (usually ISO YYYY-MM-DD, matching nowStamp()'s
// convention) — Mat wants them shown as month-day-year in the actual document.
// Falls back to the original string untouched if it can't confidently parse it,
// rather than risk mangling something unexpected into "NaN-NaN-NaN".
function toMonthDayYear(dateStr) {
  const s = (dateStr || '').trim();
  const pad = n => String(n).padStart(2, '0');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${pad(m[2])}-${pad(m[3])}-${m[1]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${pad(m[1])}-${pad(m[2])}-${m[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;
  return s;
}

// Is `keyword` (Quality/Scope/Cost/Schedule) one of the areas the model listed for
// this row? Word-boundary match so "Cost" doesn't false-match inside another word.
function rmpAreaChecked(areasStr, keyword) {
  return new RegExp(`\\b${keyword}\\b`, 'i').test(areasStr || '');
}

// The template's Risk Impact cell already has 4 REAL Word checkbox content controls
// (w14:checkbox — invisible to plain paragraph/run text APIs, same blind spot that
// hid the nested Compensating Action Types table). Rather than draw our own boxes
// (an earlier attempt using ☐/☒ text rendered as garbled tofu — Arial doesn't
// reliably carry those glyphs), this leaves the real controls untouched and just
// flips their checked state, keyed by each checkbox's fixed w:id (stable across every
// cloned row, since docxtemplater clones the same template row's XML verbatim).
const RMP_CHECKBOX_IDS = { quality: '-136496457', scope: '-1348404325', cost: '-244035928', schedule: '-1414457445' };
function setRmpCheckboxes(zip, risks) {
  const path = 'word/document.xml';
  const xml = zip.file(path).asText();
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const w14ns = 'http://schemas.microsoft.com/office/word/2010/wordml';
  const domDoc = new DOMParser().parseFromString(xml, 'application/xml');
  const byKey = {};
  for (const key of Object.keys(RMP_CHECKBOX_IDS)) byKey[key] = [];
  const sdts = domDoc.getElementsByTagNameNS(ns, 'sdt');
  for (let i = 0; i < sdts.length; i++) {
    const idEl = sdts[i].getElementsByTagNameNS(ns, 'id')[0];
    if (!idEl) continue;
    const val = idEl.getAttributeNS(ns, 'val');
    for (const key of Object.keys(RMP_CHECKBOX_IDS)) {
      if (val === RMP_CHECKBOX_IDS[key]) byKey[key].push(sdts[i]);
    }
  }
  risks.forEach((risk, i) => {
    for (const key of Object.keys(RMP_CHECKBOX_IDS)) {
      if (!risk[`${key}Checked`]) continue;
      const sdt = byKey[key][i];
      if (!sdt) continue;
      const checkedEl = sdt.getElementsByTagNameNS(w14ns, 'checked')[0];
      if (checkedEl) checkedEl.setAttributeNS(w14ns, 'w14:val', '1');
      const t = sdt.getElementsByTagNameNS(ns, 't')[0];
      if (t) t.textContent = '☒';
    }
  });
  zip.file(path, new XMLSerializer().serializeToString(domDoc));
}

async function buildRmpDocxBlob(markdown) {
  if (!window.PizZip || !window.docxtemplater) {
    throw new Error('Word template library failed to load');
  }
  const cover = extractRmpCoversheet(markdown);
  const revisionDate = toMonthDayYear(cover.revisionDate);
  const parsed = parseRmpRiskTable(markdown);

  const idx = parsed ? {
    risk: findRmpCol(parsed.headers, 'risk exposure', ['risk', 'exposure']),
    org: findRmpCol(parsed.headers, 'responsible organization', ['respons']),
    likelihood: findRmpCol(parsed.headers, 'likelihood', ['likelihood']),
    impact: findRmpCol(parsed.headers, 'impact', ['impact'], ['detail', 'area']),
    areas: findRmpCol(parsed.headers, 'risk impact areas', ['area']),
    impactDetails: findRmpCol(parsed.headers, 'risk impact details', ['detail'], ['action']),
    actions: findRmpCol(parsed.headers, 'compensating actions', ['action'], ['detail']),
    actionDetails: findRmpCol(parsed.headers, 'compensating action details', ['action', 'detail']),
  } : null;
  const cellText = (row, key) => (idx && idx[key] >= 0 ? (row[idx[key]] || '') : '');

  const risks = (parsed ? parsed.rows : []).map((row, i) => {
    const likelihood = cellText(row, 'likelihood'), impact = cellText(row, 'impact');
    const color = resolveRiskColor(likelihood, impact) || '?';
    const areas = cellText(row, 'areas');
    const actions = cellText(row, 'actions'), actionDetails = cellText(row, 'actionDetails');
    return {
      no: String(i + 1),
      risk: cellText(row, 'risk'),
      org: cellText(row, 'org'),
      likelihood, impact,
      color, // the template's own cell text is «{color}» — don't double-wrap here
      qualityChecked: rmpAreaChecked(areas, 'Quality'),
      scopeChecked: rmpAreaChecked(areas, 'Scope'),
      costChecked: rmpAreaChecked(areas, 'Cost'),
      scheduleChecked: rmpAreaChecked(areas, 'Schedule'),
      impactDetails: cellText(row, 'impactDetails'),
      compActions: [actions ? `Actions: ${actions}` : '', actionDetails].filter(Boolean).join('\n'),
    };
  });
  if (!risks.length) risks.push({
    no: '', risk: '', org: '', likelihood: '', impact: '', color: '',
    qualityChecked: false, scopeChecked: false, costChecked: false, scheduleChecked: false,
    impactDetails: '', compActions: '',
  });

  const templateBuf = await loadRmpTemplate();
  const zip = new window.PizZip(templateBuf);
  const doc = new window.docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render({
    project_number: cover.projectNumber,
    project_title: cover.projectTitle,
    revision_number: cover.revisionNumber,
    revision_date: revisionDate,
    risks,
  });

  const outZip = doc.getZip();
  setRmpCheckboxes(outZip, risks);
  shadeRmpColorCells(outZip);
  const blob = outZip.generate({
    type: 'blob', compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  return { blob, cover };
}

function rmpDocxFilename(cover) {
  const safe = s => (s || '').replace(/[/\\:*?"<>|]/g, '-').trim();
  const title = safe(cover.projectTitle) || 'RMP';
  return `${nowStamp().date} - ${title} - Qualitative RMP.docx`;
}

async function rmpToDocx(markdown) {
  let blob, cover;
  try {
    ({ blob, cover } = await buildRmpDocxBlob(markdown));
  } catch (e) {
    alert('Word document generation failed — try reloading the page.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = rmpDocxFilename(cover);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function appendToolCalls(toolCalls, mode = getMode()) {
  if (!toolCalls || !toolCalls.length) return;
  const el = document.createElement('div');
  el.className = 'tool-calls';
  el.innerHTML = toolCalls.map(tc => `
    <div class="tool-call">
      <span class="tool-icon">${tc.name === 'adams_search' ? '🔍' : '📄'}</span>
      <span class="tool-label">${escHtml(tc.label)}</span>
      <span class="tool-summary">${escHtml(tc.summary)}</span>
    </div>`).join('');
  appendToFeed(el, 'nearest', mode);
}

function appendLoading(msg, mode = getMode()) {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div class="spinner"></div><span>${escHtml(msg)}</span>`;
  return appendToFeed(el, 'nearest', mode);
}

function appendError(msg, mode = getMode()) {
  const el = document.createElement('div');
  el.className = 'card card-error';
  el.innerHTML = `
    <div class="section-title" style="color:var(--error-border)">Error</div>
    <div class="md-body">${renderMarkdown(msg)}</div>`;
  appendToFeed(el, 'nearest', mode);
}

// Reply box — shown whenever it's the user's turn (after the model ends a turn / gate).
// `mode` is captured at creation time so a reply typed into (say) the RMP box always
// continues the RMP conversation, even if the toggle gets flipped around afterward.
// Matches a reply that's clearly just approving/asking for the deliverable rather than
// a real revision request — either an explicit "produce/export/generate ... word/pdf/
// report" anywhere in the message, or the WHOLE message being a short bare affirmation
// ("looks good", "yes", "do it", …). Anchoring the affirmations to the full trimmed
// string (not "anywhere") keeps "looks good but change risk 3" from false-triggering.
const RMP_EXPORT_INTENT = /\b(produce|generate|export|download|create|make|build)\b[\s\S]{0,25}\b(word\s*doc(?:ument)?|docx?|pdf|report)\b|^(?:looks?\s+(?:good|great)|yes|yep|yup|sure|perfect|sounds?\s+good|do\s+it|go\s+ahead|please)[.!,\s]*$/i;

function appendReplyBox(mode = getMode()) {
  const el = document.createElement('div');
  el.className = 'reply-box';
  el.innerHTML = `
    <textarea class="reply-text" rows="2" placeholder="Reply to continue — type 'go' to proceed, or give a correction…"></textarea>
    <button class="btn-primary btn-reply-send">Send</button>`;

  const textarea = el.querySelector('.reply-text');
  const btn = el.querySelector('.btn-reply-send');

  const send = () => {
    const modeState = perModeState[mode];
    const txt = textarea.value.trim();
    if (!txt || modeState.running) { textarea.focus(); return; }

    appendUserBubble(txt, mode);
    el.remove(); // this box's job is done — don't leave a disabled input sitting in the feed

    // A final report is waiting to be exported and this reply is clearly just approval
    // ("looks great", "produce the word doc", …) — handle it right here, same as
    // clicking the button, so the user doesn't have to scroll back up to find it.
    if (modeState.lastFinalReportText && RMP_EXPORT_INTENT.test(txt)) {
      const reportText = modeState.lastFinalReportText;
      if (mode === 'rmp') rmpToDocx(reportText); else reportToPdf(reportText);
      appendAssistantText(
        mode === 'rmp'
          ? "Done — your Word document should be downloading now. Let me know if you'd like any changes."
          : "Done — your PDF should be downloading now. Let me know if you'd like any changes.",
        mode
      );
      appendReplyBox(mode);
      return;
    }

    modeState.messages.push({ role: 'user', content: txt });
    agentLoop(mode);
  };

  btn.addEventListener('click', send);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  appendToFeed(el, 'nearest', mode);
  if (mode === getMode()) textarea.focus(); // don't steal focus for a hidden background mode
}

// Always reads the CURRENTLY VISIBLE mode's tokens — called after every mode switch
// and after any token update that lands on the mode currently on screen.
function updateTokenStatus() {
  const t = perModeState[getMode()].tokens;
  const total = t.input + t.output;
  const el = $('token-status');
  if (!el) return;
  if (total === 0) { el.textContent = ''; return; }
  const cached = t.cacheRead ? ` · ${t.cacheRead.toLocaleString()} cached` : '';
  el.textContent = `Tokens this session: ${t.input.toLocaleString()} in · ${t.output.toLocaleString()} out${cached}`;
}

function addUsage(usage, mode) {
  if (!usage) return;
  const t = perModeState[mode].tokens;
  t.input      += usage.input      || 0;
  t.output     += usage.output     || 0;
  t.cacheRead  += usage.cacheRead  || 0;
  t.cacheWrite += usage.cacheWrite || 0;
  // Only refresh the visible counter if this update landed on the mode on screen —
  // a background mode's usage still accumulates, it just doesn't repaint the footer.
  if (mode === getMode()) updateTokenStatus();
}

// ─── The agentic loop ──────────────────────────────────────────────────────────
// `mode` is passed in explicitly (never re-read via getMode() once running) and all
// state goes through `modeState` — so a toggle flip mid-request can't ever mutate the
// wrong mode's conversation or append a card into the wrong mode's feed.
async function agentLoop(mode) {
  const modeState = perModeState[mode];
  modeState.running = true;
  let autoTurns = 0;

  try {
    while (true) {
      const loader = appendLoading('Thinking…', mode);
      let data;
      try {
        data = await post('/api/agent', { messages: modeState.messages, model: getModel(), mode, clientDateTime: nowStamp().dateTime });
      } catch (err) {
        loader.remove();
        appendError('Could not reach the server. Check your connection and try again.', mode);
        appendReplyBox(mode);
        return;
      }
      loader.remove();

      if (!data || data.type === 'error') {
        appendError(data?.message || 'Unexpected error from the agent endpoint.', mode);
        appendReplyBox(mode);
        return;
      }

      addUsage(data.usage, mode);
      appendAssistantText(data.text, mode);

      // Append the assistant message to the conversation.
      modeState.messages.push({ role: 'assistant', content: data.assistant });

      if (data.type === 'tool_turn') {
        appendToolCalls(data.toolCalls, mode);
        // Feed tool results back as the next user message.
        modeState.messages.push({ role: 'user', content: data.toolResults });

        autoTurns++;
        if (autoTurns >= MAX_AUTOMATED_TURNS) {
          appendError(`Stopped after ${MAX_AUTOMATED_TURNS} automated steps to keep things in check. Reply 'continue' to let it keep going.`, mode);
          appendReplyBox(mode);
          return;
        }
        continue; // keep the loop going
      }

      // type === 'final' → model ended its turn (a gate, a question, or the answer).
      appendReplyBox(mode);
      return;
    }
  } finally {
    modeState.running = false;
  }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
function startConversation() {
  const q = $('query-input').value.trim();
  const mode = getMode();
  const modeState = perModeState[mode];
  const uploadBlock = mode === 'rmp' ? buildRmpUploadBlock() : '';
  if ((!q && !uploadBlock) || modeState.running) { $('query-input').focus(); return; }

  const files = modeState.rmpFiles.slice(); // capture before clearFeed() wipes them
  clearFeed(mode);
  appendUserBubble(q || `(${files.length} uploaded document${files.length === 1 ? '' : 's'}, no additional message)`, mode);
  perModeState[mode].messages = [{ role: 'user', content: q + uploadBlock }];
  $('query-input').value = '';
  agentLoop(mode);
}

$('btn-submit').addEventListener('click', startConversation);

$('query-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startConversation(); }
});

// Mode toggle — three independent tools sharing one page. Switching just shows/hides
// each mode's own feed and re-points `state` at its own {messages, tokens, rmpFiles};
// nothing is cleared, so flipping back to a mode restores exactly what was there.
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const mode = radio.value;
    $('query-input').placeholder = PLACEHOLDERS[mode] || PLACEHOLDERS['general'];
    const isRmp = mode === 'rmp';
    $('rmp-upload').classList.toggle('hidden', !isRmp);

    MODES.forEach(m => feedEl(m).classList.toggle('hidden', m !== mode));
    state = perModeState[mode];
    updateTokenStatus();
    if (isRmp) renderRmpFileList(); // refresh with whatever was staged before leaving
  });
});

// RMP file upload — extract text client-side as soon as files are chosen
$('rmp-files').addEventListener('change', e => {
  handleRmpFilesSelected(e.target.files);
  e.target.value = ''; // allow re-selecting a file / picking more without clearing the list
});

// How It Works modal
$('how-link').addEventListener('click', e => { e.preventDefault(); $('modal-how').showModal(); });
$('modal-close').addEventListener('click', () => $('modal-how').close());
$('modal-how').addEventListener('click', e => { if (e.target === $('modal-how')) $('modal-how').close(); });

// Surface unhandled errors in the feed instead of failing silently.
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled rejection:', e.reason);
  appendError(`Unexpected error: ${e.reason?.message || String(e.reason)}`);
});
