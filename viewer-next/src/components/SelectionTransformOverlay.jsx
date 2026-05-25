import { useTranslation } from "../i18n/index.js";
import { Icon } from "./Icon.jsx";

const RESIZE_HANDLES = [
  ["topLeft", "nw"],
  ["topRight", "ne"],
  ["bottomRight", "se"],
  ["bottomLeft", "sw"],
];

function getOverlayBounds(viewerInteractionState) {
  const capabilities = viewerInteractionState?.capabilities || {};
  if (!capabilities.canTransform) {
    return null;
  }
  const bounds =
    viewerInteractionState.contextTarget?.bounds ||
    viewerInteractionState.selectionBounds ||
    null;
  const viewport = bounds?.viewport;
  if (
    !viewport ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }
  return viewport;
}

export function SelectionTransformOverlay({
  onDelete,
  onResetRotation,
  onRotate,
  onResizeStart,
  viewerInteractionState,
}) {
  const { t } = useTranslation();
  const bounds = getOverlayBounds(viewerInteractionState);
  if (!bounds) {
    return null;
  }

  const capabilities = viewerInteractionState?.capabilities || {};
  const canResize = Boolean(capabilities.canResize);
  const canResetRotation = Boolean(capabilities.canResetRotation);
  const canRotate = Boolean(capabilities.canRotate);

  return (
    <div
      className="selection-transform-overlay"
      data-transform-kind={viewerInteractionState.contextTargetKind || ""}
      style={{
        height: `${bounds.height}px`,
        transform: `translate(${bounds.x}px, ${bounds.y}px)`,
        width: `${bounds.width}px`,
      }}
    >
      <div className="selection-transform-frame" />
      {RESIZE_HANDLES.map(([name, position]) => (
        <button
          aria-label={t("Ridimensiona selezione")}
          className={`selection-transform-handle ${position}`}
          disabled={!canResize}
          key={name}
          onPointerDown={event => {
            if (!canResize) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onResizeStart?.(name, event.nativeEvent);
          }}
          title={t("Ridimensiona selezione")}
          type="button"
        />
      ))}
      <button
        aria-label={t("Ruota selezione")}
        className="selection-transform-rotate"
        disabled={!canRotate}
        onClick={onRotate}
        title={
          canRotate
            ? t("Ruota selezione")
            : t("Rotazione elemento non ancora disponibile")
        }
        type="button"
      >
        <Icon>rotate_right</Icon>
      </button>
      <div
        className="selection-transform-toolbar"
        onPointerDown={event => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          aria-label={t("Elimina selezione")}
          onClick={onDelete}
          title={t("Elimina selezione")}
          type="button"
        >
          <Icon>delete</Icon>
        </button>
        <button
          aria-label={t("Reset rotazione")}
          disabled={!canResetRotation}
          onClick={onResetRotation}
          title={
            canResetRotation
              ? t("Reset rotazione")
              : t("Rotazione elemento non ancora disponibile")
          }
          type="button"
        >
          <Icon>rotate_left</Icon>
        </button>
      </div>
    </div>
  );
}
