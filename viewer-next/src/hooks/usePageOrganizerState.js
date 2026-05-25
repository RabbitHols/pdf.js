import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../i18n/index.js";

function createPageOrder(pagesCount) {
  return Array.from({ length: pagesCount }, (_, index) => index + 1);
}

function movePageNearTarget(order, draggedPage, targetPage) {
  if (!draggedPage || !targetPage || draggedPage === targetPage) {
    return order;
  }
  const sourceIndex = order.indexOf(draggedPage);
  const originalTargetIndex = order.indexOf(targetPage);
  if (sourceIndex < 0 || originalTargetIndex < 0) {
    return order;
  }
  const withoutDragged = order.filter(page => page !== draggedPage);
  const targetIndex = withoutDragged.indexOf(targetPage);
  if (targetIndex < 0) {
    return order;
  }
  const nextOrder = [...withoutDragged];
  const insertIndex =
    sourceIndex < originalTargetIndex ? targetIndex + 1 : targetIndex;
  nextOrder.splice(insertIndex, 0, draggedPage);
  return nextOrder;
}

function normalizePages(pages, draftOrder) {
  const draftPages = new Set(draftOrder);
  return Array.from(new Set(pages))
    .map(Number)
    .filter(page => draftPages.has(page));
}

export function usePageOrganizerState(pagesCount) {
  const { t } = useTranslation();
  const [draftOrder, setDraftOrder] = useState(() =>
    createPageOrder(pagesCount)
  );
  const [pageRotations, setPageRotations] = useState(() => ({}));
  const [selectedPages, setSelectedPages] = useState(() => new Set());
  const [draggedPage, setDraggedPage] = useState(null);
  const [insertions, setInsertions] = useState([]);
  const [replacements, setReplacements] = useState([]);
  const [selectionPreset, setSelectionPreset] = useState("manual");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setDraftOrder(current => {
      const currentSet = new Set(current);
      const next = current.filter(page => page <= pagesCount);
      for (let page = 1; page <= pagesCount; page += 1) {
        if (!currentSet.has(page)) {
          next.push(page);
        }
      }
      return next;
    });
    setSelectedPages(current => {
      const next = new Set();
      for (const page of current) {
        if (page <= pagesCount) {
          next.add(page);
        }
      }
      return next;
    });
    setPageRotations(current =>
      Object.fromEntries(
        Object.entries(current).filter(([page]) => Number(page) <= pagesCount)
      )
    );
    setInsertions(current =>
      current.filter(
        insertion =>
          insertion.insertAfterPosition >= -1 &&
          insertion.insertAfterPosition <= pagesCount - 1
      )
    );
  }, [pagesCount]);

  const selectedCount = selectedPages.size;
  const hasDraftOrder = useMemo(
    () =>
      draftOrder.length !== pagesCount ||
      draftOrder.some((page, index) => page !== index + 1),
    [draftOrder, pagesCount]
  );
  const hasDraftRotations = useMemo(
    () => Object.keys(pageRotations).length > 0,
    [pageRotations]
  );
  const hasDraftInsertions = insertions.length > 0;
  const hasDraftReplacements = replacements.length > 0;
  const hasDraftChanges =
    hasDraftOrder ||
    hasDraftRotations ||
    hasDraftInsertions ||
    hasDraftReplacements;

  const clearSelection = useCallback(() => {
    setSelectedPages(new Set());
    setSelectionPreset("manual");
    setStatus("");
  }, []);

  const togglePageSelection = useCallback(page => {
    setSelectedPages(current => {
      const next = new Set(current);
      if (next.has(page)) {
        next.delete(page);
      } else {
        next.add(page);
      }
      return next;
    });
    setSelectionPreset("manual");
    setStatus("");
  }, []);

  const selectPreset = useCallback(
    (preset, currentPage = 1) => {
      setSelectionPreset(preset);
      setSelectedPages(() => {
        const next = new Set();
        for (let page = 1; page <= pagesCount; page += 1) {
          if (
            preset === "all" ||
            (preset === "odd" && page % 2 === 1) ||
            (preset === "even" && page % 2 === 0) ||
            (preset === "current" && page === currentPage)
          ) {
            next.add(page);
          }
        }
        return next;
      });
      setStatus("");
    },
    [pagesCount]
  );

  const beginDrag = useCallback(page => {
    setDraggedPage(page);
    setStatus("");
  }, []);

  const endDrag = useCallback(() => {
    setDraggedPage(null);
  }, []);

  const moveDraggedPageAfter = useCallback(
    targetPage => {
      setDraftOrder(current =>
        movePageNearTarget(current, draggedPage, targetPage)
      );
      setDraggedPage(null);
      setStatus(
        t(
          "Ordine pagine aggiornato. Applica o esporta per salvare le modifiche."
        )
      );
    },
    [draggedPage, t]
  );

  const movePageAfterTarget = useCallback(
    (sourcePage, targetPage) => {
      setDraftOrder(current =>
        movePageNearTarget(current, sourcePage, targetPage)
      );
      setDraggedPage(null);
      setStatus(
        t(
          "Ordine pagine aggiornato. Applica o esporta per salvare le modifiche."
        )
      );
    },
    [t]
  );

  const resetDraftOrder = useCallback(() => {
    setDraftOrder(createPageOrder(pagesCount));
    setPageRotations({});
    setInsertions([]);
    setReplacements([]);
    setSelectedPages(new Set());
    setSelectionPreset("manual");
    setStatus("");
  }, [pagesCount]);

  const getSelectedPositions = useCallback(() => {
    if (selectedPages.size === 0) {
      return [];
    }
    return draftOrder
      .map((page, index) => (selectedPages.has(page) ? index + 1 : null))
      .filter(Boolean);
  }, [draftOrder, selectedPages]);

  const buildDraftFromPositions = useCallback(
    positions => {
      const order = positions
        .map(position => draftOrder[position - 1])
        .filter(Boolean);
      const rotations = Object.fromEntries(
        order
          .map(page => [page, pageRotations[page]])
          .filter(([, rotation]) => rotation)
      );
      const extractedReplacements = [];
      positions.forEach((position, index) => {
        const replacement = replacements.find(
          item =>
            position >= item.targetStartPosition &&
            position <= item.targetEndPosition
        );
        if (!replacement) {
          return;
        }
        const sourcePage =
          replacement.sourceStartPage +
          position -
          replacement.targetStartPosition;
        extractedReplacements.push({
          ...replacement,
          id: `${replacement.id || "replacement"}-extract-${index + 1}`,
          sourceEndPage: sourcePage,
          sourceStartPage: sourcePage,
          targetEndPosition: index + 1,
          targetStartPosition: index + 1,
        });
      });
      return {
        insertions: [],
        order,
        positions,
        replacements: extractedReplacements,
        rotations,
      };
    },
    [draftOrder, pageRotations, replacements]
  );

  const getExtractionDraft = useCallback(
    (currentPage = 1) => {
      const currentPosition = Math.max(
        1,
        draftOrder.indexOf(currentPage) + 1
      );
      const selectedPositions = getSelectedPositions();
      const positions = selectedPositions.length
        ? selectedPositions
        : [currentPosition];
      return buildDraftFromPositions(positions);
    },
    [buildDraftFromPositions, draftOrder, getSelectedPositions]
  );

  const getSplitDrafts = useCallback(
    pagesPerFile => {
      const chunkSize = Number(pagesPerFile);
      if (!Number.isInteger(chunkSize) || chunkSize < 1) {
        return [];
      }
      const drafts = [];
      for (let index = 0; index < draftOrder.length; index += chunkSize) {
        const positions = draftOrder
          .slice(index, index + chunkSize)
          .map((_, offset) => index + offset + 1);
        drafts.push(buildDraftFromPositions(positions));
      }
      return drafts;
    },
    [buildDraftFromPositions, draftOrder]
  );

  const addReplacement = useCallback(
    replacement => {
      setReplacements(current => [
        ...current,
        {
          ...replacement,
          id:
            replacement.id ||
            `replacement-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      ]);
      setSelectionPreset("manual");
      setStatus(
        t(
          "Sostituzione pagine aggiunta alla bozza. Applica o esporta per salvare le modifiche."
        )
      );
    },
    [t]
  );

  const addInsertion = useCallback(
    insertion => {
      setInsertions(current => [
        ...current,
        {
          ...insertion,
          id:
            insertion.id ||
            `insertion-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      ]);
      setSelectionPreset("manual");
      setStatus(
        t(
          "Inserimento pagine aggiunto alla bozza. Applica o esporta per salvare le modifiche."
        )
      );
    },
    [t]
  );

  const deletePages = useCallback(
    pages => {
      const targetPages = normalizePages(pages, draftOrder);
      if (!targetPages.length) {
        return;
      }
      if (targetPages.length >= draftOrder.length) {
        setStatus(t("Non puoi eliminare tutte le pagine."));
        return;
      }
      const deletedPages = new Set(targetPages);
      const deletedPositions = draftOrder
        .map((page, index) => (deletedPages.has(page) ? index : null))
        .filter(position => position !== null);
      const nextDraftLength = draftOrder.length - targetPages.length;
      setDraftOrder(current => current.filter(page => !deletedPages.has(page)));
      setSelectedPages(current => {
        const next = new Set();
        for (const page of current) {
          if (!deletedPages.has(page)) {
            next.add(page);
          }
        }
        return next;
      });
      setPageRotations(current =>
        Object.fromEntries(
          Object.entries(current).filter(([page]) => !deletedPages.has(Number(page)))
        )
      );
      setReplacements(current =>
        current.filter(
          replacement =>
            replacement.targetEndPosition <= draftOrder.length - targetPages.length
        )
      );
      setInsertions(current =>
        current.map(insertion => {
          const deletedBeforeOrAt = deletedPositions.filter(
            position => position <= insertion.insertAfterPosition
          ).length;
          return {
            ...insertion,
            insertAfterPosition: Math.min(
              nextDraftLength - 1,
              Math.max(-1, insertion.insertAfterPosition - deletedBeforeOrAt)
            ),
          };
        })
      );
      setSelectionPreset("manual");
      setStatus(
        t("{{count}} pagine eliminate dalla bozza. Applica o esporta per salvare le modifiche.", {
          count: targetPages.length,
        })
      );
    },
    [draftOrder, t]
  );

  const rotatePagesClockwise = useCallback(
    pages => {
      const targetPages = Array.from(new Set(pages))
        .map(Number)
        .filter(page => page >= 1 && page <= pagesCount);
      if (!targetPages.length) {
        return;
      }
      setPageRotations(current => {
        const next = { ...current };
        for (const page of targetPages) {
          next[page] = ((next[page] || 0) + 90) % 360;
          if (next[page] === 0) {
            delete next[page];
          }
        }
        return next;
      });
      const label =
        targetPages.length === 1
          ? t("Pagina {{page}} ruotata nella bozza UI.", {
              page: targetPages[0],
            })
          : t("{{count}} pagine ruotate nella bozza UI.", {
              count: targetPages.length,
            });
      setStatus(
        `${label} ${t("Applica o esporta per salvare le modifiche.")}`
      );
    },
    [pagesCount, t]
  );

  const rotatePageClockwise = useCallback(
    page => {
      rotatePagesClockwise([page]);
    },
    [rotatePagesClockwise]
  );

  const noteUnavailableAction = useCallback(
    actionName => {
      setStatus(
        t(
          "{{actionName}} richiede una action PDF reale sotto viewer-next/src/pdf/. Nessuna modifica e' stata esportata.",
          {
            actionName: t(actionName),
          }
        )
      );
    },
    [t]
  );

  return {
    beginDrag,
    addInsertion,
    addReplacement,
    clearSelection,
    deletePages,
    draftOrder,
    draggedPage,
    endDrag,
    getExtractionDraft,
    getSelectedPositions,
    getSplitDrafts,
    hasDraftChanges,
    hasDraftInsertions,
    hasDraftOrder,
    hasDraftReplacements,
    hasDraftRotations,
    insertions,
    moveDraggedPageAfter,
    movePageAfterTarget,
    noteUnavailableAction,
    pageRotations,
    replacements,
    resetDraftOrder,
    rotatePageClockwise,
    rotatePagesClockwise,
    selectedCount,
    selectedPages,
    selectionPreset,
    selectPreset,
    setStatus,
    status,
    togglePageSelection,
  };
}
