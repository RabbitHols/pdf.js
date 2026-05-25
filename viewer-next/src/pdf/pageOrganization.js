import { PagesMapper } from "@rewirepdf/pdfjs/viewer-core";

function normalizePageOrder(order, pagesCount) {
  if (!order) {
    return Array.from({ length: pagesCount }, (_, index) => index + 1);
  }
  const seen = new Set();
  const normalized = [];
  for (const value of order || []) {
    const pageNumber = Number(value);
    if (
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= pagesCount &&
      !seen.has(pageNumber)
    ) {
      seen.add(pageNumber);
      normalized.push(pageNumber);
    }
  }
  return normalized;
}

function normalizeRotation(value) {
  const rotation = Number(value || 0);
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
    return 0;
  }
  return ((rotation % 360) + 360) % 360;
}

function normalizePdfBytes(bytes) {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  return null;
}

function normalizeReplacementDraft(replacement, pageOrderLength) {
  const targetStart = Number(replacement?.targetStartPosition);
  const targetEnd = Number(replacement?.targetEndPosition);
  const sourceStart = Number(replacement?.sourceStartPage);
  const sourceEnd = Number(replacement?.sourceEndPage);
  const sourceBytes = normalizePdfBytes(replacement?.sourceBytes);
  if (
    !Number.isInteger(targetStart) ||
    !Number.isInteger(targetEnd) ||
    !Number.isInteger(sourceStart) ||
    !Number.isInteger(sourceEnd) ||
    targetStart < 1 ||
    targetEnd < targetStart ||
    targetEnd > pageOrderLength ||
    sourceStart < 1 ||
    sourceEnd < sourceStart ||
    !sourceBytes
  ) {
    return null;
  }
  if (targetEnd - targetStart !== sourceEnd - sourceStart) {
    return null;
  }
  return {
    sourceBytes,
    sourceStart,
    targetEnd,
    targetStart,
  };
}

function normalizeInsertionDraft(insertion, pageOrderLength) {
  const insertAfter = Number(insertion?.insertAfterPosition);
  const sourceStart = Number(insertion?.sourceStartPage);
  const sourceEnd = Number(insertion?.sourceEndPage);
  const sourceBytes = normalizePdfBytes(insertion?.sourceBytes);
  if (
    !Number.isInteger(insertAfter) ||
    !Number.isInteger(sourceStart) ||
    !Number.isInteger(sourceEnd) ||
    insertAfter < -1 ||
    insertAfter > pageOrderLength - 1 ||
    sourceStart < 1 ||
    sourceEnd < sourceStart ||
    !sourceBytes
  ) {
    return null;
  }
  return {
    insertAfter,
    sourceBytes,
    sourceEnd,
    sourceStart,
  };
}

function buildEntryFromContributions(contributions) {
  const sorted = [...contributions].sort(
    (first, second) => first.sourceIndex - second.sourceIndex
  );
  const entry = {
    document: sorted[0].document,
    includePages: sorted.map(item => item.sourceIndex),
    pageIndices: sorted.map(item => item.outputIndex),
  };
  const pageRotations = sorted.map(item => normalizeRotation(item.rotation));
  if (pageRotations.some(Boolean)) {
    entry.pageRotations = pageRotations;
  }
  return entry;
}

function buildEntriesFromContributions(contributions) {
  const groups = new Map();
  for (const contribution of contributions) {
    const items = groups.get(contribution.groupKey) || [];
    items.push(contribution);
    groups.set(contribution.groupKey, items);
  }
  return Array.from(groups.values()).map(buildEntryFromContributions);
}

function buildExplicitPagePlan({
  insertions,
  pageOrder,
  replacements,
  rotations,
}) {
  const replacementDrafts = (replacements || [])
    .map(replacement =>
      normalizeReplacementDraft(replacement, pageOrder.length)
    )
    .filter(Boolean);
  const insertionDrafts = (insertions || [])
    .map(insertion => normalizeInsertionDraft(insertion, pageOrder.length))
    .filter(Boolean);
  if (replacementDrafts.length === 0 && insertionDrafts.length === 0) {
    return null;
  }

  const contributions = [];
  let outputIndex = 0;
  const appendExternalRange = ({
    groupKey,
    sourceBytes,
    sourceEnd,
    sourceStart,
  }) => {
    for (
      let sourcePage = sourceStart;
      sourcePage <= sourceEnd;
      sourcePage += 1
    ) {
      contributions.push({
        document: sourceBytes,
        groupKey,
        outputIndex,
        sourceIndex: sourcePage - 1,
      });
      outputIndex += 1;
    }
  };

  for (const insertion of insertionDrafts.filter(
    item => item.insertAfter < 0
  )) {
    appendExternalRange({
      groupKey: `insertion:${contributions.length}`,
      sourceBytes: insertion.sourceBytes,
      sourceEnd: insertion.sourceEnd,
      sourceStart: insertion.sourceStart,
    });
  }

  for (let slotIndex = 0; slotIndex < pageOrder.length; slotIndex += 1) {
    const outputPosition = slotIndex + 1;
    const replacement = replacementDrafts.find(
      item =>
        outputPosition >= item.targetStart && outputPosition <= item.targetEnd
    );
    if (replacement) {
      contributions.push({
        document: replacement.sourceBytes,
        groupKey: `replacement:${replacement.targetStart}:${replacement.targetEnd}`,
        outputIndex,
        sourceIndex:
          replacement.sourceStart +
          outputPosition -
          replacement.targetStart -
          1,
      });
      outputIndex += 1;
    } else {
      const pageNumber = pageOrder[slotIndex];
      contributions.push({
        document: null,
        groupKey: "base",
        outputIndex,
        rotation: rotations?.[pageNumber],
        sourceIndex: pageNumber - 1,
      });
      outputIndex += 1;
    }

    for (const [insertionIndex, insertion] of insertionDrafts.entries()) {
      if (insertion.insertAfter !== slotIndex) {
        continue;
      }
      appendExternalRange({
        groupKey: `insertion:${insertionIndex}`,
        sourceBytes: insertion.sourceBytes,
        sourceEnd: insertion.sourceEnd,
        sourceStart: insertion.sourceStart,
      });
    }
  }
  return buildEntriesFromContributions(contributions);
}

export function buildPageOrganizationPlan({
  insertions,
  order,
  pagesCount,
  replacements,
  rotations,
}) {
  if (!Number.isInteger(pagesCount) || pagesCount <= 0) {
    return null;
  }

  const pageOrder = normalizePageOrder(order, pagesCount);
  if (pageOrder.length === 0) {
    return null;
  }

  const explicitPlan = buildExplicitPagePlan({
    insertions,
    pageOrder,
    replacements,
    rotations,
  });
  if (explicitPlan) {
    return explicitPlan;
  }

  const hasOrderChanges = pageOrder.some((pageNumber, index) => {
    return pageNumber !== index + 1;
  });
  const hasDeletedPages = pageOrder.length !== pagesCount;
  const includePages = [...pageOrder]
    .sort((firstPage, secondPage) => firstPage - secondPage)
    .map(pageNumber => pageNumber - 1);
  const pageIndices = includePages.map(pageIndex =>
    pageOrder.indexOf(pageIndex + 1)
  );
  if (!hasOrderChanges) {
    const entry = {
      document: null,
      includePages,
    };
    const pageRotations = entry.includePages.map(pageIndex =>
      normalizeRotation(rotations?.[pageIndex + 1])
    );
    if (pageRotations.some(Boolean)) {
      entry.pageRotations = pageRotations;
    }
    return [entry];
  }

  if (hasDeletedPages) {
    const entry = {
      document: null,
      includePages,
      pageIndices,
    };
    const pageRotations = entry.includePages.map(pageIndex =>
      normalizeRotation(rotations?.[pageIndex + 1])
    );
    if (pageRotations.some(Boolean)) {
      entry.pageRotations = pageRotations;
    }
    return [entry];
  }

  const mapper = new PagesMapper();
  mapper.pagesNumber = pagesCount;
  const currentOrder = Array.from(
    { length: pagesCount },
    (_, index) => index + 1
  );

  for (let targetIndex = 0; targetIndex < pageOrder.length; targetIndex += 1) {
    const pageNumber = pageOrder[targetIndex];
    const currentIndex = currentOrder.indexOf(pageNumber);
    if (currentIndex < 0 || currentIndex === targetIndex) {
      continue;
    }
    mapper.movePages(
      new Set([currentIndex + 1]),
      [currentIndex + 1],
      targetIndex
    );
    const [movedPage] = currentOrder.splice(currentIndex, 1);
    currentOrder.splice(targetIndex, 0, movedPage);
  }

  const plan = mapper.getPageMappingForSaving();
  if (!rotations || Object.keys(rotations).length === 0) {
    return plan;
  }
  for (const entry of plan) {
    const pageRotations = entry.includePages.map(pageIndex =>
      normalizeRotation(rotations[pageIndex + 1])
    );
    if (pageRotations.some(Boolean)) {
      entry.pageRotations = pageRotations;
    }
  }
  return plan;
}
