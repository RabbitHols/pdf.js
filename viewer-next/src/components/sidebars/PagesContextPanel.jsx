import { useState } from "react";
import { getPdfActionPolicy } from "../../app/pdfActionPolicy.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";
import {
  PageManageMenu,
  PageSelectionControls,
} from "../page-organizer/PageOrganizerControls.jsx";
import { PageOrganizerThumbnails } from "../page-organizer/PageOrganizerThumbnails.jsx";

export function PagesContextPanel({
  onGoToPage,
  onOpenFullOrganizer,
  pageOrganizer,
  pagePreviews,
  viewerState,
}) {
  const { t } = useTranslation();
  const [isManageOpen, setIsManageOpen] = useState(false);
  const organizePolicy = getPdfActionPolicy(
    "organize-pages",
    {
      hasDocument: Boolean(viewerState.pagesCount),
      loading: viewerState.loading,
      pdfSecurity: viewerState.pdfSecurity,
    },
    t
  );

  return (
    <div className="editor-context-content pages-context-panel quick-pages-panel">
      <div className="quick-pages-status">
        <PageSelectionControls
          currentPage={viewerState.pageNumber || 1}
          pageOrganizer={pageOrganizer}
        />
        <PageManageMenu
          isOpen={isManageOpen}
          onToggle={() => setIsManageOpen(open => !open)}
          pageOrganizer={pageOrganizer}
        />
      </div>
      <button
        className="quick-pages-full-button"
        disabled={!organizePolicy.enabled}
        onClick={onOpenFullOrganizer}
        title={
          organizePolicy.enabled
            ? t("Apri Organizza pagine")
            : organizePolicy.reason
        }
        type="button"
      >
        <Icon>grid_view</Icon>
        {t("Apri Organizza pagine")}
      </button>
      <PageOrganizerThumbnails
        compact
        onGoToPage={onGoToPage}
        pageOrganizer={pageOrganizer}
        pagePreviews={pagePreviews}
        viewerState={viewerState}
      />
      {pageOrganizer.status ? (
        <div className="quick-pages-note" role="status">
          {pageOrganizer.status}
        </div>
      ) : null}
    </div>
  );
}
