export const showUnimplementedToolsStorageKey =
  "rewirepdf.viewerNext.showUnimplementedPageTools";

export function shouldShowUnimplementedTools() {
  try {
    const value = window.localStorage
      ?.getItem(showUnimplementedToolsStorageKey)
      ?.toLowerCase();
    return value === "1" || value === "true" || value === "yes";
  } catch {
    return false;
  }
}

export function setShowUnimplementedTools(enabled) {
  try {
    if (enabled) {
      window.localStorage?.setItem(showUnimplementedToolsStorageKey, "true");
    } else {
      window.localStorage?.removeItem(showUnimplementedToolsStorageKey);
    }
    window.dispatchEvent(
      new CustomEvent("viewer-next-debug-settings-changed", {
        detail: { showUnimplementedTools: Boolean(enabled) },
      })
    );
  } catch {
    // Debug settings are optional and remain disabled if storage is unavailable.
  }
}
