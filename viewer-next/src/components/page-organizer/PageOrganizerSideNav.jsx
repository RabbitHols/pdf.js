import { Icon } from "../Icon.jsx";
import { useTranslation } from "../../i18n/index.js";
import { useEffect, useState } from "react";
import {
  PageOrganizerActionList,
  PageOperationButtons,
  PageSelectionControls,
  ExtractPagesDialog,
  InsertPagesDialog,
  ReplacePagesDialog,
  SplitPagesDialog,
} from "./PageOrganizerControls.jsx";

export function PageOrganizerSideNav({
  initialDialog = null,
  onClose,
  onExtractPages,
  onSplitPages,
  pageOrganizer,
  viewerState,
}) {
  const { t } = useTranslation();
  const [extractDialogOpen, setExtractDialogOpen] = useState(false);
  const [insertDialogOpen, setInsertDialogOpen] = useState(false);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);

  useEffect(() => {
    if (initialDialog === "extract") {
      setExtractDialogOpen(true);
    }
  }, [initialDialog]);

  const organizerActions = {
    ...pageOrganizer,
    openExtractDialog: () => setExtractDialogOpen(true),
    openInsertDialog: () => setInsertDialogOpen(true),
    openReplaceDialog: () => setReplaceDialogOpen(true),
    openSplitDialog: () => setSplitDialogOpen(true),
  };

  return (
    <>
      <aside
        className="sidenav page-organizer-options"
        aria-label={t("Organizza pagine")}
      >
        <div className="page-organizer-options-header">
          <button
            aria-label={t("Torna agli strumenti modifica")}
            onClick={onClose}
            type="button"
          >
            <Icon>arrow_back</Icon>
          </button>
          <h2>{t("Organizza pagine")}</h2>
        </div>
        <PageSelectionControls
          currentPage={viewerState.pageNumber || 1}
          pageOrganizer={pageOrganizer}
        />
        <div className="page-organizer-section">
          <p>{t("Opzioni pagina")}</p>
          <PageOperationButtons
            currentPage={viewerState.pageNumber || 1}
            pageOrganizer={organizerActions}
            viewerState={viewerState}
          />
          <PageOrganizerActionList
            pageOrganizer={organizerActions}
            viewerState={viewerState}
          />
        </div>
        <div className="page-organizer-draft">
          <strong>{t("Modifiche PDF")}</strong>
          <span>
            {t(
              "Riordina, ruota, elimina, inserisci o sostituisci pagine, poi applica al documento o esporta una copia."
            )}
          </span>
        </div>
      </aside>
      {extractDialogOpen ? (
        <ExtractPagesDialog
          currentPage={viewerState.pageNumber || 1}
          onClose={() => setExtractDialogOpen(false)}
          onExtractPages={onExtractPages}
          pageOrganizer={pageOrganizer}
        />
      ) : null}
      {insertDialogOpen ? (
        <InsertPagesDialog
          currentPage={viewerState.pageNumber || 1}
          onClose={() => setInsertDialogOpen(false)}
          pageOrganizer={pageOrganizer}
          pagesCount={pageOrganizer.draftOrder.length}
          viewerState={viewerState}
        />
      ) : null}
      {replaceDialogOpen ? (
        <ReplacePagesDialog
          currentPage={viewerState.pageNumber || 1}
          onClose={() => setReplaceDialogOpen(false)}
          pageOrganizer={pageOrganizer}
          pagesCount={pageOrganizer.draftOrder.length}
        />
      ) : null}
      {splitDialogOpen ? (
        <SplitPagesDialog
          onClose={() => setSplitDialogOpen(false)}
          onSplitPages={onSplitPages}
          pageOrganizer={pageOrganizer}
          pagesCount={pageOrganizer.draftOrder.length}
        />
      ) : null}
    </>
  );
}
