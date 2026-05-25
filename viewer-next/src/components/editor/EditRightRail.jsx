import { useEffect, useState } from "react";

import { getPdfActionPolicy } from "../../app/pdfActionPolicy.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";

export function EditRightRail({
  activeEditorPanel,
  onFitPageWidth,
  onGoToPage,
  onOpenEditorPanel,
  onNextPage,
  onPreviousPage,
  onRotateClockwise,
  onZoomIn,
  onZoomOut,
  viewerState,
}) {
  const { t } = useTranslation();
  const pagesCount = viewerState.pagesCount || 0;
  const pageNumber = viewerState.pageNumber || 1;
  const hasSignatureNotice = Boolean(
    viewerState.pdfSecurity?.signatures?.hasDigitalSignatures
  );
  const hasPermissionNotice = Boolean(
    viewerState.pdfSecurity?.permissions?.hasRestrictions
  );
  const rotatePolicy = getPdfActionPolicy(
    "rotate-page",
    {
      hasDocument: Boolean(pagesCount),
      loading: viewerState.loading,
      pdfSecurity: viewerState.pdfSecurity,
    },
    t
  );
  const [pageInput, setPageInput] = useState(String(pageNumber));

  useEffect(() => {
    setPageInput(String(pageNumber));
  }, [pageNumber]);

  const commitPageInput = () => {
    const nextPage = Number.parseInt(pageInput, 10);

    if (!Number.isInteger(nextPage)) {
      setPageInput(String(pageNumber));
      return;
    }

    const boundedPage = Math.min(Math.max(nextPage, 1), pagesCount || nextPage);
    setPageInput(String(boundedPage));

    if (boundedPage !== pageNumber) {
      onGoToPage?.(boundedPage);
    }
  };

  return (
    <aside className="edit-right-rail" aria-label={t("PDF controls")}>
      <div className="rail-group">
        <button
          aria-expanded={activeEditorPanel === "search"}
          aria-label={t("Cerca")}
          className={activeEditorPanel === "search" ? "expanded" : ""}
          onClick={() => onOpenEditorPanel("search")}
          title={t("Cerca")}
        >
          <Icon>search</Icon>
        </button>
        <button
          aria-label={t("Comments")}
          className={activeEditorPanel === "comments" ? "expanded" : ""}
          onClick={() => onOpenEditorPanel("comments")}
          title={t("Comments")}
        >
          <Icon>comment</Icon>
        </button>
        <button
          aria-label={t("Bookmarks")}
          className={activeEditorPanel === "bookmarks" ? "expanded" : ""}
          onClick={() => onOpenEditorPanel("bookmarks")}
          title={t("Bookmarks")}
        >
          <Icon>bookmark</Icon>
        </button>
        <button
          aria-label={t("Page thumbnails")}
          className={activeEditorPanel === "pages" ? "expanded" : ""}
          onClick={() => onOpenEditorPanel("pages")}
          title={t("Page thumbnails")}
        >
          <Icon>view_sidebar</Icon>
        </button>
        <button
          aria-label={t("Storico modifiche")}
          className={activeEditorPanel === "history" ? "expanded" : ""}
          onClick={() => onOpenEditorPanel("history")}
          title={t("Storico modifiche")}
        >
          <Icon>history</Icon>
        </button>
        <button
          aria-label={t("Firma digitale")}
          className={[
            activeEditorPanel === "signatures" ? "expanded" : "",
            hasSignatureNotice ? "has-security-notice" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onOpenEditorPanel("signatures")}
          title={t("Firma digitale")}
        >
          <Icon>{hasSignatureNotice ? "gpp_maybe" : "verified_user"}</Icon>
        </button>
        <button
          aria-label={t("Autorizzazioni file")}
          className={[
            activeEditorPanel === "permissions" ? "expanded" : "",
            hasPermissionNotice ? "has-security-notice" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onOpenEditorPanel("permissions")}
          title={t("Autorizzazioni file")}
        >
          <Icon>{hasPermissionNotice ? "lock" : "lock_open"}</Icon>
        </button>
      </div>
      <div className="rail-group page-rail-group">
        <span
          className="rail-page-pill"
          title={t("Page {{page}} of {{count}}", {
            count: pagesCount || "?",
            page: pageNumber,
          })}
        >
          <input
            aria-label={t("Page number")}
            className="rail-page-input"
            inputMode="numeric"
            onBlur={commitPageInput}
            onChange={event => {
              setPageInput(event.target.value.replace(/\D/g, ""));
            }}
            onFocus={event => event.target.select()}
            onKeyDown={event => {
              event.stopPropagation();

              if (event.key === "Enter") {
                commitPageInput();
                event.currentTarget.blur();
              }

              if (event.key === "Escape") {
                setPageInput(String(pageNumber));
                event.currentTarget.blur();
              }
            }}
            pattern="[0-9]*"
            title={t("Page number")}
            type="text"
            value={pageInput}
          />
          <span className="rail-page-total">{pagesCount || "?"}</span>
        </span>
        <button
          aria-label={t("Previous page")}
          disabled={pageNumber <= 1}
          onClick={onPreviousPage}
          title={t("Previous page")}
        >
          <Icon>keyboard_arrow_up</Icon>
        </button>
        <button
          aria-label={t("Next page")}
          disabled={pagesCount > 0 && pageNumber >= pagesCount}
          onClick={onNextPage}
          title={t("Next page")}
        >
          <Icon>keyboard_arrow_down</Icon>
        </button>
      </div>
      <div className="rail-group">
        <button
          aria-label={t("Rotate clockwise")}
          disabled={!rotatePolicy.enabled}
          onClick={onRotateClockwise}
          title={
            rotatePolicy.enabled ? t("Rotate clockwise") : rotatePolicy.reason
          }
        >
          <Icon>rotate_right</Icon>
        </button>
        <button aria-label={t("Fit page width")} onClick={onFitPageWidth} title={t("Fit page width")}>
          <Icon>fit_screen</Icon>
        </button>
        <button aria-label={t("Zoom in")} onClick={onZoomIn} title={t("Zoom in")}>
          <Icon>add</Icon>
        </button>
        <button aria-label={t("Zoom out")} onClick={onZoomOut} title={t("Zoom out")}>
          <Icon>remove</Icon>
        </button>
      </div>
    </aside>
  );
}
