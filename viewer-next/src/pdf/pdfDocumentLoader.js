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

export const PDF_PASSWORD_REQUEST_REASONS = Object.freeze({
  INCORRECT_PASSWORD: "incorrect-password",
  NEED_PASSWORD: "need-password",
});

export class PdfPasswordCancelledError extends Error {
  constructor() {
    super("viewer-next-pdf-password-cancelled");
    this.name = "PdfPasswordCancelledError";
  }
}

export function isPdfPasswordCancelledError(reason) {
  return reason instanceof PdfPasswordCancelledError;
}

function normalizePasswordReason(reason) {
  if (reason === pdfjsLib.PasswordResponses?.INCORRECT_PASSWORD) {
    return PDF_PASSWORD_REQUEST_REASONS.INCORRECT_PASSWORD;
  }
  return PDF_PASSWORD_REQUEST_REASONS.NEED_PASSWORD;
}

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

export function loadPdfDocument(source, { onPasswordRequest } = {}) {
  const loadingTask = pdfjsLib.getDocument({
    ...normalizeDocumentSource(source),
    cMapPacked: true,
    cMapUrl,
    // Match the classic pdf.js viewer default so dynamic XFA PDFs render their
    // real form content instead of the embedded Adobe Reader fallback page.
    enableXfa: true,
    standardFontDataUrl,
    wasmUrl,
  });

  if (typeof onPasswordRequest === "function") {
    const passwordState = {
      cancelled: false,
    };
    loadingTask.viewerNextPasswordState = passwordState;
    loadingTask.onPassword = (updatePassword, reason) => {
      let settled = false;
      const passwordRequest = {
        cancel: () => {
          if (settled || passwordState.cancelled || loadingTask.destroyed) {
            return;
          }
          settled = true;
          passwordState.cancelled = true;
          loadingTask.destroy();
        },
        reason: normalizePasswordReason(reason),
        submit: password => {
          if (settled || passwordState.cancelled || loadingTask.destroyed) {
            return;
          }
          settled = true;
          updatePassword(password || "");
        },
      };
      onPasswordRequest(passwordRequest);
    };
  }

  return loadingTask;
}
