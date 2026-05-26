import {
  editPageActions,
  getVisibleEditContentActions,
  getVisibleEditOptionActions,
  getVisibleEditPageQuickActions,
} from "../../app/toolData.js";
import { shouldShowUnimplementedTools } from "../../app/debugSettings.js";
import {
  getPdfActionPolicy,
  inferPdfActionId,
} from "../../app/pdfActionPolicy.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";
import {
  DrawFormattingPanel,
  isDrawTargetSelected,
} from "./DrawFormattingPanel.jsx";
import { TextFormattingPanel } from "./TextFormattingPanel.jsx";

export function EditSideNav({
  activeContextPanel,
  activeTool,
  pageOrganizerMode,
  onAddImage,
  onClose,
  onNavigate,
  onOpenExtractPages,
  onOpenFullOrganizer,
  onOpenContextPanel,
  onDeleteCurrentPage,
  onRotateClockwise,
  onDrawStyleChange,
  onSetTool,
  onTextStyleChange,
  drawStyle,
  textStyle,
  viewerState,
}) {
  const { t } = useTranslation();
  const interactionState = viewerState.viewerInteractionState || {};
  const contextTarget = interactionState.contextTarget || null;
  const interactionActiveTool = interactionState.activeTool || activeTool;
  const canStyleTarget = Boolean(interactionState.capabilities?.canStyle);
  const isTextToolActive =
    interactionActiveTool === "textbox" || interactionActiveTool === "text";
  const isTextTargetSelected =
    canStyleTarget &&
    (contextTarget?.kind === "freetext" || contextTarget?.kind === "native-text");
  const isDrawTargetActive = isDrawTargetSelected(viewerState);
  const pageQuickActions = getVisibleEditPageQuickActions({
    showDebug: shouldShowUnimplementedTools(),
  });
  const contentActions = getVisibleEditContentActions({
    showDebug: shouldShowUnimplementedTools(),
  });
  const optionActions = getVisibleEditOptionActions({
    showDebug: shouldShowUnimplementedTools(),
  });
  const policyFacts = {
    hasDocument: Boolean(viewerState.pagesCount),
    loading: viewerState.loading,
    pdfSecurity: viewerState.pdfSecurity,
  };

  function getActionPolicy(action) {
    return getPdfActionPolicy(inferPdfActionId(action), policyFacts, t);
  }

  function runAction(action) {
    if (action === "comments-panel") {
      onOpenContextPanel("comments");
      return;
    }
    if (action === "bookmarks-panel") {
      onOpenContextPanel("bookmarks");
      return;
    }
    if (action === "pages-panel") {
      onOpenContextPanel("pages");
      return;
    }
    if (action === "protect-pdf") {
      onOpenContextPanel("protect");
      return;
    }
    if (action === "stamp-palette") {
      onOpenContextPanel("stamps");
      return;
    }
    if (action === "combine-files") {
      onNavigate?.("combine");
      return;
    }
    if (action === "pages-organizer") {
      onOpenFullOrganizer();
      return;
    }
    if (action === "extract-pages") {
      onOpenExtractPages?.();
      return;
    }
    if (action === "rotate") {
      onRotateClockwise();
      return;
    }
    if (action === "delete-page") {
      onDeleteCurrentPage();
      return;
    }
    if (action === "image") {
      onAddImage();
      return;
    }
    if (action) {
      onSetTool(action);
    }
  }

  function renderAction([icon, label, action]) {
    const activePanelByAction = {
      "bookmarks-panel": "bookmarks",
      "comments-panel": "comments",
      "pages-panel": "pages",
      "protect-pdf": "protect",
    };
    const isContextActionActive =
      action && activePanelByAction[action] === activeContextPanel;
    const isFullPageOrganizerActive =
      action === "pages-organizer" && pageOrganizerMode === "full";
    const policy = getActionPolicy(action);
    const isDisabled = !action || !policy.enabled;
    return (
      <button
        className={
          action &&
          (action === interactionActiveTool ||
            isContextActionActive ||
            isFullPageOrganizerActive)
            ? "active"
            : ""
        }
        disabled={isDisabled}
        key={label}
        onClick={() => runAction(action)}
        title={
          action
            ? policy.enabled
              ? t(label)
              : policy.reason
            : t("Azione PDF non ancora collegata")
        }
      >
        <Icon>{icon}</Icon>
        {t(label)}
      </button>
    );
  }

  function renderQuickAction({ action, disabled, icon, label, title }) {
    const isDeletePage = action === "delete-page";
    const policy = getActionPolicy(action);
    const policyDisabled = action && !policy.enabled;
    const pagesCount = viewerState.pagesCount || 0;
    const deletePageDisabled =
      disabled || !action || viewerState.loading || pagesCount <= 0;
    return (
      <button
        aria-label={t(label)}
        className="edit-page-quick-action"
        data-page-action={label}
        disabled={
          isDeletePage
            ? deletePageDisabled
            : disabled || !action || policyDisabled
        }
        key={label}
        onClick={() => runAction(action)}
        title={
          isDeletePage
            ? pagesCount <= 1
              ? t("Non puoi eliminare tutte le pagine.")
              : t(title || label)
            : policyDisabled
              ? policy.reason
              : t(title || label)
        }
        type="button"
      >
        <Icon>{icon}</Icon>
      </button>
    );
  }

  return (
    <aside className="sidenav tool-context-sidenav">
      <div className="tool-context-header">
        <h2>{t("Modifica")}</h2>
        <button
          aria-label={t("Chiudi strumenti modifica")}
          onClick={onClose}
          title={t("Chiudi strumenti modifica")}
        >
          <Icon>close</Icon>
        </button>
      </div>
      {isTextToolActive || isTextTargetSelected ? (
        <TextFormattingPanel
          onTextStyleChange={onTextStyleChange}
          textStyle={textStyle}
          viewerState={viewerState}
        />
      ) : null}
      {isDrawTargetActive ? (
        <DrawFormattingPanel
          drawStyle={drawStyle}
          onDrawStyleChange={onDrawStyleChange}
          viewerState={viewerState}
        />
      ) : null}
      <div className="edit-tool-section edit-page-section">
        <p>{t("Modifica pagina")}</p>
        <div className="edit-page-quick-actions" aria-label={t("Azioni rapide pagina")}>
          {pageQuickActions.map(renderQuickAction)}
        </div>
        {editPageActions.map(renderAction)}
      </div>
      <div className="edit-tool-section">
        <p>{t("Aggiungi contenuto")}</p>
        {contentActions.map(renderAction)}
      </div>
      <div className="edit-tool-section">
        <p>{t("Altre opzioni")}</p>
        {optionActions.map(renderAction)}
      </div>
    </aside>
  );
}
