import { Icon } from "../Icon.jsx";
import { getPdfActionPolicy } from "../../app/pdfActionPolicy.js";
import { useTranslation } from "../../i18n/index.js";
import { PageOrganizerThumbnails } from "./PageOrganizerThumbnails.jsx";

export function PageOrganizerWorkspace({
  isApplying = false,
  onApply,
  onExport,
  onGoToPage,
  pageOrganizer,
  pagePreviews,
  viewerState,
}) {
  const { t } = useTranslation();
  const organizePolicy = getPdfActionPolicy(
    "organize-pages",
    {
      hasDocument: Boolean(viewerState.pagesCount),
      loading: viewerState.loading,
      pdfSecurity: viewerState.pdfSecurity,
    },
    t
  );
  const actionDisabled =
    !pageOrganizer.hasDraftChanges || isApplying || !organizePolicy.enabled;

  return (
    <section
      className="page-organizer-workspace"
      aria-label={t("Organizza pagine")}
    >
      <div className="page-organizer-canvas">
        <div className="page-organizer-canvas-header">
          <div className="page-organizer-heading">
            <strong>
              {pageOrganizer.hasDraftChanges
                ? t("Ordine modificato")
                : t("Ordine documento")}
            </strong>
            <span>
              {pageOrganizer.insertions?.length
                ? t("{{count}} inserimenti nella bozza", {
                    count: pageOrganizer.insertions.length,
                  })
                : pageOrganizer.replacements?.length
                ? t("{{count}} sostituzioni nella bozza", {
                    count: pageOrganizer.replacements.length,
                  })
                : pageOrganizer.selectedCount
                ? t("{{count}} selezionate", {
                    count: pageOrganizer.selectedCount,
                  })
                : t("{{count}} pagine", { count: viewerState.pagesCount || 0 })}
            </span>
          </div>
          <div className="page-organizer-commit-actions">
            <button
              disabled={actionDisabled}
              onClick={onApply}
              title={
                organizePolicy.enabled ? t("Applica") : organizePolicy.reason
              }
              type="button"
            >
              <Icon>check</Icon>
              {t("Applica")}
            </button>
            <button
              disabled={actionDisabled}
              onClick={onExport}
              title={
                organizePolicy.enabled ? t("Esporta") : organizePolicy.reason
              }
              type="button"
            >
              <Icon>ios_share</Icon>
              {t("Esporta")}
            </button>
          </div>
          <button
            disabled={!pageOrganizer.hasDraftChanges || isApplying}
            onClick={pageOrganizer.resetDraftOrder}
            type="button"
          >
            <Icon>undo</Icon>
            {t("Ripristina ordine")}
          </button>
        </div>
        <PageOrganizerThumbnails
          onGoToPage={onGoToPage}
          pageOrganizer={pageOrganizer}
          pagePreviews={pagePreviews}
          viewerState={viewerState}
        />
        {pageOrganizer.status ? (
          <div className="page-organizer-status" role="status">
            {pageOrganizer.status}
          </div>
        ) : null}
      </div>
    </section>
  );
}
