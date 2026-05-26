import { createQpdfRunner } from "qpdf-run";
import qpdfJsUrl from "qpdf-run/qpdf.js?url";
import qpdfWasmUrl from "qpdf-run/qpdf.wasm?url";
import qpdfWorkerUrl from "qpdf-run/worker?url";

const INPUT_NAME = "input.pdf";
const OUTPUT_NAME = "protected.pdf";

function normalizeBytes(bytes) {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return null;
}

export async function protectPdfWithPassword(bytes, { userPassword } = {}) {
  const input = normalizeBytes(bytes);
  if (!input) {
    throw new Error("viewer-next-protect-invalid-input");
  }
  if (!userPassword) {
    throw new Error("viewer-next-protect-empty-password");
  }

  const qpdf = await createQpdfRunner({
    qpdfJsUrl,
    timeoutMs: 30000,
    wasmUrl: qpdfWasmUrl,
    workerUrl: qpdfWorkerUrl,
  });
  try {
    return await qpdf.runOne({
      input,
      inputName: INPUT_NAME,
      outputName: OUTPUT_NAME,
      args: [
        "--encrypt",
        userPassword,
        userPassword,
        "256",
        "--",
        INPUT_NAME,
        OUTPUT_NAME,
      ],
    });
  } finally {
    await qpdf.destroy();
  }
}
