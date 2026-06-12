// Generates lib/skill.js from the adams-search-api SKILL.md, verbatim.
//
// Usage:
//   node gen-skill.mjs                      → auto-discover the newest installed skill
//   node gen-skill.mjs <SKILL.md> [out.js]  → use an explicit source path
//
// Auto-discovery looks under %APPDATA%\Claude\…\skills-plugin for the most recently
// modified adams-search-api/SKILL.md, so it keeps working even when the skill plugin's
// session-GUID folders change. Run this whenever the skill is updated so the web app
// stays in sync with the source of truth.
//
// IMPORTANT: this is a LOCAL dev tool only. The source SKILL.md lives in your Claude
// app data and does NOT exist on Cloudflare's build servers — so the GENERATED
// lib/skill.js is the committed artifact that actually deploys. Edit skill → run this
// (or just `npm run dev`, which runs it for you) → commit lib/skill.js → push.
//
// Designed to NEVER break `npm run dev`: if the source can't be found or anything goes
// wrong, it warns and leaves the existing committed lib/skill.js untouched (exit 0).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT_DEFAULT = 'lib/skill.js';
const SKILL_TAIL = 'skills/adams-search-api/SKILL.md'; // forward-slash normalized

// Find every installed adams-search-api/SKILL.md, newest first.
function discoverSources() {
  const appData = process.env.APPDATA; // e.g. C:\Users\<you>\AppData\Roaming
  if (!appData) return [];
  const base = join(appData, 'Claude', 'local-agent-mode-sessions', 'skills-plugin');
  let entries;
  try {
    entries = readdirSync(base, { recursive: true });
  } catch {
    return []; // skills-plugin folder isn't here (e.g. a different machine / the cloud)
  }
  const matches = [];
  for (const e of entries) {
    const norm = String(e).replace(/\\/g, '/');
    if (norm.endsWith(SKILL_TAIL)) {
      const full = join(base, String(e));
      try {
        matches.push({ path: full, mtime: statSync(full).mtimeMs });
      } catch { /* ignore unreadable entry */ }
    }
  }
  return matches.sort((a, b) => b.mtime - a.mtime); // newest first
}

function bail(msg) {
  // Warn but do not fail — the committed lib/skill.js remains valid.
  console.warn(`[sync-skill] ${msg}`);
  console.warn(`[sync-skill] Leaving existing ${OUT_DEFAULT} unchanged.`);
  process.exit(0);
}

try {
  const explicit = process.argv[2];
  const outPath = process.argv[3] || OUT_DEFAULT;

  let srcPath;
  if (explicit) {
    if (!existsSync(explicit)) bail(`Source not found at explicit path: ${explicit}`);
    srcPath = explicit;
  } else {
    const found = discoverSources();
    if (found.length === 0) {
      bail('Could not locate adams-search-api SKILL.md under %APPDATA%\\Claude\\…\\skills-plugin.');
    }
    srcPath = found[0].path;
    if (found.length > 1) {
      console.log(`[sync-skill] Found ${found.length} installed copies; using the most recently edited.`);
    }
  }

  const src = readFileSync(srcPath, 'utf8');
  // Strip the YAML frontmatter (everything from the first --- to the second ---).
  const body = src.replace(/^---[\s\S]*?\n---\s*/, '').trim();
  if (!body) bail(`Source read but empty after stripping frontmatter: ${srcPath}`);

  const out =
    `// AUTO-GENERATED from the adams-search-api skill's SKILL.md. DO NOT EDIT BY HAND.\n` +
    `// Regenerate with: npm run sync-skill   (or just \`npm run dev\`, which runs it).\n` +
    `// This is the real skill text used as the model's system prompt — the source of truth.\n` +
    `export const SKILL_TEXT = ${JSON.stringify(body)};\n`;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);

  const rev = (body.match(/^#\s*(.+)$/m) || [, 'unknown heading'])[1];
  console.log(`[sync-skill] Wrote ${outPath} (${body.length} chars) — "${rev}"`);
  console.log(`[sync-skill]   from ${srcPath}`);
} catch (err) {
  bail(`Unexpected error: ${err.message}`);
}
