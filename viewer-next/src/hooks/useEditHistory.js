import { useCallback, useEffect, useMemo, useState } from "react";
import {
  appendPdfHistoryEntry,
  clearPdfHistoryEntries,
  getPdfHistoryEntries,
} from "../pdf/pdfStorage.js";

function getHistoryDocumentId(documentInfo) {
  return documentInfo?.historyDocumentId || documentInfo?.id || null;
}

function findUndoEntry(entries, activePdfTabId) {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].afterTabId === activePdfTabId) {
      return entries[index];
    }
  }
  return null;
}

function findRedoEntry(entries, activePdfTabId) {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].beforeTabId === activePdfTabId) {
      return entries[index];
    }
  }
  return null;
}

export function useEditHistory({
  activePdfTabId,
  documentInfo,
  onSelectPdfTab,
}) {
  const [entries, setEntries] = useState([]);
  const documentId = getHistoryDocumentId(documentInfo);

  const refresh = useCallback(async () => {
    if (!documentId) {
      setEntries([]);
      return;
    }
    setEntries(await getPdfHistoryEntries(documentId));
  }, [documentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const undoEntry = useMemo(
    () => findUndoEntry(entries, activePdfTabId),
    [activePdfTabId, entries]
  );
  const redoEntry = useMemo(
    () => findRedoEntry(entries, activePdfTabId),
    [activePdfTabId, entries]
  );
  const revisionEntries = useMemo(
    () => entries.filter(entry => entry.strategy === "revision"),
    [entries]
  );
  const timelineEntries = useMemo(
    () => entries.filter(entry => entry.strategy !== "revision"),
    [entries]
  );

  const recordRevision = useCallback(
    async entry => {
      const savedEntry = await appendPdfHistoryEntry({
        ...entry,
        documentId: entry.documentId || documentId,
        strategy: "revision",
      });
      await refresh();
      return savedEntry;
    },
    [documentId, refresh]
  );

  const recordTimeline = useCallback(
    async entry => {
      const savedEntry = await appendPdfHistoryEntry({
        ...entry,
        documentId: entry.documentId || documentId,
        strategy: entry.strategy || "timeline",
      });
      await refresh();
      return savedEntry;
    },
    [documentId, refresh]
  );

  const clear = useCallback(async () => {
    await clearPdfHistoryEntries(documentId);
    await refresh();
  }, [documentId, refresh]);

  const undo = useCallback(async () => {
    if (!undoEntry?.beforeTabId) {
      return false;
    }
    await onSelectPdfTab(undoEntry.beforeTabId);
    await refresh();
    return true;
  }, [onSelectPdfTab, refresh, undoEntry]);

  const redo = useCallback(async () => {
    if (!redoEntry?.afterTabId) {
      return false;
    }
    await onSelectPdfTab(redoEntry.afterTabId);
    await refresh();
    return true;
  }, [onSelectPdfTab, redoEntry, refresh]);

  return {
    canRedo: Boolean(redoEntry),
    canUndo: Boolean(undoEntry),
    clear,
    documentId,
    entries,
    recordTimeline,
    recordRevision,
    redo,
    redoEntry,
    refresh,
    revisionEntries,
    timelineEntries,
    undo,
    undoEntry,
  };
}
