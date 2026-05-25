import { getUuid, SignatureExtractor } from "@rewirepdf/pdfjs";

const KEY_STORAGE = "pdfjs.signature";
const DEFAULT_HEIGHT_IN_PAGE = 40;

function readSavedSignatures() {
  const raw = localStorage.getItem(KEY_STORAGE);
  if (!raw) {
    return new Map();
  }
  try {
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

function writeSavedSignatures(signatures) {
  localStorage.setItem(
    KEY_STORAGE,
    JSON.stringify(Object.fromEntries(signatures))
  );
  window.dispatchEvent(new CustomEvent("viewer-next-saved-signatures-changed"));
}

export class ViewerNextSignatureStorage {
  #eventBus;

  #signal;

  #signatures = null;

  constructor(eventBus, signal) {
    this.#eventBus = eventBus;
    this.#signal = signal;
  }

  async getAll() {
    if (this.#signal) {
      window.addEventListener(
        "storage",
        ({ key }) => {
          if (key === KEY_STORAGE) {
            this.#signatures = null;
            window.dispatchEvent(
              new CustomEvent("viewer-next-saved-signatures-changed")
            );
            this.#eventBus?.dispatch("storedsignatureschanged", {
              source: this,
            });
          }
        },
        { signal: this.#signal }
      );
      this.#signal = null;
    }
    this.#signatures ||= readSavedSignatures();
    return this.#signatures;
  }

  async isFull() {
    return false;
  }

  async size() {
    return (await this.getAll()).size;
  }

  async create(data) {
    if (await this.isFull()) {
      return null;
    }
    const uuid = getUuid();
    const signatures = await this.getAll();
    signatures.set(uuid, data);
    writeSavedSignatures(signatures);
    return uuid;
  }

  async delete(uuid) {
    const signatures = await this.getAll();
    if (!signatures.delete(uuid)) {
      return false;
    }
    writeSavedSignatures(signatures);
    return true;
  }
}

async function decompressSavedSignature(entry) {
  const data = await SignatureExtractor.decompressSignature(entry.signatureData);
  if (!data) {
    return null;
  }
  return {
    areContours: data.areContours,
    curves: data.outlines.map(points => ({ points })),
    height: data.height,
    thickness: data.thickness,
    width: data.width,
  };
}

function createPreview(signatureData) {
  const { areContours, curves, height, thickness, width } = signatureData;
  const maxDim = Math.max(width, height);
  const outlineData = SignatureExtractor.processDrawnLines({
    lines: {
      curves,
      thickness,
      width,
      height,
    },
    pageWidth: maxDim,
    pageHeight: maxDim,
    rotation: 0,
    innerMargin: 0,
    mustSmooth: false,
    areContours,
  });
  if (!outlineData) {
    return null;
  }
  return {
    path: outlineData.outline.toSVGPath(),
    viewBox: outlineData.outline.viewBox,
  };
}

export async function listSavedSignatures(signatureStorage) {
  const signatures = await signatureStorage.getAll();
  const items = [];
  for (const [uuid, entry] of signatures) {
    const signatureData = await decompressSavedSignature(entry);
    if (!signatureData) {
      continue;
    }
    const preview = createPreview(signatureData);
    if (!preview) {
      continue;
    }
    items.push({
      areContours: signatureData.areContours,
      description: entry.description || "",
      path: preview.path,
      uuid,
      viewBox: preview.viewBox,
    });
  }
  return items;
}

export async function getSavedSignatureCreateData(signatureStorage, uuid) {
  const entry = (await signatureStorage.getAll()).get(uuid);
  if (!entry) {
    return null;
  }
  const signatureData = await decompressSavedSignature(entry);
  if (!signatureData) {
    return null;
  }
  const { areContours, curves, height, thickness, width } = signatureData;
  return {
    lines: {
      curves,
      thickness,
      width,
      height,
    },
    mustSmooth: false,
    areContours,
    description: entry.description || "",
    uuid,
    heightInPage: DEFAULT_HEIGHT_IN_PAGE,
  };
}
