import { useCallback, useEffect, useState } from "react";
import {
  getActivePdfTabId,
  getStoredPdf,
  getStoredPdfAsync,
  getStoredPdfTabs,
  removeStoredPdfTab,
  setActivePdfTab,
  storePdfFile,
} from "../pdf/pdfStorage.js";

export function usePdfTabs({ navigate }) {
  const [pdfTabs, setPdfTabs] = useState(() => getStoredPdfTabs());
  const [activePdfTabId, setActivePdfTabId] = useState(() => getActivePdfTabId());
  const [documentInfo, setDocumentInfo] = useState(() => getStoredPdf());

  const refreshDocument = useCallback(async () => {
    const tabs = getStoredPdfTabs();
    const activeId = getActivePdfTabId();
    setPdfTabs(tabs);
    setActivePdfTabId(activeId);
    setDocumentInfo(getStoredPdf());
    const hydratedPdf = await getStoredPdfAsync();
    if (hydratedPdf?.id === (getActivePdfTabId() || hydratedPdf.id)) {
      setDocumentInfo(hydratedPdf);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function hydrateActiveDocument() {
      const hydratedPdf = await getStoredPdfAsync();
      if (!cancelled) {
        setDocumentInfo(hydratedPdf);
      }
    }
    hydrateActiveDocument();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function refreshStoredPdfs() {
      refreshDocument();
    }
    window.addEventListener("viewer-next-pdf-storage-changed", refreshStoredPdfs);
    return () => {
      window.removeEventListener(
        "viewer-next-pdf-storage-changed",
        refreshStoredPdfs
      );
    };
  }, [refreshDocument]);

  const openPdfFile = useCallback(
    async (file, options = {}) => {
      const pdf = await storePdfFile(file, options);
      setPdfTabs(getStoredPdfTabs());
      setActivePdfTabId(pdf.id);
      setDocumentInfo(pdf);
      navigate("edit");
      return pdf;
    },
    [navigate]
  );

  const selectPdfTab = useCallback(async id => {
    setActivePdfTab(id);
    setActivePdfTabId(id);
    setDocumentInfo(getStoredPdf());
    const hydratedPdf = await getStoredPdfAsync();
    setDocumentInfo(hydratedPdf);
    return hydratedPdf;
  }, []);

  const closePdfTab = useCallback(
    async id => {
      await removeStoredPdfTab(id);
      const nextTabs = getStoredPdfTabs();
      const nextActiveId = getActivePdfTabId();
      setPdfTabs(nextTabs);
      setActivePdfTabId(nextActiveId);
      setDocumentInfo(getStoredPdf());
      setDocumentInfo(await getStoredPdfAsync());
      if (nextTabs.length === 0) {
        navigate("home");
      }
    },
    [navigate]
  );

  return {
    activePdfTabId,
    closePdfTab,
    documentInfo,
    openPdfFile,
    pdfTabs,
    refreshDocument,
    selectPdfTab,
  };
}
