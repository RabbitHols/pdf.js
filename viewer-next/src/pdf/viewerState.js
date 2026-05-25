export function readPdfViewerState({
  activeTool,
  capabilities,
  findState,
  freeTextStyle,
  highlightColor,
  nativeEditingState,
  pdfDocument,
  pdfViewer,
  viewer,
}) {
  const scale = pdfViewer.currentScale || 0;
  const pagesCount = pdfDocument?.numPages || pdfViewer.pagesCount || 0;
  const page = viewer.querySelector(
    `.page[data-page-number="${pdfViewer.currentPageNumber || 1}"]`
  ) || viewer.querySelector(".page");
  const pageRect = page?.getBoundingClientRect();
  const pageSizes = Array.from({ length: pagesCount }, (_, index) => {
    const rawDims = pdfViewer.getPageView(index)?.viewport?.rawDims;
    const width = Number(rawDims?.pageWidth);
    const height = Number(rawDims?.pageHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    return { height, width };
  });
  const currentPageSize =
    pageSizes[(pdfViewer.currentPageNumber || 1) - 1] || null;

  return {
    activeTool,
    annotationEditorMode: pdfViewer.annotationEditorMode,
    capabilities: capabilities || null,
    find: findState || null,
    freeTextFonts: capabilities?.freeTextFonts || null,
    freeTextStyle: freeTextStyle || null,
    highlightColor: highlightColor || null,
    nativeEditing: nativeEditingState || null,
    pageNumber: pdfViewer.currentPageNumber || 1,
    pagesCount,
    pagePdfSize: currentPageSize,
    pageSize: pageRect
      ? {
          height: Math.ceil(pageRect.height),
          width: Math.ceil(pageRect.width),
        }
      : null,
    pageSizes,
    rotation: pdfViewer.pagesRotation || 0,
    scale,
    scalePercent: scale ? Math.round(scale * 100) : 0,
    scaleValue: pdfViewer.currentScaleValue || "page-width",
  };
}
