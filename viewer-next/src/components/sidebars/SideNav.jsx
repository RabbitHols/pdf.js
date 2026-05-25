import { convertSideActions } from "../../app/toolData.js";
import { toolViewIds } from "../../app/viewRouting.js";
import { useTranslation } from "../../i18n/index.js";
import { formatBytes } from "../../pdf/pdfStorage.js";
import { Icon } from "../Icon.jsx";
import { PageOrganizerSideNav } from "../page-organizer/PageOrganizerSideNav.jsx";
import { DocumentContextSideNav } from "./DocumentContextSideNav.jsx";
import { EditSideNav } from "./EditSideNav.jsx";
import { EditorContextSideNav } from "./EditorContextSideNav.jsx";
import { SignSideNav } from "./SignSideNav.jsx";
import { StampSideNav } from "./StampSideNav.jsx";
import { ToolContextSideNav } from "./ToolContextSideNav.jsx";

export function SideNav({
  activeTool,
  activeEditorPanel,
  activePdfTabId,
  contextSidebarOpen,
  documentPanelOpen,
  documentInfo,
  editHistory,
  navigate,
  onAddImage,
  onAddCommentToSelection,
  onCancelPendingComment,
  onClose,
  onCloseDocumentPanel,
  onClosePageOrganizer,
  onClosePdfTab,
  onCreateFile,
  onExtractPages,
  onSplitPages,
  onAddBookmarkFromSelection,
  onClearHistory,
  onCloseEditorPanel,
  onDeleteBookmark,
  onDeleteSavedSignature,
  onGoToBookmark,
  onGoToComment,
  onGoToPage,
  onGoToSearchResult,
  onOpenFullOrganizer,
  onOpenExtractPages,
  onOpenSignatureDialog,
  onListSavedSignatures,
  onOpenEditorPanel,
  onDeleteCurrentPage,
  onDeleteSelection,
  onDrawStyleChange,
  onRunEditorAction,
  onRotateClockwise,
  onRedo,
  onSavePendingComment,
  onSearch,
  onSelectHistoryEntry,
  onSetStampSelection,
  onSetTool,
  onTextStyleChange,
  onSelectPdfTab,
  onUndo,
  onUpdateBookmarkTitle,
  onUseSavedSignature,
  pdfTabs,
  pageOrganizer,
  pageOrganizerInitialDialog,
  pageOrganizerMode,
  pagePreviews,
  textStyle,
  viewerState,
  view,
}) {
  const { t } = useTranslation();
  const isStampPanelActive = activeEditorPanel === "stamps";
  const editorContextPanel =
    activeEditorPanel && !isStampPanelActive ? (
      <EditorContextSideNav
        activePanel={activeEditorPanel}
        editHistory={editHistory}
        onClose={onCloseEditorPanel}
        onCancelPendingComment={onCancelPendingComment}
        onAddCommentToSelection={onAddCommentToSelection}
        onAddBookmarkFromSelection={onAddBookmarkFromSelection}
        onClearHistory={onClearHistory}
        onDeleteBookmark={onDeleteBookmark}
        onGoToBookmark={onGoToBookmark}
        onGoToComment={onGoToComment}
        onGoToPage={onGoToPage}
        onGoToSearchResult={onGoToSearchResult}
        onOpenFullOrganizer={onOpenFullOrganizer}
        onDeleteSelection={onDeleteSelection}
        onRedo={onRedo}
        onSavePendingComment={onSavePendingComment}
        onSearch={onSearch}
        onSelectHistoryEntry={onSelectHistoryEntry}
        onSetTool={onSetTool}
        onUndo={onUndo}
        onUpdateBookmarkTitle={onUpdateBookmarkTitle}
        pageOrganizer={pageOrganizer}
        pagePreviews={pagePreviews}
        viewerState={viewerState}
      />
    ) : null;

  if (documentPanelOpen) {
    return (
      <>
        <DocumentContextSideNav
          activePdfTabId={activePdfTabId}
          navigate={navigate}
          onClose={onCloseDocumentPanel}
          onClosePdfTab={onClosePdfTab}
          onCreateFile={onCreateFile}
          onSelectPdfTab={onSelectPdfTab}
          pdfTabs={pdfTabs}
        />
        {editorContextPanel}
      </>
    );
  }

  if (view === "home") {
    return null;
  }
  if (!contextSidebarOpen && toolViewIds.has(view)) {
    return editorContextPanel;
  }
  if (view === "all-tools") {
    return null;
  }
  if (view === "edit") {
    if (isStampPanelActive) {
      return (
        <StampSideNav
          onClose={onCloseEditorPanel}
          onSetStampSelection={onSetStampSelection}
        />
      );
    }
    if (pageOrganizerMode === "full") {
      return (
        <PageOrganizerSideNav
          initialDialog={pageOrganizerInitialDialog}
          onClose={onClosePageOrganizer}
          onExtractPages={onExtractPages}
          onSplitPages={onSplitPages}
          pageOrganizer={pageOrganizer}
          viewerState={viewerState}
        />
      );
    }
    return (
      <>
        <EditSideNav
          activeContextPanel={activeEditorPanel}
          activeTool={activeTool}
          pageOrganizerMode={pageOrganizerMode}
          onAddImage={onAddImage}
          onOpenExtractPages={onOpenExtractPages}
          onOpenFullOrganizer={onOpenFullOrganizer}
          onClose={onClose}
          onDeleteCurrentPage={onDeleteCurrentPage}
          onDrawStyleChange={onDrawStyleChange}
          onNavigate={navigate}
          onOpenContextPanel={onOpenEditorPanel}
          onRotateClockwise={onRotateClockwise}
          onSetTool={onSetTool}
          onTextStyleChange={onTextStyleChange}
          drawStyle={viewerState.draw?.style}
          textStyle={textStyle}
          viewerState={viewerState}
        />
        {editorContextPanel}
      </>
    );
  }
  if (view === "convert") {
    return (
      <ToolContextSideNav
        actions={convertSideActions}
        hasDocument={Boolean(documentInfo)}
        navigate={navigate}
        onClose={onClose}
        onRunEditorAction={onRunEditorAction}
        title={t("Converti")}
        viewerState={viewerState}
      />
    );
  }
  if (view === "options") {
    return null;
  }
  if (view === "combine") {
    return null;
  }
  if (view === "sign") {
    return (
      <>
        <SignSideNav
          onClose={onClose}
          onDeleteSavedSignature={onDeleteSavedSignature}
          onListSavedSignatures={onListSavedSignatures}
          onOpenSignatureDialog={onOpenSignatureDialog}
          onUseSavedSignature={onUseSavedSignature}
          viewerState={viewerState}
        />
        {editorContextPanel}
      </>
    );
  }

  const isConvert = view === "convert";
  return (
    <aside className="sidenav">
      <div className="document-card">
        <div className="document-icon">
          <Icon>description</Icon>
        </div>
        <div>
          <strong>
            {documentInfo?.name || (isConvert ? "DOCUMENT" : "REWIREPDF")}
          </strong>
          <span>
            {documentInfo
              ? formatBytes(documentInfo.size)
              : t("No PDF selected")}
          </span>
        </div>
      </div>
      <div className="side-section">
        <p>{isConvert ? t("Document") : t("Tools")}</p>
        <button
          className={view === "edit" || view === "home" ? "active" : ""}
          onClick={() => navigate("edit")}
        >
          <Icon>edit</Icon>
          {t("Edit PDF")}
        </button>
        <button>
          <Icon>note_add</Icon>
          {t("Create PDF")}
        </button>
        <button>
          <Icon>library_add</Icon>
          {t("Combine Files")}
        </button>
        <button>
          <Icon>grid_view</Icon>
          {t("Organize Pages")}
        </button>
      </div>
      <div className="side-footer">
        <button>
          <Icon>settings</Icon>
          {t("Settings")}
        </button>
        <button>
          <Icon>support_agent</Icon>
          {t("Report a bug")}
        </button>
      </div>
    </aside>
  );
}
