async function resolveDestinationPageNumber(pdfDocument, dest) {
  if (!dest) {
    return null;
  }

  const explicitDest =
    typeof dest === "string" ? await pdfDocument.getDestination(dest) : await dest;
  if (!Array.isArray(explicitDest)) {
    return null;
  }

  const [destRef] = explicitDest;
  let pageNumber = null;
  if (destRef && typeof destRef === "object") {
    pageNumber = pdfDocument.cachedPageNumber(destRef);
    if (!pageNumber) {
      pageNumber = (await pdfDocument.getPageIndex(destRef)) + 1;
    }
  } else if (Number.isInteger(destRef)) {
    pageNumber = destRef + 1;
  }

  return Number.isInteger(pageNumber) &&
    pageNumber >= 1 &&
    pageNumber <= pdfDocument.numPages
    ? pageNumber
    : null;
}

async function normalizeBookmarkItem(pdfDocument, item, path) {
  const children = await normalizeBookmarkItems(
    pdfDocument,
    item.items || [],
    path
  );
  let pageNumber = null;
  try {
    pageNumber = await resolveDestinationPageNumber(pdfDocument, item.dest);
  } catch {
    pageNumber = null;
  }

  return {
    id: `bookmark-${path.join("-")}`,
    title: item.title || "Untitled bookmark",
    bold: Boolean(item.bold),
    italic: Boolean(item.italic),
    color: Array.isArray(item.color) ? item.color : null,
    count: Number.isInteger(item.count) ? item.count : 0,
    dest: item.dest || null,
    action: item.action || null,
    url: item.url || null,
    newWindow: Boolean(item.newWindow),
    pageNumber,
    children,
  };
}

export async function normalizeBookmarkItems(pdfDocument, outline, path = []) {
  if (!Array.isArray(outline) || !pdfDocument) {
    return [];
  }

  return Promise.all(
    outline.map((item, index) =>
      normalizeBookmarkItem(pdfDocument, item, [...path, index])
    )
  );
}

export function countBookmarks(items = []) {
  return items.reduce(
    (total, item) => total + 1 + countBookmarks(item.children),
    0
  );
}

function getSelectionAnchorElement(selection) {
  return selection.anchorNode?.nodeType === Node.ELEMENT_NODE
    ? selection.anchorNode
    : selection.anchorNode?.parentElement;
}

function getFirstSelectionRectInPage(selection, pdfViewer) {
  const container = pdfViewer?.container;
  if (!selection || selection.isCollapsed || !container) {
    return null;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const rects = Array.from(range.getClientRects()).filter(
      rect => rect.width > 0 && rect.height > 0
    );
    for (const rect of rects) {
      const target = document.elementFromPoint(
        rect.left + Math.min(4, rect.width / 2),
        rect.top + Math.min(4, rect.height / 2)
      );
      const page = target?.closest?.(".page");
      if (page && container.contains(page)) {
        return { page, rect };
      }
    }
  }

  const anchorElement = getSelectionAnchorElement(selection);
  const page = anchorElement?.closest?.(".page");
  if (!page || !container.contains(page)) {
    return null;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? { page, rect } : null;
}

export function canCreateBookmarkFromSelection(pdfViewer) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return false;
  }
  return Boolean(getFirstSelectionRectInPage(selection, pdfViewer));
}

export function createBookmarkFromSelection(pdfViewer) {
  const selection = document.getSelection();
  const text = selection?.toString().replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }

  const selectionTarget = getFirstSelectionRectInPage(selection, pdfViewer);
  if (!selectionTarget) {
    return null;
  }

  const { page, rect } = selectionTarget;
  const pageNumber = Number(page.dataset.pageNumber || 0);
  const pageView = pdfViewer.getPageView(pageNumber - 1);
  if (!pageNumber || !pageView?.viewport) {
    return null;
  }

  const pageRect = page.getBoundingClientRect();
  const [x, y] = pageView.viewport.convertToPdfPoint(
    rect.left - pageRect.left,
    rect.top - pageRect.top
  );
  const title = text.length > 80 ? `${text.slice(0, 77).trim()}...` : text;

  return {
    id: `bookmark-custom-${Date.now()}`,
    title,
    bold: false,
    italic: false,
    color: null,
    count: 0,
    dest: null,
    action: null,
    url: null,
    newWindow: false,
    pageNumber,
    destination: {
      pageNumber,
      x,
      y,
    },
    children: [],
    custom: true,
  };
}
