// Adams Web Searcher — client-side driver for the model-led agentic loop.
//
// The model (running server-side with the real adams-search-api skill + two ADAMS
// tools) drives the whole workflow. The browser just:
//   - holds the raw Anthropic `messages` conversation,
//   - calls /api/agent one round at a time,
//   - renders the model's text, its tool calls, and pauses at the human gates,
//   - lets the user reply "go" (or correct) to continue.

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  messages: [],   // raw Anthropic message objects (user/assistant, incl. tool blocks)
  running: false, // a loop is in flight
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const MAX_AUTOMATED_TURNS = 50; // safety cap on tool rounds per user message

// ─── DOM helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const feed = () => $('feed');

function getModel() {
  return document.querySelector('input[name="model"]:checked')?.value || 'claude-opus-4-8';
}

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

function appendToFeed(el, scrollBlock = 'nearest') {
  feed().appendChild(el);
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: scrollBlock }));
  return el;
}

function clearFeed() {
  feed().innerHTML = '';
  state.messages = [];
  state.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  updateTokenStatus();
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
      html += '<table class="md-table"><thead><tr>' +
        headers.map(hd => `<th>${inlineMd(hd)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>';
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
function appendUserBubble(text) {
  const el = document.createElement('div');
  el.className = 'feed-bubble feed-bubble-user';
  el.textContent = text;
  appendToFeed(el);
}

function appendAssistantText(text) {
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'card assistant-card';
  el.innerHTML = `
    <div class="md-body">${renderMarkdown(text)}</div>
    <div class="card-tools">
      <button class="card-tool btn-copy-md" title="Copy this as Markdown">Copy</button>
      <button class="card-tool btn-save-pdf" title="Open a printable PDF of this report (no tokens used)">Save as PDF</button>
    </div>`;

  el.querySelector('.btn-copy-md').addEventListener('click', e => {
    navigator.clipboard.writeText(text).then(() => {
      const b = e.currentTarget, o = b.textContent;
      b.textContent = 'Copied!';
      setTimeout(() => { b.textContent = o; }, 1500);
    });
  });
  el.querySelector('.btn-save-pdf').addEventListener('click', () => reportToPdf(text));

  // Scroll to the TOP of the card so the user reads top-to-bottom after a long response.
  // Tool calls and loading indicators still use the default 'nearest' (scroll to bottom).
  appendToFeed(el, 'start');
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

function appendToolCalls(toolCalls) {
  if (!toolCalls || !toolCalls.length) return;
  const el = document.createElement('div');
  el.className = 'tool-calls';
  el.innerHTML = toolCalls.map(tc => `
    <div class="tool-call">
      <span class="tool-icon">${tc.name === 'adams_search' ? '🔍' : '📄'}</span>
      <span class="tool-label">${escHtml(tc.label)}</span>
      <span class="tool-summary">${escHtml(tc.summary)}</span>
    </div>`).join('');
  appendToFeed(el);
}

function appendLoading(msg) {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div class="spinner"></div><span>${escHtml(msg)}</span>`;
  return appendToFeed(el);
}

function appendError(msg) {
  const el = document.createElement('div');
  el.className = 'card card-error';
  el.innerHTML = `
    <div class="section-title" style="color:var(--error-border)">Error</div>
    <div class="md-body">${renderMarkdown(msg)}</div>`;
  appendToFeed(el);
}

// Reply box — shown whenever it's the user's turn (after the model ends a turn / gate).
function appendReplyBox() {
  const el = document.createElement('div');
  el.className = 'reply-box';
  el.innerHTML = `
    <textarea class="reply-text" rows="2" placeholder="Reply to continue — type 'go' to proceed, or give a correction…"></textarea>
    <button class="btn-primary btn-reply-send">Send</button>`;

  const textarea = el.querySelector('.reply-text');
  const btn = el.querySelector('.btn-reply-send');

  const send = () => {
    const txt = textarea.value.trim();
    if (!txt || state.running) { textarea.focus(); return; }
    btn.disabled = true; textarea.disabled = true;
    appendUserBubble(txt);
    state.messages.push({ role: 'user', content: txt });
    agentLoop();
  };

  btn.addEventListener('click', send);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  appendToFeed(el);
  textarea.focus();
}

function updateTokenStatus() {
  const t = state.tokens;
  const total = t.input + t.output;
  const el = $('token-status');
  if (!el) return;
  if (total === 0) { el.textContent = ''; return; }
  const cached = t.cacheRead ? ` · ${t.cacheRead.toLocaleString()} cached` : '';
  el.textContent = `Tokens this session: ${t.input.toLocaleString()} in · ${t.output.toLocaleString()} out${cached}`;
}

function addUsage(usage) {
  if (!usage) return;
  state.tokens.input     += usage.input     || 0;
  state.tokens.output    += usage.output    || 0;
  state.tokens.cacheRead += usage.cacheRead || 0;
  state.tokens.cacheWrite+= usage.cacheWrite|| 0;
  updateTokenStatus();
}

// ─── The agentic loop ──────────────────────────────────────────────────────────
async function agentLoop() {
  state.running = true;
  let autoTurns = 0;

  try {
    while (true) {
      const loader = appendLoading('Thinking…');
      let data;
      try {
        data = await post('/api/agent', { messages: state.messages, model: getModel(), clientDateTime: nowStamp().dateTime });
      } catch (err) {
        loader.remove();
        appendError('Could not reach the server. Check your connection and try again.');
        appendReplyBox();
        return;
      }
      loader.remove();

      if (!data || data.type === 'error') {
        appendError(data?.message || 'Unexpected error from the agent endpoint.');
        appendReplyBox();
        return;
      }

      addUsage(data.usage);
      appendAssistantText(data.text);

      // Append the assistant message to the conversation.
      state.messages.push({ role: 'assistant', content: data.assistant });

      if (data.type === 'tool_turn') {
        appendToolCalls(data.toolCalls);
        // Feed tool results back as the next user message.
        state.messages.push({ role: 'user', content: data.toolResults });

        autoTurns++;
        if (autoTurns >= MAX_AUTOMATED_TURNS) {
          appendError(`Stopped after ${MAX_AUTOMATED_TURNS} automated steps to keep things in check. Reply 'continue' to let it keep going.`);
          appendReplyBox();
          return;
        }
        continue; // keep the loop going
      }

      // type === 'final' → model ended its turn (a gate, a question, or the answer).
      appendReplyBox();
      return;
    }
  } finally {
    state.running = false;
  }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
function startConversation() {
  const q = $('query-input').value.trim();
  if (!q || state.running) { $('query-input').focus(); return; }

  clearFeed();
  appendUserBubble(q);
  state.messages = [{ role: 'user', content: q }];
  $('query-input').value = '';
  agentLoop();
}

$('btn-submit').addEventListener('click', startConversation);

$('query-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startConversation(); }
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
