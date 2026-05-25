import { useCallback, useEffect, useMemo, useState } from "react";

export const viewerNextPreferencesStorageKey =
  "rewirepdf.viewerNext.preferences";

export const defaultViewerNextPreferences = Object.freeze({
  defaultExportFilename: "{name}-edited.pdf",
  rememberRecentDocuments: true,
});

const preferencesChangedEvent = "viewer-next-preferences-changed";

function readPreferenceRecord() {
  try {
    const raw = window.localStorage?.getItem(viewerNextPreferencesStorageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeDefaultExportFilename(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || defaultViewerNextPreferences.defaultExportFilename;
}

export function normalizeViewerNextPreferences(value = {}) {
  return {
    defaultExportFilename: normalizeDefaultExportFilename(
      value.defaultExportFilename
    ),
    rememberRecentDocuments: normalizeBoolean(
      value.rememberRecentDocuments,
      defaultViewerNextPreferences.rememberRecentDocuments
    ),
  };
}

function emitPreferencesChanged(preferences) {
  window.dispatchEvent(
    new CustomEvent(preferencesChangedEvent, { detail: preferences })
  );
}

export function getViewerNextPreferences() {
  return normalizeViewerNextPreferences(readPreferenceRecord());
}

export function setViewerNextPreferences(nextPreferences) {
  const preferences = normalizeViewerNextPreferences({
    ...getViewerNextPreferences(),
    ...nextPreferences,
  });
  window.localStorage?.setItem(
    viewerNextPreferencesStorageKey,
    JSON.stringify(preferences)
  );
  emitPreferencesChanged(preferences);
  return preferences;
}

export function resetViewerNextPreferences() {
  try {
    window.localStorage?.removeItem(viewerNextPreferencesStorageKey);
  } catch {
    // Preferences fall back to defaults when local storage is unavailable.
  }
  const preferences = { ...defaultViewerNextPreferences };
  emitPreferencesChanged(preferences);
  return preferences;
}

export function shouldRememberRecentDocuments() {
  return getViewerNextPreferences().rememberRecentDocuments;
}

function getBasePdfName(filename = "document.pdf") {
  const normalized = String(filename || "document.pdf").trim() || "document.pdf";
  return normalized.replace(/\.pdf$/i, "");
}

function getDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function buildExportFilename(filename = "document.pdf") {
  const preferences = getViewerNextPreferences();
  const baseName = getBasePdfName(filename);
  const pattern = normalizeDefaultExportFilename(
    preferences.defaultExportFilename
  );
  const nextFilename = pattern
    .replaceAll("{name}", baseName)
    .replaceAll("{date}", getDateStamp())
    .trim();
  return /\.pdf$/i.test(nextFilename) ? nextFilename : `${nextFilename}.pdf`;
}

export function useViewerNextPreferences() {
  const [preferences, setPreferencesState] = useState(getViewerNextPreferences);

  useEffect(() => {
    const updatePreferences = event => {
      setPreferencesState(
        normalizeViewerNextPreferences(event.detail || readPreferenceRecord())
      );
    };
    const updateFromStorage = event => {
      if (event.key === viewerNextPreferencesStorageKey) {
        setPreferencesState(getViewerNextPreferences());
      }
    };
    window.addEventListener(preferencesChangedEvent, updatePreferences);
    window.addEventListener("storage", updateFromStorage);
    return () => {
      window.removeEventListener(preferencesChangedEvent, updatePreferences);
      window.removeEventListener("storage", updateFromStorage);
    };
  }, []);

  const updatePreferences = useCallback(nextPreferences => {
    setPreferencesState(setViewerNextPreferences(nextPreferences));
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferencesState(resetViewerNextPreferences());
  }, []);

  return useMemo(
    () => ({
      preferences,
      resetPreferences,
      updatePreferences,
    }),
    [preferences, resetPreferences, updatePreferences]
  );
}
