import { useEffect, useState } from "react";

export function usePagePreviewSnapshots({
  documentKey,
  enabled,
  getPageThumbnails,
  pageNumber,
  pagesCount,
}) {
  const [pagePreviews, setPagePreviews] = useState({});

  useEffect(() => {
    setPagePreviews({});
  }, [documentKey]);

  useEffect(() => {
    if (!enabled || !pagesCount) {
      return undefined;
    }

    let cancelled = false;
    function applyPreviews(previews) {
      if (!cancelled) {
        setPagePreviews(previews || {});
      }
    }

    applyPreviews(getPageThumbnails(applyPreviews));
    const refresh = window.setTimeout(() => {
      applyPreviews(getPageThumbnails(applyPreviews));
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(refresh);
    };
  }, [enabled, getPageThumbnails, pageNumber, pagesCount]);

  return pagePreviews;
}
