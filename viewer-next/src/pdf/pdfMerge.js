import { loadPdfDocument } from "./pdfDocumentLoader.js";

function cloneBytes(bytes) {
  if (bytes instanceof Uint8Array) {
    return bytes.slice();
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes.slice(0));
  }
  return new Uint8Array(bytes || []);
}

function canvasToDataUrl(canvas) {
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export async function getPdfPageCount(bytes) {
  const loadingTask = loadPdfDocument({ data: cloneBytes(bytes) });
  try {
    const pdfDocument = await loadingTask.promise;
    return pdfDocument.numPages || 0;
  } finally {
    await loadingTask.destroy();
  }
}

export async function renderPdfPageThumbnail(bytes, pageNumber, width = 120) {
  const loadingTask = loadPdfDocument({ data: cloneBytes(bytes) });
  try {
    const pdfDocument = await loadingTask.promise;
    const safePageNumber = Math.min(
      Math.max(1, Number(pageNumber) || 1),
      pdfDocument.numPages || 1
    );
    const page = await pdfDocument.getPage(safePageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = width / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvasToDataUrl(canvas);
  } finally {
    await loadingTask.destroy();
  }
}

export async function renderPdfPageThumbnails(bytes, pageNumbers, width = 120) {
  const loadingTask = loadPdfDocument({ data: cloneBytes(bytes) });
  try {
    const pdfDocument = await loadingTask.promise;
    const thumbnails = {};
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > pdfDocument.numPages) {
        continue;
      }
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = width / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      thumbnails[pageNumber] = canvasToDataUrl(canvas);
    }
    return thumbnails;
  } finally {
    await loadingTask.destroy();
  }
}

export async function mergePdfDocuments(items) {
  const contributors = items
    .map(item => {
      const pages = item.pages
        .filter(page => !page.removed)
        .map(page => page.pageNumber - 1);
      return {
        bytes: cloneBytes(item.bytes),
        includePages: pages,
      };
    })
    .filter(item => item.includePages.length > 0);

  if (contributors.length === 0) {
    throw new Error("merge-pdf-no-pages");
  }

  const [baseContributor, ...extraContributors] = contributors;
  const loadingTask = loadPdfDocument({ data: cloneBytes(baseContributor.bytes) });
  try {
    const pdfDocument = await loadingTask.promise;
    const pageInfos = [
      {
        document: null,
        includePages: baseContributor.includePages,
      },
      ...extraContributors.map(contributor => ({
        document: cloneBytes(contributor.bytes),
        includePages: contributor.includePages,
      })),
    ];
    return await pdfDocument.extractPages(pageInfos);
  } finally {
    await loadingTask.destroy();
  }
}
