import { useEffect, useState } from "react";
import { shouldShowUnimplementedTools } from "../../app/debugSettings.js";
import { getPdfActionPolicy } from "../../app/pdfActionPolicy.js";
import {
  drawToolOptions,
  getVisibleEditorTools,
} from "../../app/toolData.js";
import { useFloatingToolbarPosition } from "../../hooks/useFloatingToolbarPosition.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";
import { DrawToolPicker } from "./DrawToolPicker.jsx";
import { HighlightColorPicker } from "./HighlightColorPicker.jsx";
import { SignatureToolPicker } from "./SignatureToolPicker.jsx";

function getDrawToolOption(toolId) {
  return (
    drawToolOptions.find(option => option[0] === toolId) || drawToolOptions[0]
  );
}

function getSelectedDrawToolId(viewerInteractionState) {
  const details =
    viewerInteractionState?.selectedEditorDetails ||
    viewerInteractionState?.contextTarget?.editorDetails ||
    [];
  const detail = details.find(
    item =>
      item?.drawTool ||
      item?.editorType === "ink" ||
      item?.editorType === "shape" ||
      item?.historyType === "shape"
  );
  return detail?.drawTool || null;
}

export function EditorToolbar({
  activeDrawStyle = null,
  activeDrawTool = "draw",
  activeTool,
  canAddBookmarkFromSelection = false,
  canDeleteSelection = false,
  highlightColor,
  onAddBookmarkFromSelection,
  onAddCommentToSelection,
  onAddImage,
  onDeleteSavedSignature,
  onDeleteSelection,
  onHighlightColorChange,
  onListSavedSignatures,
  onOpenSignatureDialog,
  onOpenStampPanel,
  onSetDrawStyle,
  onSetDrawTool,
  onSetTool,
  onUseSavedSignature,
  pdfSecurity = null,
  viewerInteractionState = null,
}) {
  const { t } = useTranslation();
  const {
    startDrag,
    toolbarPosition,
    toolbarRef,
  } = useFloatingToolbarPosition();
  const [selectedDrawTool, setSelectedDrawTool] = useState(drawToolOptions[0]);
  const [drawStyle, setDrawStyle] = useState({
    color: "#1f2937",
    fillColor: "",
    strokeWidth: 2,
  });
  const [isDrawExpanded, setIsDrawExpanded] = useState(false);
  const [isHighlightExpanded, setIsHighlightExpanded] = useState(false);
  const [isSignatureExpanded, setIsSignatureExpanded] = useState(false);
  const interactionCapabilities = viewerInteractionState?.capabilities || {};
  const canBookmark = Boolean(
    interactionCapabilities.canBookmark ?? canAddBookmarkFromSelection
  );
  const canComment = Boolean(interactionCapabilities.canComment);
  const canDelete = Boolean(
    interactionCapabilities.canDelete ?? canDeleteSelection
  );
  const policyFacts = {
    hasDocument: true,
    pdfSecurity,
  };
  const deletePolicy = getPdfActionPolicy(
    "delete-annotation",
    policyFacts,
    t
  );
  const confirmedActiveTool = viewerInteractionState?.activeTool || activeTool;
  const selectedDrawToolId = getSelectedDrawToolId(viewerInteractionState);
  const visibleEditorTools = getVisibleEditorTools({
    showDebug: shouldShowUnimplementedTools(),
  });

  useEffect(() => {
    onSetDrawStyle?.(drawStyle);
  }, [drawStyle, onSetDrawStyle]);

  useEffect(() => {
    setSelectedDrawTool(current => {
      const next = getDrawToolOption(activeDrawTool);
      return current[0] === next[0] ? current : next;
    });
  }, [activeDrawTool]);

  useEffect(() => {
    if (!activeDrawStyle) {
      return;
    }
    setDrawStyle(current => {
      const nextStyle = {
        color: activeDrawStyle.color ?? current.color,
        fillColor: activeDrawStyle.fillColor ?? current.fillColor,
        strokeWidth: Number(activeDrawStyle.strokeWidth || current.strokeWidth),
      };
      return current.color === nextStyle.color &&
        current.fillColor === nextStyle.fillColor &&
        current.strokeWidth === nextStyle.strokeWidth
        ? current
        : nextStyle;
    });
  }, [activeDrawStyle]);

  useEffect(() => {
    if (!selectedDrawToolId) {
      return;
    }
    setSelectedDrawTool(current => {
      const next = getDrawToolOption(selectedDrawToolId);
      return current[0] === next[0] ? current : next;
    });
  }, [selectedDrawToolId]);

  function selectDrawTool(option) {
    setSelectedDrawTool(option);
    if (option[0] === "stamp-palette") {
      onOpenStampPanel?.();
      return;
    }
    onSetDrawTool(option[0]);
  }

  function updateDrawStyle(nextStyle) {
    setDrawStyle(current => ({
      ...current,
      ...nextStyle,
    }));
  }

  const effectiveActiveTool = isSignatureExpanded
    ? "signature"
    : isHighlightExpanded
      ? "highlight"
      : isDrawExpanded
        ? "ink"
        : activeDrawTool === "stamp-palette"
          ? "ink"
          : selectedDrawToolId
            ? "ink"
            : confirmedActiveTool;

  return (
    <div
      className="floating-toolbar"
      ref={toolbarRef}
      style={
        toolbarPosition
          ? { left: `${toolbarPosition.x}px`, top: `${toolbarPosition.y}px` }
          : undefined
      }
    >
      <div
        aria-label={t("Drag toolbar")}
        className="floating-toolbar-handle"
        onPointerDown={startDrag}
        role="button"
        tabIndex={0}
        title={t("Drag toolbar")}
      >
        <Icon className="floating-toolbar-handle-icon">drag_indicator</Icon>
      </div>
      {canBookmark ? (
        <div className="toolbar-tool-shell">
          <button
            aria-label={t("Aggiungi segnalibro")}
            onPointerDown={event => event.preventDefault()}
            onClick={onAddBookmarkFromSelection}
            title={t("Aggiungi segnalibro")}
            type="button"
          >
            <Icon>bookmark_add</Icon>
          </button>
        </div>
      ) : null}
      {visibleEditorTools.map(([tool, icon, label]) => {
        const isDraw = tool === "ink";
        const isHighlight = tool === "highlight";
        const isImage = tool === "image";
        const isSignature = tool === "signature";
        const isComment = tool === "comment";
        const policy = getPdfActionPolicy(tool, policyFacts, t);
        if (isComment && !canComment && policy.enabled) {
          return null;
        }
        const isDisabled = !policy.enabled || (isComment && !canComment);
        const buttonTitle = policy.enabled ? t(label) : policy.reason;
        const displayedIcon = isDraw ? selectedDrawTool[1] : icon;
        return (
          <div className="toolbar-tool-shell" key={tool} title={buttonTitle}>
            <button
              aria-expanded={
                isDraw
                  ? isDrawExpanded
                  : isHighlight
                    ? isHighlightExpanded
                    : isSignature
                      ? isSignatureExpanded
                      : undefined
              }
              aria-label={t(label)}
              className={effectiveActiveTool === tool ? "active" : ""}
              disabled={isDisabled}
              onPointerDown={event => {
                if (isComment) {
                  event.preventDefault();
                }
              }}
              onClick={() => {
                if (isDisabled) {
                  return;
                }
                if (isImage) {
                  onAddImage();
                } else if (isComment) {
                  onAddCommentToSelection();
                } else if (isDraw) {
                  selectDrawTool(selectedDrawTool);
                } else {
                  onSetTool(tool);
                }
                if (isHighlight) {
                  onHighlightColorChange(highlightColor);
                }
                setIsDrawExpanded(isDraw);
                setIsSignatureExpanded(isSignature);
                setIsHighlightExpanded(isHighlight);
              }}
              title={buttonTitle}
            >
              <Icon>{displayedIcon}</Icon>
              {isHighlight ? (
                <span
                  className="tool-color-indicator"
                  style={{ backgroundColor: highlightColor }}
                ></span>
              ) : null}
              {isDraw ? (
                <span
                  className="tool-color-indicator draw-color-indicator"
                  style={{
                    backgroundColor:
                      drawStyle.color || drawStyle.fillColor || "transparent",
                  }}
                ></span>
              ) : null}
            </button>
            {isDraw && isDrawExpanded ? (
              <DrawToolPicker
                drawStyle={drawStyle}
                onDrawStyleChange={updateDrawStyle}
                onSelectDrawTool={selectDrawTool}
                selectedDrawTool={selectedDrawTool}
              />
            ) : null}
            {isHighlight && isHighlightExpanded ? (
              <HighlightColorPicker
                highlightColor={highlightColor}
                onHighlightColorChange={onHighlightColorChange}
                onSetTool={onSetTool}
              />
            ) : null}
            {isSignature && isSignatureExpanded ? (
              <SignatureToolPicker
                onDeleteSavedSignature={onDeleteSavedSignature}
                onListSavedSignatures={onListSavedSignatures}
                onOpenSignatureDialog={onOpenSignatureDialog}
                onUseSavedSignature={onUseSavedSignature}
              />
            ) : null}
          </div>
        );
      })}
      <div className="separator"></div>
      <button
        aria-label={t("Delete selection")}
        className="delete-selection-button"
        disabled={!canDelete || !deletePolicy.enabled}
        onClick={onDeleteSelection}
        title={
          deletePolicy.enabled
            ? t("Delete selection")
            : deletePolicy.reason
        }
      >
        <Icon>delete</Icon>
      </button>
    </div>
  );
}
