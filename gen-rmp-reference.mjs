// Bundles every Markdown file in rmp-reference/ into lib/rmp-reference.js, verbatim.
// These are the RMP procedure (QPM-003) and template (QF-034) reference files for
// Risk Management Plan mode — kept as a separate bundle from references/ (ADAMS/Hatch)
// so each mode's system prompt only carries the content relevant to it. To add worked
// example RMPs later, drop the .md/.docx-derived .md in rmp-reference/ and re-run:
//   node gen-rmp-reference.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';

const SRC_DIR = 'rmp-reference';
const OUT = 'lib/rmp-reference.js';

const files = readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.md')).sort();
const refs = files.map(filename => ({
  filename,
  text: readFileSync(`${SRC_DIR}/${filename}`, 'utf8').trim(),
}));

mkdirSync('lib', { recursive: true });

const out =
  `// AUTO-GENERATED from the project's rmp-reference/ folder. DO NOT EDIT BY HAND.\n` +
  `// Regenerate with: node gen-rmp-reference.mjs\n` +
  `// The QPM-003 procedure digest and QF-034 template structure for RMP mode.\n` +
  `export const RMP_REFERENCES = ${JSON.stringify(refs, null, 2)};\n`;

writeFileSync(OUT, out);
console.log(`Wrote ${OUT} with ${refs.length} reference file(s):`);
refs.forEach(r => console.log(`  - ${r.filename} (${r.text.length} chars)`));
