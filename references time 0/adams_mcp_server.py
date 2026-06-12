#!/usr/bin/env python3
"""
ADAMS MCP Server  (rev 1)
-------------------------
A zero-dependency, local stdio MCP server that exposes the NRC ADAMS Public
Search (APS) API to Claude as two tools:

  - adams_search        : Boolean / filtered metadata search of the ADAMS library
  - adams_get_document  : Fetch one document's metadata + indexed text by ML number

Uses only the Python standard library (no pip installs).
Reads the API subscription key from the ADAMS_API_KEY environment variable,
which is set in the claude_desktop_config.json "env" block.

Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0.
"""

import json
import os
import sys
import urllib.request
import urllib.error

SERVER_NAME = "adams"
SERVER_VERSION = "0.1.0"
PROTOCOL_VERSION = "2024-11-05"

API_BASE = "https://adams-api.nrc.gov/aps/api/search"
API_KEY = os.environ.get("ADAMS_API_KEY", "").strip()

# Fields we surface from each result document (keeps payloads lean).
SUMMARY_FIELDS = [
    "AccessionNumber", "DocumentTitle", "DocumentType",
    "DocumentDate", "DateAdded", "DocketNumber", "Url",
]


def log(*a):
    """Debug to stderr only — stdout is reserved for JSON-RPC."""
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- HTTP helpers
def _http(method, url, body=None, timeout=60):
    if not API_KEY:
        raise RuntimeError(
            "ADAMS_API_KEY is not set. Add it to the server's env block in "
            "claude_desktop_config.json."
        )
    headers = {
        "Ocp-Apim-Subscription-Key": API_KEY,
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500] if e.fp else ""
        raise RuntimeError(f"NRC API HTTP {e.code}: {e.reason}. {detail}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Could not reach NRC API: {e.reason}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"NRC API returned non-JSON response: {raw[:300]}")


# ---------------------------------------------------------------- tool: search
def tool_adams_search(args):
    q = (args.get("query") or "").strip()
    filters = []

    docket = (args.get("docket") or "").strip()
    if docket:
        filters.append({"field": "DocketNumber", "value": docket, "operator": "starts"})

    dtype = (args.get("document_type") or "").strip()
    if dtype:
        filters.append({"field": "DocumentType", "value": dtype, "operator": "starts"})

    # A date RANGE must be ONE filter entry combining both bounds with 'and'. Two separate
    # ge/le entries are silently ignored by the APS API (verified against the live API 2026-06).
    date_from = (args.get("date_from") or "").strip()
    date_to = (args.get("date_to") or "").strip()
    if date_from and date_to:
        filters.append({"field": "DocumentDate",
                        "value": f"(DocumentDate ge '{date_from}' and DocumentDate le '{date_to}')"})
    elif date_from:
        filters.append({"field": "DocumentDate", "value": f"(DocumentDate ge '{date_from}')"})
    elif date_to:
        filters.append({"field": "DocumentDate", "value": f"(DocumentDate le '{date_to}')"})

    body = {
        "q": q,
        "filters": filters,
        "anyFilters": [],
        "mainLibFilter": bool(args.get("main_library", True)),
        "legacyLibFilter": bool(args.get("legacy_library", True)),
        "sort": args.get("sort", "DocumentDate"),
        "sortDirection": int(args.get("sort_direction", 1)),
        "skip": int(args.get("skip", 0)),
    }

    limit = int(args.get("max_results", 100))
    skip = int(args.get("skip", 0))
    descending = int(args.get("sort_direction", 1)) == 1

    result = _http("POST", API_BASE, body=body)
    total = result.get("count") or 0
    raw_results = result.get("results") or []

    # The APS API returns results OLDEST-first and IGNORES sortDirection (verified 2026-06).
    # So the first page is the oldest records. For a descending (newest-first) request that
    # spans more than one page, re-fetch the tail page so the newest records come back, then
    # sort client-side. (One page is 100 results; paging is via skip.)
    if descending and skip == 0 and total > len(raw_results):
        tail_skip = max(0, total - limit)
        if tail_skip > 0:
            body["skip"] = tail_skip
            result = _http("POST", API_BASE, body=body)
            raw_results = result.get("results") or []

    # Sort client-side by DocumentDate (the API won't), newest-first when descending.
    raw_results.sort(
        key=lambda it: (it.get("document", {}) or {}).get("DocumentDate") or "",
        reverse=descending,
    )

    trimmed = []
    for item in raw_results[:limit]:
        doc = item.get("document", {})
        trimmed.append({k: doc.get(k) for k in SUMMARY_FIELDS})

    out = {
        "total_count": total,
        "returned": len(trimmed),
        "skip": body["skip"],
        "note": (
            "ADAMS keyword search matches document text AND metadata; review hits "
            "for relevance. Use 'skip' to page through large result sets."
        ),
        "results": trimmed,
    }
    return json.dumps(out, indent=2, ensure_ascii=False)


# ----------------------------------------------------------- tool: get document
def tool_adams_get_document(args):
    acc = (args.get("accession_number") or "").strip()
    if not acc:
        raise RuntimeError("accession_number is required (e.g. ML24017A120).")

    result = _http("GET", f"{API_BASE}/{acc}")
    doc = result.get("document", result)

    include_content = bool(args.get("include_content", True))
    max_chars = int(args.get("max_content_chars", 50000))

    content = doc.get("content") or ""
    truncated = False
    if not include_content:
        content = "(omitted; include_content=false)"
    elif len(content) > max_chars:
        content = content[:max_chars]
        truncated = True

    meta = {k: doc.get(k) for k in [
        "AccessionNumber", "DocumentTitle", "DocumentType", "DocumentDate",
        "DateAdded", "AuthorName", "AuthorAffiliation", "AddresseeName",
        "AddresseeAffiliation", "DocketNumber", "LicenseNumber",
        "EstimatedPageCount", "Url",
    ]}
    out = {
        "metadata": meta,
        "content_truncated": truncated,
        "content": content,
    }
    return json.dumps(out, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------- tool registry
TOOLS = [
    {
        "name": "adams_search",
        "description": (
            "Search the NRC ADAMS public document library (metadata + full text). "
            "Combine a docket number (e.g. Hatch Unit 1 = 05000321) with optional "
            "keywords, document type, and a Document Date range. Returns document "
            "metadata (ML number, title, type, dates, URL). Use 'skip' to page."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Free-text keywords (ANDed; quote phrases). Optional."},
                "docket": {"type": "string", "description": "Docket number, e.g. 05000321 (Hatch 1) or 05000366 (Hatch 2). Matched with 'starts'."},
                "document_type": {"type": "string", "description": "ADAMS document type, e.g. 'Inspection Report'. Matched with 'starts'."},
                "date_from": {"type": "string", "description": "Earliest Document Date, YYYY-MM-DD."},
                "date_to": {"type": "string", "description": "Latest Document Date, YYYY-MM-DD."},
                "main_library": {"type": "boolean", "description": "Search Main Public Library (post-1999). Default true."},
                "legacy_library": {"type": "boolean", "description": "Search Legacy Public Library (pre-1999). Default true."},
                "sort_direction": {"type": "integer", "description": "0 = ascending, 1 = descending (default) by Document Date."},
                "skip": {"type": "integer", "description": "Number of results to skip (paging). Default 0."},
                "max_results": {"type": "integer", "description": "Max results to return in this call. Default 100."},
            },
            "required": [],
        },
    },
    {
        "name": "adams_get_document",
        "description": (
            "Retrieve a single ADAMS document by accession (ML) number, including "
            "full metadata and the indexed plain-text content of the document."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "accession_number": {"type": "string", "description": "The ML number, e.g. ML24017A120."},
                "include_content": {"type": "boolean", "description": "Include document text. Default true."},
                "max_content_chars": {"type": "integer", "description": "Truncate content to this many characters. Default 50000."},
            },
            "required": ["accession_number"],
        },
    },
]

TOOL_FUNCS = {
    "adams_search": tool_adams_search,
    "adams_get_document": tool_adams_get_document,
}


# ---------------------------------------------------------------- JSON-RPC core
def make_result(req_id, result):
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def make_error(req_id, code, message):
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def handle(msg):
    """Return a response dict, or None for notifications."""
    method = msg.get("method")
    req_id = msg.get("id")

    if method == "initialize":
        return make_result(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        })

    if method in ("notifications/initialized", "initialized"):
        return None  # notification, no reply

    if method == "ping":
        return make_result(req_id, {})

    if method == "tools/list":
        return make_result(req_id, {"tools": TOOLS})

    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        fn = TOOL_FUNCS.get(name)
        if fn is None:
            return make_error(req_id, -32602, f"Unknown tool: {name}")
        try:
            text = fn(args)
            return make_result(req_id, {"content": [{"type": "text", "text": text}]})
        except Exception as e:  # surface as a tool error, not a transport error
            return make_result(req_id, {
                "content": [{"type": "text", "text": f"ERROR: {e}"}],
                "isError": True,
            })

    if req_id is not None:
        return make_error(req_id, -32601, f"Method not found: {method}")
    return None


def main():
    log(f"[{SERVER_NAME}] MCP server starting; key {'present' if API_KEY else 'MISSING'}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            resp = handle(msg)
        except Exception as e:
            resp = make_error(msg.get("id"), -32603, f"Internal error: {e}")
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
