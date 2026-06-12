// Bundles every Markdown file in references/ into lib/references.js, verbatim.
// These are the "project reference files" the adams-search-api skill expects to
// open at runtime (in Cowork it reads them off disk; here we hand them to the model
// as cached context). To add another plant's guide, drop its .md in references/ and
// re-run:  node gen-references.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';

const SRC_DIR = 'references';
const OUT = 'lib/references.js';

const files = readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.md')).sort();
const refs = files.map(filename => ({
  filename,
  text: readFileSync(`${SRC_DIR}/${filename}`, 'utf8').trim(),
}));

mkdirSync('lib', { recursive: true });

const out =
  `// AUTO-GENERATED from the project's references/ folder. DO NOT EDIT BY HAND.\n` +
  `// Regenerate with: node gen-references.mjs\n` +
  `// These are the plant reference files the skill expects to consult at runtime.\n` +
  `export const REFERENCES = ${JSON.stringify(refs, null, 2)};\n`;

writeFileSync(OUT, out);
console.log(`Wrote ${OUT} with ${refs.length} reference file(s):`);
refs.forEach(r => console.log(`  - ${r.filename} (${r.text.length} chars)`));
