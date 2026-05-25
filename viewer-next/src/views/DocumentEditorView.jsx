import { useCallback, useEffect, useRef, useState } from "react";
import { shouldShowUnimplementedTools } from "../app/debugSettings.js";
import { getPdfActionPolicy } from "../app/pdfActionPolicy.js";
import { CapabilityPanel } from "../components/editor/CapabilityPanel.jsx";
import { EditRightRail } from "../components/editor/EditRightRail.jsx";
import { EditorToolbar } from "../components/editor/EditorToolbar.jsx";
import { NativeEditingStatus } from "../components/editor/NativeEditingStatus.jsx";
import { PageOrganizerWorkspace } from "../components/page-organizer/PageOrganizerWorkspace.jsx";
import { PdfViewerSurface } from "../components/PdfViewerSurface.jsx";
import { Icon } from "../components/Icon.jsx";
import { useTranslation } from "../i18n/index.js";

function getInteractionSignature(interactionState = {}) {
  const target = interactionState.contextTarget || {};
  return [
    interactionState.selectionKind || "none",
    interactionState.contextTargetKind || target.kind || "",
    interactionState.selectedEditorCount || 0,
    (interactionState.selectedEditorIds || []).join(","),
    target.pageNumber || "",
  ].join("|");
}

function PdfContextMenu({
  interactionState,
  onAddBookmarkFromSelection,
  onAddCommentToSelection,
  onClose,
  onDeleteSelection,
  onSetTool,
  position,
}) {
  const { t } = useTranslation();
  const showUnimplementedTools = shouldShowUnimplementedTools();
  const capabilities = interactionState?.capabilities || {};
  const target = interactionState?.contextTarget || null;
  if (!position || !target || !capabilities.canUseContextMenu) {
    return null;
  }

  const canAnnotateText = target.kind === "text";
  const canRedact =
    capabilities.canRedact &&
    (target.kind === "text" ||
      target.kind === "native-text" ||
      target.kind === "redaction");
  const pdfSecurity = interactionState?.pdfSecurity || null;
  const policyFacts = {
    hasDocument: true,
    pdfSecurity,
  };
  const commentPolicy = getPdfActionPolicy("comment", policyFacts, t);
  const highlightPolicy = getPdfActionPolicy("highlight", policyFacts, t);
  const redactPolicy = getPdfActionPolicy("native-redact", policyFacts, t);
  const deletePolicy = getPdfActionPolicy(
    "delete-annotation",
    policyFacts,
    t
  );
  const actions = [
    capabilities.canComment
      ? {
          disabled: !commentPolicy.enabled,
          icon: "add_comment",
          label: t("Aggiungi commento"),
          onClick: onAddCommentToSelection,
          title: commentPolicy.enabled
            ? t("Aggiungi commento")
            : commentPolicy.reason,
        }
      : null,
    capabilities.canBookmark
      ? {
          icon: "bookmark_add",
          label: t("Aggiungi segnalibro"),
          onClick: onAddBookmarkFromSelection,
          title: t("Aggiungi segnalibro"),
        }
      : null,
    canAnnotateText && capabilities.canHighlight
      ? {
          disabled: !highlightPolicy.enabled,
          icon: "ink_highlighter",
          label: t("Evidenzia"),
          onClick: () => onSetTool?.("highlight"),
          title: highlightPolicy.enabled
            ? t("Evidenzia")
            : highlightPolicy.reason,
        }
      : null,
    showUnimplementedTools && canRedact
      ? {
          disabled: !redactPolicy.enabled,
          icon: "ink_eraser",
          label: t("Redigi"),
          onClick: () => onSetTool?.("native-redact"),
          title: redactPolicy.enabled
            ? t("Redigi")
            : redactPolicy.reason,
        }
      : null,
    capabilities.canDelete
      ? {
          danger: true,
          disabled: !deletePolicy.enabled,
          icon: "delete",
          label: t("Elimina selezione"),
          onClick: onDeleteSelection,
          title: deletePolicy.enabled
            ? t("Elimina selezione")
            : deletePolicy.reason,
        }
      : null,
  ].filter(Boolean);

  if (!actions.length) {
    return null;
  }

  return (
    <div
      className="viewer-context-menu"
      data-context-menu-kind={target.kind}
      role="menu"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {actions.map(action => (
        <button
          className={action.danger ? "danger" : ""}
          disabled={!action.onClick || action.disabled}
          key={action.label}
          onClick={() => {
            if (action.disabled) {
              return;
            }
            action.onClick?.();
            onClose();
          }}
          onPointerDown={event => event.preventDefault()}
          role="menuitem"
          title={action.title}
          type="button"
        >
          <Icon>{action.icon}</Icon>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function PdfEditingWorkspace({
  documentInfo,
  activeEditorPanel,
  confirmedActiveTool,
  highlightColor,
  initialFreeTextStyle,
  initialTool,
  onAddBookmarkFromSelection,
  onAddCommentToSelection,
  onAddImage,
  onDocumentLoaded,
  onApplyPageOrganization,
  onExportPageOrganization,
  onHighlightColorChange,
  onOpenEditorPanel,
  onOpenStampPanel,
  onSearch,
  onSetDrawTool,
  onSetTool,
  onViewerStateChange,
  pageOrganizer,
  pageOrganizerBusy,
  pageOrganizerMode,
  pagePreviews,
  pdfActions,
  pdfHandleRef,
  showFloatingToolbar = true,
  stampSelection,
  workspaceClassName = "editor-workspace",
  viewerState,
}) {
  const workspaceRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);
  const setTool = useCallback(toolName => onSetTool(toolName), [onSetTool]);
  const isFullPageOrganizer = pageOrganizerMode === "full";
  const shouldShowFloatingToolbar = showFloatingToolbar && !isFullPageOrganizer;
  const mainClassName = [
    "workspace",
    workspaceClassName,
    isFullPageOrganizer ? "page-organizer-active-workspace" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (isFullPageOrganizer && workspaceRef.current) {
      workspaceRef.current.scrollTop = 0;
    }
  }, [isFullPageOrganizer]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    function closeContextMenu() {
      setContextMenu(null);
    }
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeContextMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const currentSignature = getInteractionSignature(
      viewerState.viewerInteractionState
    );
    if (currentSignature !== contextMenu.signature) {
      setContextMenu(null);
    }
  }, [contextMenu, viewerState.viewerInteractionState]);

  const openContextMenu = useCallback(({ interactionState, x, y }) => {
    setContextMenu({
      interactionState,
      signature: getInteractionSignature(interactionState),
      x,
      y,
    });
  }, []);

  return (
    <main className={mainClassName} ref={workspaceRef}>
      {shouldShowFloatingToolbar ? (
        <EditorToolbar
          activeDrawStyle={viewerState.draw?.style}
          activeDrawTool={viewerState.draw?.tool}
          activeTool={confirmedActiveTool}
          canAddBookmarkFromSelection={Boolean(
            viewerState.viewerInteractionState?.capabilities?.canBookmark
          )}
          canDeleteSelection={Boolean(
            viewerState.viewerInteractionState?.capabilities?.canDelete
          )}
          highlightColor={highlightColor}
          onAddBookmarkFromSelection={onAddBookmarkFromSelection}
          onAddCommentToSelection={onAddCommentToSelection}
          onAddImage={onAddImage}
          onDeleteSavedSignature={pdfActions.deleteSavedSignature}
          onDeleteSelection={pdfActions.deleteSelectedAnnotation}
          onHighlightColorChange={onHighlightColorChange}
          onListSavedSignatures={pdfActions.listSavedSignatures}
          onOpenSignatureDialog={pdfActions.openSignatureDialog}
          onOpenStampPanel={onOpenStampPanel}
          onSetDrawStyle={pdfActions.setDrawStyle}
          onSetDrawTool={onSetDrawTool}
          onSetTool={setTool}
          onUseSavedSignature={pdfActions.useSavedSignature}
          pdfSecurity={viewerState.pdfSecurity}
          viewerInteractionState={viewerState.viewerInteractionState}
        />
      ) : null}
      <PdfViewerSurface
        documentInfo={documentInfo}
        enableSignatureTools
        initialFreeTextStyle={initialFreeTextStyle}
        initialTool={initialTool}
        onDocumentLoaded={onDocumentLoaded}
        onPdfContextMenu={openContextMenu}
        onViewerStateChange={onViewerStateChange}
        ref={pdfHandleRef}
        resizeShellToPage
        stampSelection={stampSelection}
      />
      <PdfContextMenu
        interactionState={
          {
            ...(viewerState.viewerInteractionState ||
              contextMenu?.interactionState ||
              {}),
            pdfSecurity: viewerState.pdfSecurity,
          }
        }
        onAddBookmarkFromSelection={onAddBookmarkFromSelection}
        onAddCommentToSelection={onAddCommentToSelection}
        onClose={() => setContextMenu(null)}
        onDeleteSelection={pdfActions.deleteSelectedAnnotation}
        onSetTool={setTool}
        position={contextMenu}
      />
      {isFullPageOrganizer ? (
        <PageOrganizerWorkspace
          isApplying={pageOrganizerBusy}
          onApply={onApplyPageOrganization}
          onExport={onExportPageOrganization}
          onGoToPage={pdfActions.goToPage}
          pageOrganizer={pageOrganizer}
          pagePreviews={pagePreviews}
          viewerState={viewerState}
        />
      ) : null}
      <NativeEditingStatus nativeEditing={viewerState.nativeEditing} />
      <CapabilityPanel
        viewerInteractionState={viewerState.viewerInteractionState}
        viewerState={viewerState}
      />
      <EditRightRail
        activeEditorPanel={activeEditorPanel}
        onFitPageWidth={pdfActions.fitPageWidth}
        onGoToPage={pdfActions.goToPage}
        onOpenEditorPanel={onOpenEditorPanel}
        onNextPage={pdfActions.nextPage}
        onPreviousPage={pdfActions.previousPage}
        onRotateClockwise={pdfActions.rotateClockwise}
        onZoomIn={pdfActions.zoomIn}
        onZoomOut={pdfActions.zoomOut}
        viewerState={viewerState}
      />
    </main>
  );
}

export function EditView({ initialTool = "select", ...props }) {
  return <PdfEditingWorkspace {...props} initialTool={initialTool} />;
}

export function SignView(props) {
  return (
    <PdfEditingWorkspace
      {...props}
      initialTool="signature"
      showFloatingToolbar={false}
      workspaceClassName="editor-workspace sign-workspace"
    />
  );
}
