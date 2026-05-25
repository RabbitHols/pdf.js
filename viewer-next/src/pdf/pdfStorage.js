import { shouldRememberRecentDocuments } from "../app/preferences.js";

export const PENDING_PDF_KEY = "rewirepdf.viewerNext.pendingPdf";
export const PDF_TABS_KEY = "rewirepdf.viewerNext.pdfTabs";
export const ACTIVE_PDF_TAB_KEY = "rewirepdf.viewerNext.activePdfTab";

const PDF_STORAGE_DB = "rewirepdf.viewerNext.storage";
const PDF_STORAGE_DB_VERSION = 2;
const PDF_BYTES_STORE = "pdfBytes";
const PDF_HISTORY_STORE = "pdfHistoryEntries";
const memoryPdfBytes = new Map();
const pdfStorageChangedEvent = "viewer-next-pdf-storage-changed";

function getPdfSessionStore() {
  return shouldRememberRecentDocuments() ? localStorage : sessionStorage;
}

function removePdfSessionKeys(storage) {
  storage?.removeItem(PENDING_PDF_KEY);
  storage?.removeItem(PDF_TABS_KEY);
  storage?.removeItem(ACTIVE_PDF_TAB_KEY);
}

function emitPdfStorageChanged() {
  window.dispatchEvent(new CustomEvent(pdfStorageChangedEvent));
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function createPdfId() {
  return `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createHistoryId() {
  return `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stripRuntimePdfData(metadata, { keepSessionBytes = false } = {}) {
  if (!metadata) {
    return null;
  }
  const { bytes, data, ...rest } = metadata;
  return keepSessionBytes && bytes ? { ...rest, bytes } : rest;
}

function normalizePdfMetadata(metadata) {
  if (!metadata?.id) {
    return null;
  }
  const storage = metadata.storage || (metadata.bytes ? "session" : "indexeddb");
  return {
    id: metadata.id,
    historyDocumentId: metadata.historyDocumentId || metadata.id,
    name: metadata.name || "Document.pdf",
    openedAt: metadata.openedAt || Date.now(),
    parentTabId: metadata.parentTabId || null,
    size: metadata.size || 0,
    source: metadata.source || null,
    type: metadata.type || "application/pdf",
    storage,
    ...(metadata.bytes ? { bytes: metadata.bytes } : null),
  };
}

function openPdfStorageDb() {
  if (!globalThis.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_STORAGE_DB, PDF_STORAGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PDF_BYTES_STORE)) {
        db.createObjectStore(PDF_BYTES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PDF_HISTORY_STORE)) {
        const historyStore = db.createObjectStore(PDF_HISTORY_STORE, {
          keyPath: "id",
        });
        historyStore.createIndex("documentId", "documentId", {
          unique: false,
        });
        historyStore.createIndex("beforeTabId", "beforeTabId", {
          unique: false,
        });
        historyStore.createIndex("afterTabId", "afterTabId", {
          unique: false,
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runPdfBytesTransaction(mode, operation) {
  const db = await openPdfStorageDb();
  if (!db) {
    return null;
  }
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PDF_BYTES_STORE, mode);
      const store = transaction.objectStore(PDF_BYTES_STORE);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function runStoreTransaction(storeName, mode, operation) {
  const db = await openPdfStorageDb();
  if (!db) {
    return null;
  }
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function putPdfBytes(id, buffer) {
  if (!globalThis.indexedDB) {
    throw new Error("viewer-next-indexeddb-unavailable");
  }
  await runPdfBytesTransaction("readwrite", store =>
    store.put({ id, data: buffer })
  );
}

async function getPdfBytes(id) {
  const cached = memoryPdfBytes.get(id);
  if (cached) {
    return cached.slice(0);
  }
  const stored = await runPdfBytesTransaction("readonly", store => store.get(id));
  return stored?.data || null;
}

async function deletePdfBytes(id) {
  memoryPdfBytes.delete(id);
  await runPdfBytesTransaction("readwrite", store => store.delete(id));
}

async function deletePdfStorageDatabase() {
  if (!globalThis.indexedDB) {
    return;
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PDF_STORAGE_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("viewer-next-pdf-storage-blocked"));
  });
}

async function getHistoryEntriesByDocument(documentId) {
  if (!documentId) {
    return [];
  }
  const entries = await runStoreTransaction(
    PDF_HISTORY_STORE,
    "readonly",
    store => store.index("documentId").getAll(documentId)
  );
  return Array.isArray(entries)
    ? entries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    : [];
}

async function deleteHistoryEntryIds(ids) {
  if (!ids.length) {
    return;
  }
  const db = await openPdfStorageDb();
  if (!db) {
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PDF_HISTORY_STORE, "readwrite");
      const store = transaction.objectStore(PDF_HISTORY_STORE);
      for (const id of ids) {
        store.delete(id);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

function collectFutureHistoryEntryIds(entries, tabId) {
  const byBefore = new Map();
  for (const entry of entries) {
    if (!entry.beforeTabId) {
      continue;
    }
    const existing = byBefore.get(entry.beforeTabId) || [];
    existing.push(entry);
    byBefore.set(entry.beforeTabId, existing);
  }

  const ids = new Set();
  const stack = [...(byBefore.get(tabId) || [])];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry?.id || ids.has(entry.id)) {
      continue;
    }
    ids.add(entry.id);
    for (const child of byBefore.get(entry.afterTabId) || []) {
      stack.push(child);
    }
  }
  return [...ids];
}

function collectFutureHistoryEntries(entries, tabId) {
  const futureIds = new Set(collectFutureHistoryEntryIds(entries, tabId));
  return entries.filter(entry => futureIds.has(entry.id));
}

async function deleteStoredPdfTabsByIds(tabIds) {
  const ids = new Set(tabIds.filter(Boolean));
  if (!ids.size) {
    return;
  }
  const tabs = getStoredPdfTabsMetadata();
  const nextTabs = tabs.filter(tab => !ids.has(tab.id));
  if (nextTabs.length !== tabs.length) {
    setStoredPdfTabsMetadata(nextTabs);
  }
  for (const id of ids) {
    await deletePdfBytes(id);
  }
  const activeId = getActivePdfTabId();
  if (ids.has(activeId)) {
    const nextActive = nextTabs.at(-1)?.id || null;
    setActivePdfTab(nextActive);
    const nextActiveTab = nextTabs.find(tab => tab.id === nextActive) || null;
    if (nextActiveTab) {
      sessionStorage.setItem(
        PENDING_PDF_KEY,
        JSON.stringify(stripRuntimePdfData(nextActiveTab))
      );
    } else {
      sessionStorage.removeItem(PENDING_PDF_KEY);
    }
  }
}

async function hydrateStoredPdf(metadata) {
  const normalized = normalizePdfMetadata(metadata);
  if (!normalized) {
    return null;
  }
  if (normalized.bytes) {
    return {
      ...normalized,
      data: base64ToBytes(normalized.bytes),
    };
  }
  const storedBytes = await getPdfBytes(normalized.id);
  if (!storedBytes) {
    return null;
  }
  return {
    ...stripRuntimePdfData(normalized),
    data: new Uint8Array(storedBytes),
  };
}

export function getStoredPdf() {
  const activeTab = getActivePdfTab();
  if (activeTab) {
    return activeTab;
  }

  const storedPdf = sessionStorage.getItem(PENDING_PDF_KEY);
  if (!storedPdf) {
    return null;
  }
  try {
    const metadata = JSON.parse(storedPdf);
    if (!metadata?.bytes) {
      return null;
    }
    return {
      ...metadata,
      data: base64ToBytes(metadata.bytes),
    };
  } catch {
    return null;
  }
}

function getStoredPdfTabsMetadata() {
  const storage = getPdfSessionStore();
  let storedTabs = storage.getItem(PDF_TABS_KEY);
  if (!storedTabs && storage === localStorage) {
    storedTabs = sessionStorage.getItem(PDF_TABS_KEY);
    if (storedTabs) {
      localStorage.setItem(PDF_TABS_KEY, storedTabs);
    }
  }
  if (!storedTabs) {
    return [];
  }
  try {
    const parsed = JSON.parse(storedTabs);
    return Array.isArray(parsed)
      ? parsed.map(normalizePdfMetadata).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function setStoredPdfTabsMetadata(tabs) {
  const storage = getPdfSessionStore();
  const keepSessionBytes = storage === sessionStorage;
  const safeTabs = tabs
    .map(tab =>
      stripRuntimePdfData(tab, {
        keepSessionBytes: keepSessionBytes && tab?.storage === "session",
      })
    )
    .filter(Boolean);
  storage.setItem(PDF_TABS_KEY, JSON.stringify(safeTabs));
  if (storage === sessionStorage) {
    localStorage.removeItem(PDF_TABS_KEY);
  } else {
    sessionStorage.setItem(PDF_TABS_KEY, JSON.stringify(safeTabs));
  }
}

async function migrateLegacySessionTabs(tabs) {
  const migratedTabs = [];
  for (const tab of tabs) {
    if (!tab.bytes) {
      migratedTabs.push(tab);
      continue;
    }
    const bytes = base64ToBytes(tab.bytes);
    try {
      await putPdfBytes(tab.id, bytes.buffer.slice(0));
      migratedTabs.push({
        ...stripRuntimePdfData(tab),
        storage: "indexeddb",
      });
    } catch {
      memoryPdfBytes.set(tab.id, bytes.buffer.slice(0));
      migratedTabs.push({
        ...stripRuntimePdfData(tab),
        storage: "memory",
      });
    }
  }
  return migratedTabs;
}

export function getStoredPdfTabs() {
  return getStoredPdfTabsMetadata().map(stripRuntimePdfData).filter(Boolean);
}

export function getActivePdfTabId() {
  const storage = getPdfSessionStore();
  const activeId = storage.getItem(ACTIVE_PDF_TAB_KEY);
  if (activeId || storage === sessionStorage) {
    return activeId || null;
  }
  const legacyActiveId = sessionStorage.getItem(ACTIVE_PDF_TAB_KEY);
  if (legacyActiveId) {
    localStorage.setItem(ACTIVE_PDF_TAB_KEY, legacyActiveId);
  }
  return legacyActiveId || null;
}

export function setActivePdfTab(id) {
  const storage = getPdfSessionStore();
  if (id) {
    storage.setItem(ACTIVE_PDF_TAB_KEY, id);
  } else {
    storage.removeItem(ACTIVE_PDF_TAB_KEY);
  }
  if (storage === sessionStorage) {
    localStorage.removeItem(ACTIVE_PDF_TAB_KEY);
  } else if (id) {
    sessionStorage.setItem(ACTIVE_PDF_TAB_KEY, id);
  } else {
    sessionStorage.removeItem(ACTIVE_PDF_TAB_KEY);
  }
}

export function getActivePdfTab() {
  const tabs = getStoredPdfTabs();
  if (tabs.length === 0) {
    return null;
  }
  const activeId = getActivePdfTabId();
  return tabs.find(tab => tab.id === activeId) || tabs[tabs.length - 1];
}

export async function getStoredPdfAsync() {
  const tabs = getStoredPdfTabsMetadata();
  const activeId = getActivePdfTabId();
  const activeTab = tabs.find(tab => tab.id === activeId) || tabs.at(-1);
  if (activeTab) {
    return hydrateStoredPdf(activeTab);
  }

  const storedPdf = sessionStorage.getItem(PENDING_PDF_KEY);
  if (!storedPdf) {
    return null;
  }
  try {
    return hydrateStoredPdf(JSON.parse(storedPdf));
  } catch {
    return null;
  }
}

export async function getStoredPdfTabAsync(id) {
  if (!id) {
    return null;
  }
  const tabs = getStoredPdfTabsMetadata();
  const tab = tabs.find(item => item.id === id);
  return hydrateStoredPdf(tab);
}

export async function storePdfFile(file, options = {}) {
  const buffer = await file.arrayBuffer();
  const id = createPdfId();
  const rememberRecentDocuments = shouldRememberRecentDocuments();
  const metadata = {
    id,
    historyDocumentId: options.historyDocumentId || id,
    name: file.name,
    openedAt: Date.now(),
    parentTabId: options.parentTabId || null,
    size: file.size,
    source: options.source || null,
    storage: rememberRecentDocuments ? "indexeddb" : "session",
    type: file.type || "application/pdf",
  };
  if (rememberRecentDocuments) {
    try {
      await putPdfBytes(id, buffer);
    } catch (reason) {
      console.warn("Viewer Next IndexedDB PDF storage failed; using memory fallback.", reason);
      memoryPdfBytes.set(id, buffer.slice(0));
      metadata.storage = "memory";
    }
  } else {
    metadata.bytes = arrayBufferToBase64(buffer);
  }
  const existingTabs = getStoredPdfTabsMetadata();
  const tabs = [
    ...(rememberRecentDocuments
      ? await migrateLegacySessionTabs(existingTabs)
      : existingTabs),
    metadata,
  ];
  try {
    setStoredPdfTabsMetadata(tabs);
  } catch (reason) {
    if (rememberRecentDocuments) {
      throw reason;
    }
    metadata.storage = "memory";
    delete metadata.bytes;
    memoryPdfBytes.set(id, buffer.slice(0));
    setStoredPdfTabsMetadata([...existingTabs, metadata]);
  }
  setActivePdfTab(metadata.id);
  try {
    sessionStorage.setItem(
      PENDING_PDF_KEY,
      JSON.stringify(
        stripRuntimePdfData(metadata, {
          keepSessionBytes: metadata.storage === "session",
        })
      )
    );
  } catch (reason) {
    if (metadata.storage !== "session") {
      throw reason;
    }
    metadata.storage = "memory";
    delete metadata.bytes;
    memoryPdfBytes.set(id, buffer.slice(0));
    setStoredPdfTabsMetadata([...existingTabs, metadata]);
    sessionStorage.setItem(
      PENDING_PDF_KEY,
      JSON.stringify(stripRuntimePdfData(metadata))
    );
  }
  emitPdfStorageChanged();
  return {
    ...metadata,
    data: new Uint8Array(buffer),
  };
}

export async function removeStoredPdfTab(id) {
  const tabs = getStoredPdfTabsMetadata();
  const nextTabs = tabs.filter(tab => tab.id !== id);
  await deletePdfHistoryEntriesForTab(id);
  setStoredPdfTabsMetadata(nextTabs);
  await deletePdfBytes(id);
  const activeId = getActivePdfTabId();
  if (activeId === id) {
    const nextActive = nextTabs.at(-1)?.id || null;
    setActivePdfTab(nextActive);
    const nextActiveTab = nextTabs.find(tab => tab.id === nextActive) || null;
    if (nextActiveTab) {
      sessionStorage.setItem(PENDING_PDF_KEY, JSON.stringify(stripRuntimePdfData(nextActiveTab)));
    } else {
      sessionStorage.removeItem(PENDING_PDF_KEY);
    }
  }
  emitPdfStorageChanged();
}

export function disablePersistentPdfSession() {
  const localTabs = localStorage.getItem(PDF_TABS_KEY);
  const localActiveId = localStorage.getItem(ACTIVE_PDF_TAB_KEY);
  if (!sessionStorage.getItem(PDF_TABS_KEY) && localTabs) {
    sessionStorage.setItem(PDF_TABS_KEY, localTabs);
  }
  if (!sessionStorage.getItem(ACTIVE_PDF_TAB_KEY) && localActiveId) {
    sessionStorage.setItem(ACTIVE_PDF_TAB_KEY, localActiveId);
  }
  removePdfSessionKeys(localStorage);
  emitPdfStorageChanged();
}

export async function clearLocalPdfData() {
  removePdfSessionKeys(localStorage);
  removePdfSessionKeys(sessionStorage);
  memoryPdfBytes.clear();
  await deletePdfStorageDatabase();
  emitPdfStorageChanged();
}

export async function getPdfHistoryEntries(documentId) {
  try {
    return await getHistoryEntriesByDocument(documentId);
  } catch (reason) {
    console.warn("Viewer Next PDF history read failed.", reason);
    return [];
  }
}

export async function appendPdfHistoryEntry(entry) {
  const normalizedEntry = {
    id: entry.id || createHistoryId(),
    documentId: entry.documentId,
    timestamp: entry.timestamp || Date.now(),
    label: entry.label || "PDF edit",
    type: entry.type || "edit",
    strategy: entry.strategy || "revision",
    beforeTabId: entry.beforeTabId || null,
    afterTabId: entry.afterTabId || null,
    payload: entry.payload || null,
  };
  const isRevision = normalizedEntry.strategy === "revision";
  if (
    !normalizedEntry.documentId ||
    (isRevision && (!normalizedEntry.beforeTabId || !normalizedEntry.afterTabId))
  ) {
    return null;
  }

  try {
    const entries = await getHistoryEntriesByDocument(normalizedEntry.documentId);
    if (isRevision) {
      const futureEntries = collectFutureHistoryEntries(
        entries,
        normalizedEntry.beforeTabId
      );
      await deleteHistoryEntryIds(futureEntries.map(entry => entry.id));
      await deleteStoredPdfTabsByIds(
        futureEntries.map(entry => entry.afterTabId)
      );
    }
    await runStoreTransaction(PDF_HISTORY_STORE, "readwrite", store =>
      store.put(normalizedEntry)
    );
    return normalizedEntry;
  } catch (reason) {
    console.warn("Viewer Next PDF history write failed.", reason);
    return null;
  }
}

export async function clearPdfHistoryEntries(documentId) {
  if (!documentId) {
    return;
  }
  try {
    const entries = await getHistoryEntriesByDocument(documentId);
    await deleteHistoryEntryIds(entries.map(entry => entry.id));
  } catch (reason) {
    console.warn("Viewer Next PDF history clear failed.", reason);
  }
}

export async function deletePdfHistoryEntriesForTab(tabId) {
  if (!tabId) {
    return;
  }
  try {
    const tabs = getStoredPdfTabsMetadata();
    const documentIds = new Set(
      tabs
        .filter(tab => tab.id === tabId || tab.parentTabId === tabId)
        .map(tab => tab.historyDocumentId || tab.id)
    );
    const activeTab = tabs.find(tab => tab.id === tabId);
    if (activeTab) {
      documentIds.add(activeTab.historyDocumentId || activeTab.id);
    }
    const entryIds = [];
    for (const documentId of documentIds) {
      const entries = await getHistoryEntriesByDocument(documentId);
      for (const entry of entries) {
        if (entry.beforeTabId === tabId || entry.afterTabId === tabId) {
          entryIds.push(entry.id);
        }
      }
    }
    await deleteHistoryEntryIds(entryIds);
  } catch (reason) {
    console.warn("Viewer Next PDF history cleanup failed.", reason);
  }
}

export function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "PDF Document";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `PDF Document - ${value.toFixed(precision)} ${units[unitIndex]}`;
}
