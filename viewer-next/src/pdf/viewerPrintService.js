import {
  AnnotationMode,
  PixelsPerInch,
  RenderingCancelledException,
} from "@rewirepdf/pdfjs";

const PRINT_CONTAINER_CLASS = "viewer-next-print-container";
const PRINT_STYLE_ID = "viewer-next-print-style";

function ensurePrintStyle({ height, width }) {
  let style = document.getElementById(PRINT_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = PRINT_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = `
@page { size: ${width}pt ${height}pt; }
.${PRINT_CONTAINER_CLASS} { display: none; }
@media print {
  body > :not(.${PRINT_CONTAINER_CLASS}) { display: none !important; }
  .${PRINT_CONTAINER_CLASS} { display: block; }
  .${PRINT_CONTAINER_CLASS} .printedPage {
    break-after: page;
    page-break-after: always;
  }
  .${PRINT_CONTAINER_CLASS} .printedPage:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .${PRINT_CONTAINER_CLASS} img {
    display: block;
    height: 100%;
    width: 100%;
  }
}`;
}

function getPrintContainer() {
  let container = document.querySelector(`.${PRINT_CONTAINER_CLASS}`);
  if (!container) {
    container = document.createElement("div");
    container.className = PRINT_CONTAINER_CLASS;
    document.body.append(container);
  }
  container.textContent = "";
  return container;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("viewer-next-print-canvas-blob-missing"));
      }
    });
  });
}

async function renderPrintPage({
  optionalContentConfigPromise,
  pageNumber,
  pdfDocument,
  printAnnotationStorage,
  printResolution,
  size,
}) {
  const pdfPage = await pdfDocument.getPage(pageNumber);
  const printUnits = printResolution / PixelsPerInch.PDF;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(size.width * printUnits);
  canvas.height = Math.floor(size.height * printUnits);
  const context = canvas.getContext("2d", { alpha: false });
  context.save();
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();

  try {
    await pdfPage.render({
      annotationMode: AnnotationMode.ENABLE_STORAGE,
      canvas,
      intent: "print",
      optionalContentConfigPromise,
      printAnnotationStorage,
      transform: [printUnits, 0, 0, printUnits, 0, 0],
      viewport: pdfPage.getViewport({ scale: 1, rotation: size.rotation }),
    }).promise;
    const blob = await canvasToBlob(canvas);
    return URL.createObjectURL(blob);
  } catch (reason) {
    if (!(reason instanceof RenderingCancelledException)) {
      console.error("ViewerNextPrintService.renderPrintPage:", reason);
    }
    throw reason;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function printPdfDocument({
  pdfDocument,
  pdfViewer,
  printResolution = 150,
}) {
  if (!pdfDocument || !pdfViewer?.pageViewsReady) {
    throw new Error("viewer-next-print-not-ready");
  }

  const pagesOverview = pdfViewer.getPagesOverview();
  if (!pagesOverview.length) {
    throw new Error("viewer-next-print-pages-missing");
  }

  ensurePrintStyle(pagesOverview[0]);
  const container = getPrintContainer();
  const objectUrls = [];
  const optionalContentConfigPromise = pdfDocument.getOptionalContentConfig({
    intent: "print",
  });
  const printAnnotationStorage = await pdfDocument.annotationStorage.print;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    container.textContent = "";
    for (const objectUrl of objectUrls) {
      URL.revokeObjectURL(objectUrl);
    }
  };

  try {
    for (let index = 0; index < pagesOverview.length; index++) {
      const objectUrl = await renderPrintPage({
        optionalContentConfigPromise,
        pageNumber: index + 1,
        pdfDocument,
        printAnnotationStorage,
        printResolution,
        size: pagesOverview[index],
      });
      objectUrls.push(objectUrl);
      const page = document.createElement("div");
      page.className = "printedPage";
      const image = document.createElement("img");
      image.alt = "";
      image.src = objectUrl;
      page.append(image);
      container.append(page);
      await image.decode().catch(() => {});
    }
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    setTimeout(cleanup, 30000);
  } finally {
    if (objectUrls.length === 0) {
      cleanup();
    }
  }
}
