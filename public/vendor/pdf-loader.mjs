// pdfjs-dist ships ESM-only. This tiny module loads it and exposes it as
// window.pdfjsLib so the rest of the app (plain classic scripts) can use it.
// Module scripts execute after the document is parsed but before any user
// interaction, so window.pdfjsLib is always ready by the time a real upload happens.
import * as pdfjsLib from './pdf.min.mjs';
// Resolve relative to this module's own URL (not the page's), so it's correct
// regardless of how pdf.js internally treats a plain relative workerSrc string.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;
window.pdfjsLib = pdfjsLib;
