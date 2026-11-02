// The PDF worker runs in its own global scope, so it needs the polyfill too, before pdf.js's worker code runs.
// Imports are evaluated in order: the polyfill first, then pdf.js, which starts listening for the page.
import './polyfills';
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
