const FIT_PAGE_SAFE_AREA_GAP = 16;
const FIT_PAGE_SCALE_MIN = 0.1;
const FIT_PAGE_SCALE_MAX = 10;
const FIT_PAGE_OVERLAY_SELECTORS = [
  ".editor-context-sidenav",
  ".floating-toolbar",
  ".draw-tool-picker",
  ".highlight-color-picker",
  ".signature-tool-picker",
];

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isVisibleElement(element) {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || 1) !== 0
  );
}

function rectsOverlap(first, second) {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

function getContentRect(element) {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  const left = rect.left + (Number.parseFloat(style.paddingLeft) || 0);
  const right = rect.right - (Number.parseFloat(style.paddingRight) || 0);
  const top = rect.top + (Number.parseFloat(style.paddingTop) || 0);
  const bottom = rect.bottom - (Number.parseFloat(style.paddingBottom) || 0);

  if (right <= left || bottom <= top) {
    return rect;
  }

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function getFitPageSafeRect(container) {
  const document = container.ownerDocument;
  const containerRect = getContentRect(container);
  const containerCenter = containerRect.left + containerRect.width / 2;
  let safeLeft = containerRect.left;
  let safeRight = containerRect.right;

  for (const selector of FIT_PAGE_OVERLAY_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      if (!isVisibleElement(element)) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (!rectsOverlap(containerRect, rect)) {
        continue;
      }

      const rectCenter = rect.left + rect.width / 2;
      if (rectCenter < containerCenter) {
        safeLeft = Math.max(safeLeft, rect.right + FIT_PAGE_SAFE_AREA_GAP);
      } else {
        safeRight = Math.min(safeRight, rect.left - FIT_PAGE_SAFE_AREA_GAP);
      }
    }
  }

  if (safeRight <= safeLeft) {
    return containerRect;
  }
  return {
    ...containerRect,
    left: safeLeft,
    right: safeRight,
    width: safeRight - safeLeft,
  };
}

function getCurrentPageView(pdfViewer) {
  return pdfViewer.getPageView((pdfViewer.currentPageNumber || 1) - 1);
}

export function getSafePageWidthScale(pdfViewer) {
  const pageView = getCurrentPageView(pdfViewer);
  if (!pageView?.width || !pageView?.scale) {
    return null;
  }

  const safeRect = getFitPageSafeRect(pdfViewer.container);
  const scale =
    ((safeRect.width - FIT_PAGE_SAFE_AREA_GAP * 2) / pageView.width) *
    pageView.scale;
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  return clampNumber(scale, FIT_PAGE_SCALE_MIN, FIT_PAGE_SCALE_MAX);
}

function centerCurrentPageInSafeArea(pdfViewer) {
  const container = pdfViewer.container;
  const page = container.querySelector(
    `.page[data-page-number="${pdfViewer.currentPageNumber || 1}"]`
  );
  if (!page) {
    return;
  }

  const safeRect = getFitPageSafeRect(container);
  const pageRect = page.getBoundingClientRect();
  const safeCenter = safeRect.left + safeRect.width / 2;
  const pageCenter = pageRect.left + pageRect.width / 2;
  container.scrollLeft += pageCenter - safeCenter;
}

export function createViewerActions({
  downloadManager,
  emitState,
  eventBus,
  filename,
  findController,
  getFilename,
  getCustomOutlineItems,
  getNativeEditingBridge,
  getPdfDocument,
  linkService,
  pdfViewer,
}) {
  async function getExportData() {
    const pdfDocument = getPdfDocument();
    if (!pdfDocument) {
      return null;
    }
    const nativeEditingBridge = getNativeEditingBridge?.();
    let data = null;
    let kind = "original";

    if (!data) {
      data = await nativeEditingBridge?.getRedactedBytes?.();
      if (data) {
        kind = "redacted";
      }
    }
    if (!data) {
      data = nativeEditingBridge?.getCommittedBytes?.();
      if (data) {
        kind = "native-text-edit";
      }
    }
    const customOutlineItems = getCustomOutlineItems?.() || [];
    if (!data && customOutlineItems.length > 0) {
      data = await pdfDocument.extractPages(
        [{ document: null }],
        { customOutlineItems }
      );
      kind = "bookmarks";
    }
    if (!data && pdfDocument.annotationStorage.size > 0) {
      data = await pdfDocument.saveDocument();
      kind = "annotations";
    }
    if (!data) {
      data = await pdfDocument.getData();
    }
    return {
      data,
      kind,
      size: data?.length || data?.byteLength || 0,
    };
  }

  async function downloadExport() {
    const exportData = await getExportData();
    if (!exportData?.data) {
      return null;
    }
    downloadManager.download(exportData.data, "", getFilename?.() || filename);
    emitState();
    return exportData;
  }

  function highlightHistoryTarget(element) {
    element.classList.add("viewer-next-history-target");
    window.setTimeout(() => {
      element.classList.remove("viewer-next-history-target");
    }, 1800);
  }

  function scrollToHistoryDestination(destination = null) {
    if (!destination) {
      return false;
    }
    const pageNumber = Number(destination.pageNumber || 0);
    if (
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= pdfViewer.pagesCount
    ) {
      pdfViewer.currentPageNumber = pageNumber;
    }

    const editorId = destination.editorId;
    let attempts = 0;
    const focusTarget = () => {
      attempts += 1;
      const target = editorId
        ? pdfViewer.container?.ownerDocument?.getElementById(editorId)
        : null;
      if (target) {
        target.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "smooth",
        });
        target.focus?.({ preventScroll: true });
        highlightHistoryTarget(target);
        return;
      }
      if (attempts < 20 && editorId) {
        window.requestAnimationFrame(focusTarget);
        return;
      }
      const page = pdfViewer.container?.querySelector(
        `.page[data-page-number="${pageNumber}"]`
      );
      page?.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "smooth",
      });
    };
    window.requestAnimationFrame(focusTarget);
    emitState();
    return true;
  }

  function goToSearchResult(result = null) {
    const pageNumber = Number(result?.pageNumber || 0);
    const matchIndex = Number(result?.matchIndex ?? -1);
    if (
      !findController ||
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > pdfViewer.pagesCount ||
      !Number.isInteger(matchIndex) ||
      matchIndex < 0
    ) {
      return false;
    }

    const pageIndex = pageNumber - 1;
    findController._selected.pageIdx = pageIndex;
    findController._selected.matchIdx = matchIndex;
    findController._offset.pageIdx = pageIndex;
    findController._offset.matchIdx = matchIndex;
    findController._offset.wrapped = false;
    findController._scrollMatches = true;

    linkService.page = pageNumber;
    eventBus.dispatch("updatetextlayermatches", {
      source: findController,
      pageIndex,
    });
    eventBus.dispatch("updatefindmatchescount", {
      source: findController,
      matchesCount: {
        current: Number(result?.index || 0),
        total: findController._matchesCountTotal || 0,
      },
    });
    emitState();
    return true;
  }

  return {
    deleteSelectedAnnotation: () => {
      eventBus.dispatch("editingaction", {
        source: window,
        name: "delete",
      });
      emitState();
    },
    clearHistory: () => {
      eventBus.dispatch("editingaction", {
        source: window,
        name: "clearHistory",
      });
      emitState();
    },
    download: async () => {
      await downloadExport();
    },
    exportData: getExportData,
    exportRedacted: async () => {
      const exportData = await downloadExport();
      if (exportData?.kind !== "redacted") {
        throw new Error("viewer-next-redacted-export-unavailable");
      }
      return exportData;
    },
    protectWithPassword: async ({ userPassword } = {}) => {
      const exportData = await getExportData();
      if (!exportData?.data) {
        return null;
      }
      const { protectPdfWithPassword } = await import("./pdfProtection.js");
      const data = await protectPdfWithPassword(exportData.data, {
        userPassword,
      });
      emitState();
      return {
        data,
        kind: "protected",
        sourceKind: exportData.kind,
        size: data?.length || data?.byteLength || 0,
      };
    },
    organizePages: async ({ insertions, order, replacements, rotations } = {}) => {
      const pdfDocument = getPdfDocument();
      if (!pdfDocument) {
        return null;
      }
      const { buildPageOrganizationPlan } = await import(
        "./pageOrganization.js"
      );
      const extractionPlan = buildPageOrganizationPlan({
        insertions,
        order,
        pagesCount: pdfDocument.numPages,
        replacements,
        rotations,
      });
      if (!extractionPlan) {
        return null;
      }
      const data = await pdfDocument.extractPages(extractionPlan);
      if (!data) {
        throw new Error("viewer-next-page-organization-failed");
      }
      emitState();
      return {
        data,
        kind: "page-organization",
        size: data?.length || data?.byteLength || 0,
      };
    },
    find: (query, options = {}) => {
      eventBus.dispatch("find", {
        source: window,
        type: options.type || "",
        query,
        caseSensitive: Boolean(options.caseSensitive),
        entireWord: Boolean(options.entireWord),
        highlightAll: options.highlightAll ?? true,
        findPrevious: Boolean(options.findPrevious),
        matchDiacritics: options.matchDiacritics ?? true,
        queryIsRegex: Boolean(options.queryIsRegex),
      });
    },
    goToSearchResult,
    goToHistoryDestination: destination => {
      scrollToHistoryDestination(destination);
    },
    goToBookmark: async bookmark => {
      if (!bookmark) {
        return;
      }
      if (bookmark.destination?.pageNumber) {
        linkService.goToXY(
          bookmark.destination.pageNumber,
          bookmark.destination.x || 0,
          bookmark.destination.y || 0,
          { center: "both" }
        );
        emitState();
        return;
      }
      if (bookmark.dest) {
        await linkService.goToDestination(bookmark.dest);
        emitState();
        return;
      }
      if (bookmark.action) {
        linkService.executeNamedAction(bookmark.action);
        emitState();
        return;
      }
      if (bookmark.url) {
        window.open(bookmark.url, "_blank", "noopener,noreferrer");
      }
    },
    redo: () => {
      eventBus.dispatch("editingaction", {
        source: window,
        name: "redo",
      });
      emitState();
    },
    print: async () => {
      const pdfDocument = getPdfDocument();
      if (!pdfDocument) {
        return;
      }
      const { printPdfDocument } = await import("./viewerPrintService.js");
      await printPdfDocument({ pdfDocument, pdfViewer });
      emitState();
    },
    save: async () => {
      await downloadExport();
    },
    fitPageWidth: () => {
      const safeScale = getSafePageWidthScale(pdfViewer);
      pdfViewer.currentScaleValue = safeScale || "page-width";
      requestAnimationFrame(() => centerCurrentPageInSafeArea(pdfViewer));
      emitState();
    },
    goToPage: pageNumber => {
      const nextPage = Number(pageNumber);
      if (
        Number.isInteger(nextPage) &&
        nextPage >= 1 &&
        nextPage <= pdfViewer.pagesCount
      ) {
        pdfViewer.currentPageNumber = nextPage;
        emitState();
      }
    },
    nextPage: () => {
      pdfViewer.nextPage();
      emitState();
    },
    previousPage: () => {
      pdfViewer.previousPage();
      emitState();
    },
    resetZoom: () => {
      const safeScale = getSafePageWidthScale(pdfViewer);
      pdfViewer.currentScaleValue = safeScale || "page-width";
      requestAnimationFrame(() => centerCurrentPageInSafeArea(pdfViewer));
      emitState();
    },
    rotateClockwise: () => {
      pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
      emitState();
    },
    setScale: scaleValue => {
      if (scaleValue === "page-width") {
        const safeScale = getSafePageWidthScale(pdfViewer);
        pdfViewer.currentScaleValue = safeScale || "page-width";
        requestAnimationFrame(() => centerCurrentPageInSafeArea(pdfViewer));
        emitState();
        return;
      }
      pdfViewer.currentScaleValue = scaleValue;
      emitState();
    },
    undo: () => {
      eventBus.dispatch("editingaction", {
        source: window,
        name: "undo",
      });
      emitState();
    },
    zoomIn: () => {
      pdfViewer.increaseScale();
      emitState();
    },
    zoomOut: () => {
      pdfViewer.decreaseScale();
      emitState();
    },
  };
}
