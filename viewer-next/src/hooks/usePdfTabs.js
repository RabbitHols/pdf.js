import { useCallback, useEffect, useRef, useState } from "react";
import {
  getActivePdfTabId,
  getStoredPdf,
  getStoredPdfAsync,
  getStoredPdfTabs,
  removeStoredPdfTab,
  setActivePdfTab,
  storePdfFile,
} from "../pdf/pdfStorage.js";

function getRenderableStoredPdf() {
  const storedPdf = getStoredPdf();
  if (!storedPdf) {
    return null;
  }
  return storedPdf.data ? storedPdf : undefined;
}

function applyRenderableStoredPdf(setDocumentInfo) {
  const storedPdf = getRenderableStoredPdf();
  if (storedPdf !== undefined) {
    setDocumentInfo(storedPdf);
  }
}

export function usePdfTabs({ navigate }) {
  const [pdfTabs, setPdfTabs] = useState(() => getStoredPdfTabs());
  const [activePdfTabId, setActivePdfTabId] = useState(() => getActivePdfTabId());
  const [documentInfo, setDocumentInfo] = useState(
    () => getRenderableStoredPdf() ?? null
  );
  const documentInfoRef = useRef(documentInfo);
  const hydrationRequestRef = useRef(0);

  useEffect(() => {
    documentInfoRef.current = documentInfo;
  }, [documentInfo]);

  const refreshDocument = useCallback(async () => {
    const tabs = getStoredPdfTabs();
    const activeId = getActivePdfTabId();
    setPdfTabs(tabs);
    setActivePdfTabId(activeId);
    applyRenderableStoredPdf(setDocumentInfo);
    const hydratedPdf = await getStoredPdfAsync();
    const currentActiveId = getActivePdfTabId();
    if (!hydratedPdf) {
      applyRenderableStoredPdf(setDocumentInfo);
      return;
    }
    if (
      documentInfoRef.current?.id === hydratedPdf.id &&
      documentInfoRef.current?.data
    ) {
      return;
    }
    if (hydratedPdf.id === (currentActiveId || hydratedPdf.id)) {
      setDocumentInfo(hydratedPdf);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++hydrationRequestRef.current;
    async function hydrateActiveDocument() {
      const hydratedPdf = await getStoredPdfAsync();
      if (!cancelled && requestId === hydrationRequestRef.current) {
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
      ++hydrationRequestRef.current;
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
    const requestId = ++hydrationRequestRef.current;
    setActivePdfTab(id);
    setActivePdfTabId(id);
    applyRenderableStoredPdf(setDocumentInfo);
    const hydratedPdf = await getStoredPdfAsync();
    if (requestId === hydrationRequestRef.current) {
      setDocumentInfo(hydratedPdf);
    }
    return hydratedPdf;
  }, []);

  const closePdfTab = useCallback(
    async id => {
      ++hydrationRequestRef.current;
      await removeStoredPdfTab(id);
      const nextTabs = getStoredPdfTabs();
      const nextActiveId = getActivePdfTabId();
      setPdfTabs(nextTabs);
      setActivePdfTabId(nextActiveId);
      applyRenderableStoredPdf(setDocumentInfo);
      const hydratedPdf = await getStoredPdfAsync();
      setDocumentInfo(hydratedPdf);
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
