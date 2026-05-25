const THUMBNAIL_WIDTH = 126;

async function renderPageThumbnail({
  optionalContentConfigPromise,
  pageNumber,
  pdfDocument,
}) {
  const pdfPage = await pdfDocument.getPage(pageNumber);
  const baseViewport = pdfPage.getViewport({ scale: 1 });
  const scale = THUMBNAIL_WIDTH / baseViewport.width;
  const viewport = pdfPage.getViewport({ scale });
  const outputScale = globalThis.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width * outputScale);
  canvas.height = Math.ceil(viewport.height * outputScale);
  canvas.style.width = `${Math.ceil(viewport.width)}px`;
  canvas.style.height = `${Math.ceil(viewport.height)}px`;

  const canvasContext = canvas.getContext("2d", { alpha: false });
  canvasContext.save();
  canvasContext.fillStyle = "rgb(255, 255, 255)";
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  canvasContext.restore();

  const renderTask = pdfPage.render({
    canvasContext,
    optionalContentConfigPromise,
    transform:
      outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
    viewport,
  });
  await renderTask.promise;
  return canvas.toDataURL("image/png");
}

export function createPageThumbnailService({ pdfDocument }) {
  const previews = new Map();
  let cancelled = false;
  let renderStarted = false;
  let optionalContentConfigPromise = null;
  let onUpdate = null;

  async function renderNext(pageNumber = 1) {
    if (cancelled || pageNumber > pdfDocument.numPages) {
      return;
    }
    optionalContentConfigPromise ||= pdfDocument.getOptionalContentConfig({
      intent: "display",
    });
    try {
      const src = await renderPageThumbnail({
        optionalContentConfigPromise,
        pageNumber,
        pdfDocument,
      });
      if (cancelled) {
        return;
      }
      previews.set(pageNumber, src);
      onUpdate?.(Object.fromEntries(previews));
    } catch (error) {
      if (!cancelled) {
        console.warn("Viewer Next thumbnail render failed", error);
      }
    }
    window.setTimeout(() => renderNext(pageNumber + 1), 0);
  }

  return {
    getPreviews() {
      return Object.fromEntries(previews);
    },
    setOnUpdate(callback) {
      onUpdate = callback;
    },
    start() {
      if (renderStarted || cancelled) {
        return;
      }
      renderStarted = true;
      renderNext();
    },
    destroy() {
      cancelled = true;
      onUpdate = null;
      previews.clear();
    },
  };
}
