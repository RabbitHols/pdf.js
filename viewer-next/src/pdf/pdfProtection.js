import { createQpdfRunner } from "qpdf-run";
import qpdfJsUrl from "qpdf-run/qpdf.js?url";
import qpdfWasmUrl from "qpdf-run/qpdf.wasm?url";
import qpdfWorkerUrl from "qpdf-run/worker?url";

const INPUT_NAME = "input.pdf";
const OUTPUT_NAME = "protected.pdf";
const OWNER_PASSWORD_BYTES = 24;
const defaultPermissions = {
  accessibility: true,
  annotations: true,
  assemble: true,
  copy: true,
  forms: true,
  modify: true,
  print: true,
};

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

function normalizePermissions(permissions = {}) {
  return {
    ...defaultPermissions,
    ...permissions,
  };
}

function allowFlag(value) {
  return value ? "y" : "n";
}

function createOwnerPassword() {
  const bytes = new Uint8Array(OWNER_PASSWORD_BYTES);
  globalThis.crypto?.getRandomValues?.(bytes);
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0) {
      bytes[index] = Math.floor(Math.random() * 255) + 1;
    }
  }
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function buildPermissionArgs(permissions) {
  const normalized = normalizePermissions(permissions);
  return [
    `--print=${normalized.print ? "full" : "none"}`,
    `--modify-other=${allowFlag(normalized.modify)}`,
    `--extract=${allowFlag(normalized.copy)}`,
    `--annotate=${allowFlag(normalized.annotations)}`,
    `--form=${allowFlag(normalized.forms)}`,
    "--accessibility=y",
    `--assemble=${allowFlag(normalized.assemble)}`,
  ];
}

function hasRestrictedPermissions(permissions) {
  const normalized = normalizePermissions(permissions);
  return Object.entries(normalized).some(
    ([key, allowed]) => key !== "accessibility" && allowed === false
  );
}

export async function protectPdfWithPassword(
  bytes,
  {
    currentPassword = "",
    permissions,
    requireOpenPassword = true,
    userPassword,
  } = {}
) {
  const input = normalizeBytes(bytes);
  if (!input) {
    throw new Error("viewer-next-protect-invalid-input");
  }
  if (requireOpenPassword && !userPassword) {
    throw new Error("viewer-next-protect-empty-password");
  }
  const shouldEncrypt = requireOpenPassword || hasRestrictedPermissions(permissions);
  const ownerPassword = createOwnerPassword();
  const openPassword = requireOpenPassword ? userPassword : "";

  const qpdf = await createQpdfRunner({
    qpdfJsUrl,
    timeoutMs: 30000,
    wasmUrl: qpdfWasmUrl,
    workerUrl: qpdfWorkerUrl,
  });
  try {
    if (!shouldEncrypt) {
      return await qpdf.runOne({
        input,
        inputName: INPUT_NAME,
        outputName: OUTPUT_NAME,
        args: [
          ...(currentPassword ? [`--password=${currentPassword}`] : []),
          "--decrypt",
          INPUT_NAME,
          OUTPUT_NAME,
        ],
      });
    }
    return await qpdf.runOne({
      input,
      inputName: INPUT_NAME,
      outputName: OUTPUT_NAME,
      args: [
        ...(currentPassword ? [`--password=${currentPassword}`] : []),
        "--encrypt",
        openPassword,
        ownerPassword,
        "256",
        ...buildPermissionArgs(permissions),
        "--",
        INPUT_NAME,
        OUTPUT_NAME,
      ],
    });
  } finally {
    await qpdf.destroy();
  }
}
