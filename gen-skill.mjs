// Bundles the in-repo skill Markdown into lib/skill.js, verbatim.
// The adams-search-api skill is the model's system prompt and the deployed source of
// truth. Its editable source lives IN THIS REPO at skill/adams-search-api.md — it is
// NOT synced from the Cowork skill, so the team app owns its own copy and can diverge.
// Edit that .md, then re-run:  node gen-skill.mjs  (or just `npm run dev`, via predev).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = 'skill/adams-search-api.md';
const OUT = 'lib/skill.js';

// Normalize CRLF→LF so the bundled string is identical regardless of how git's
// autocrlf stored the .md on disk.
const body = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').trim();

mkdirSync('lib', { recursive: true });

const out =
  `// AUTO-GENERATED from ${SRC}. DO NOT EDIT BY HAND.\n` +
  `// Edit the Markdown source, then regenerate with: node gen-skill.mjs (or npm run dev).\n` +
  `// This is the model's system prompt and the deployed source of truth; the editable\n` +
  `// source lives in this repo (no Cowork sync).\n` +
  `export const SKILL_TEXT = ${JSON.stringify(body)};\n`;

writeFileSync(OUT, out);
console.log(`Wrote ${OUT} (${body.length} chars) from ${SRC}`);
