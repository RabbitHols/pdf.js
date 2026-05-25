import * as pdfjsLib from "@rewirepdf/pdfjs";
import pdfWorkerUrl from "viewer-next-pdf-worker";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function getPdfjsAssetUrl(path) {
  return new URL(`./pdfjs/${path}/`, window.location.href).href;
}

const cMapUrl = getPdfjsAssetUrl("cmaps");
const standardFontDataUrl = getPdfjsAssetUrl("standard_fonts");
const wasmUrl = getPdfjsAssetUrl("wasm");

export { pdfjsLib };

function normalizeDocumentSource(source) {
  if (source instanceof Uint8Array) {
    return {
      data: source.slice(),
    };
  }
  if (source instanceof ArrayBuffer) {
    return {
      data: source.slice(0),
    };
  }
  if (source?.data instanceof Uint8Array) {
    return {
      ...source,
      data: source.data.slice(),
    };
  }
  if (source?.data instanceof ArrayBuffer) {
    return {
      ...source,
      data: source.data.slice(0),
    };
  }
  return source;
}

export function loadPdfDocument(source) {
  return pdfjsLib.getDocument({
    ...normalizeDocumentSource(source),
    cMapPacked: true,
    cMapUrl,
    // Match the classic pdf.js viewer default so dynamic XFA PDFs render their
    // real form content instead of the embedded Adobe Reader fallback page.
    enableXfa: true,
    standardFontDataUrl,
    wasmUrl,
  });
}
