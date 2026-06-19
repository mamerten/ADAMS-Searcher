// ADAMS Public Search API executors — the server-side implementation of the two
// tools the model calls. These mirror the ADAMS MCP server's tool interface that
// the adams-search-api skill is written against, so the model uses them naturally.
//
// The subscription key is passed in from the Pages Function env (never hardcoded,
// never sent to the browser).

const ADAMS_SEARCH_URL = 'https://adams-api.nrc.gov/aps/api/search';

// Reconstruct the NRC document URL from an ML accession number when the API omits Url.
function mlToUrl(accessionNumber, apiUrl) {
  if (apiUrl) return apiUrl;
  const prefix = (accessionNumber || '').slice(0, 6);
  return `https://www.nrc.gov/docs/${prefix}/${accessionNumber}.pdf`;
}

// Build the ADAMS POST body per the skill's rules:
//   - dockets → anyFilters (OR), one entry each; full 05000XXX uses `equals`, a
//     prefix like 05000 uses `starts` (fleet-wide)
//   - date range → ONE combined filter entry (ge + and + le); single-sided stays alone
//   - documentType → `starts`
//   - title → DocumentTitle `contains` (title-only match, vs `q` which is full-text)
//   - both library filters true unless overridden
function buildSearchBody(params, skip) {
  const filters = [];
  const anyFilters = [];

  const { query, document_type, date_from, date_to, title } = params;

  // Date range — one combined entry when both bounds are present.
  if (date_from && date_to) {
    filters.push({
      field: 'DocumentDate',
      value: `(DocumentDate ge '${date_from}' and DocumentDate le '${date_to}')`,
    });
  } else if (date_from) {
    filters.push({ field: 'DocumentDate', value: `(DocumentDate ge '${date_from}')` });
  } else if (date_to) {
    filters.push({ field: 'DocumentDate', value: `(DocumentDate le '${date_to}')` });
  }

  if (document_type) {
    filters.push({ field: 'DocumentType', value: document_type, operator: 'starts' });
  }

  // Title-only search: match the term(s) in DocumentTitle, not the full text.
  // Multiple words are ANDed (ADAMS 'contains' semantics). Complements `q`, which
  // searches content + metadata broadly.
  if (title) {
    filters.push({ field: 'DocumentTitle', value: title, operator: 'contains' });
  }

  // Dockets: accept a single `docket` or a `dockets` array (multi-unit OR search).
  const dockets = [];
  if (Array.isArray(params.dockets)) dockets.push(...params.dockets);
  if (params.docket) dockets.push(params.docket);
  for (const d of dockets) {
    const clean = String(d).trim();
    if (!clean) continue;
    // A full reactor docket (05000 + 3 digits) is an exact unit → equals.
    // A shorter prefix (e.g. 05000) is a fleet-wide sweep → starts.
    const operator = /^05000\d{3}$/.test(clean) ? 'equals' : 'starts';
    anyFilters.push({ field: 'DocketNumber', value: clean, operator });
  }

  return {
    q: query || '',
    filters,
    anyFilters,
    legacyLibFilter: params.legacy_library !== false,
    mainLibFilter: params.main_library !== false,
    sort: 'DocumentDate',
    sortDirection: params.sort_direction ?? 1,
    skip,
  };
}

async function postSearch(body, apiKey) {
  const resp = await fetch(ADAMS_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ADAMS search HTTP ${resp.status}${text ? ': ' + text.slice(0, 200) : ''}`);
  }
  return resp.json();
}

// adams_search — returns metadata only (no document content), newest-first.
// Honors the skill's tail-fetch rule: the API ignores sortDirection and always
// returns oldest-first, so to get the newest page of a multi-page set we fetch the
// tail (skip = count - pageSize) then sort client-side.
export async function runAdamsSearch(params, apiKey) {
  const pageSize = Math.min(Math.max(params.max_results ?? 100, 1), 500);
  const wantNewest = (params.sort_direction ?? 1) === 1;
  let skip = params.skip ?? 0;

  // First call to learn the total count.
  let data = await postSearch(buildSearchBody(params, skip), apiKey);
  const count = data.count ?? 0;

  // If the caller wants the newest records and didn't ask for a specific page,
  // re-fetch the tail page so we return the most recent `pageSize` documents.
  if (wantNewest && skip === 0 && count > pageSize) {
    skip = count - pageSize;
    data = await postSearch(buildSearchBody(params, skip), apiKey);
  }

  let rows = (data.results || []).map(r => r.document || r);
  rows = rows.map(d => ({
    accessionNumber: d.AccessionNumber,
    title: d.DocumentTitle,
    documentType: Array.isArray(d.DocumentType) ? d.DocumentType.join(', ') : d.DocumentType,
    documentDate: d.DocumentDate,
    url: mlToUrl(d.AccessionNumber, d.Url),
  }));

  // Client-side sort (API returns oldest-first regardless of sortDirection).
  rows.sort((a, b) =>
    wantNewest
      ? (b.documentDate || '').localeCompare(a.documentDate || '')
      : (a.documentDate || '').localeCompare(b.documentDate || '')
  );

  return {
    count,
    returned: rows.length,
    truncated: count > rows.length,
    note: count > rows.length
      ? `Showing ${rows.length} of ${count} results (sorted ${wantNewest ? 'newest' : 'oldest'} first). Page with skip, narrow the date range, or split the search to see the rest.`
      : undefined,
    documents: rows,
  };
}

// adams_get_document — full metadata + indexed plain-text content for one ML number.
export async function getAdamsDocument(params, apiKey) {
  const ml = String(params.accession_number || '').trim();
  if (!ml) throw new Error('accession_number is required.');

  const includeContent = params.include_content !== false;
  const maxChars = Math.min(Math.max(params.max_content_chars ?? 50000, 1000), 200000);

  const resp = await fetch(`${ADAMS_SEARCH_URL}/${encodeURIComponent(ml)}`, {
    method: 'GET',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Accept': 'application/json',
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ADAMS get-document HTTP ${resp.status}${text ? ': ' + text.slice(0, 200) : ''}`);
  }

  const data = await resp.json();
  const doc = data.document || data.result || data;

  const rawContent = doc.content ?? doc.Content ?? '';
  const content = includeContent ? String(rawContent).slice(0, maxChars) : '';
  const sparse = String(rawContent).trim().length < 200;

  return {
    accessionNumber: doc.AccessionNumber || ml,
    title: doc.DocumentTitle,
    documentType: Array.isArray(doc.DocumentType) ? doc.DocumentType.join(', ') : doc.DocumentType,
    documentDate: doc.DocumentDate,
    estimatedPageCount: doc.EstimatedPageCount,
    url: mlToUrl(doc.AccessionNumber || ml, doc.Url),
    contentChars: String(rawContent).length,
    contentTruncated: String(rawContent).length > content.length,
    scanned: sparse,
    scannedNote: sparse
      ? 'Indexed content is empty or sparse — likely a scanned-image-only or very recent document. OCR reliability is lower; consider the PDF at the url.'
      : undefined,
    content,
  };
}
