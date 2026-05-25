import { Fragment } from "react";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";

function formatPageRange(startPage, endPage) {
  if (startPage === endPage) {
    return String(startPage);
  }
  return `${startPage}-${endPage}`;
}

export function PageOrganizerThumbnails({
  compact = false,
  onGoToPage,
  pageOrganizer,
  pagePreviews = {},
  viewerState,
}) {
  const { t } = useTranslation();
  const currentPage = viewerState.pageNumber || 1;
  const insertionsByPosition = new Map();
  for (const insertion of pageOrganizer.insertions || []) {
    const position = insertion.insertAfterPosition;
    const items = insertionsByPosition.get(position) || [];
    items.push(insertion);
    insertionsByPosition.set(position, items);
  }

  const renderInsertionMarkers = position =>
    (insertionsByPosition.get(position) || []).map(insertion => (
      <div className="page-organizer-insertion" key={insertion.id}>
        <Icon>note_add</Icon>
        <strong>
          {insertion.sourceType === "blank"
            ? t("Pagine vuote")
            : t("Inserite da {{name}}", {
                name: insertion.sourceName || t("PDF non scelto"),
              })}
        </strong>
        <span>
          {t("Pagine {{pages}}", {
            pages: formatPageRange(
              insertion.sourceStartPage,
              insertion.sourceEndPage
            ),
          })}
        </span>
      </div>
    ));

  if (!pageOrganizer.draftOrder.length) {
    return (
      <div className="page-organizer-empty">
        <Icon>grid_view</Icon>
        <span>{t("Nessuna pagina caricata")}</span>
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "page-organizer-thumbs compact"
          : "page-organizer-thumbs"
      }
      data-page-order={pageOrganizer.draftOrder.join(",")}
    >
      {renderInsertionMarkers(-1)}
      {pageOrganizer.draftOrder.map((page, index) => {
        const selected = pageOrganizer.selectedPages.has(page);
        const active = page === currentPage;
        const position = index + 1;
        const replacement = pageOrganizer.replacements?.find(
          item =>
            position >= item.targetStartPosition &&
            position <= item.targetEndPosition
        );
        const preview = pagePreviews[page];
        const draftRotation = pageOrganizer.pageRotations[page] || 0;
        const normalizedRotation =
          (((viewerState.rotation || 0) + draftRotation) % 360 + 360) % 360;
        const isRotated = normalizedRotation !== 0;
        return (
          <Fragment key={page}>
            <article
              aria-label={t("Pagina {{page}}", { page })}
              className={[
                "page-organizer-card",
                active ? "active" : "",
                selected ? "selected" : "",
                pageOrganizer.draggedPage === page ? "dragging" : "",
              ].filter(Boolean).join(" ")}
              data-page-number={page}
              draggable
              onDragEnd={pageOrganizer.endDrag}
              onDragOver={event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(page));
                pageOrganizer.beginDrag(page);
              }}
              onDrop={event => {
                event.preventDefault();
                const transferredPage = Number(
                  event.dataTransfer.getData("text/plain")
                );
                if (transferredPage) {
                  pageOrganizer.movePageAfterTarget(transferredPage, page);
                  return;
                }
                pageOrganizer.moveDraggedPageAfter(page);
              }}
            >
              <label
                aria-label={t("Seleziona pagina {{page}}", { page })}
                className={[
                  "page-organizer-check",
                  selected ? "checked" : "",
                ].filter(Boolean).join(" ")}
                onClick={event => event.stopPropagation()}
                onDragStart={event => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <input
                  checked={selected}
                  onChange={() => pageOrganizer.togglePageSelection(page)}
                  type="checkbox"
                />
                <span>
                  <Icon>check</Icon>
                </span>
              </label>
              <button
                className="page-organizer-preview"
                onClick={() => onGoToPage(page)}
                type="button"
              >
                <span
                  className={
                    [
                      "page-organizer-preview-paper",
                      preview ? "has-preview" : "",
                      isRotated ? "is-rotated" : "",
                    ].filter(Boolean).join(" ")
                  }
                  data-preview-rotation={normalizedRotation}
                  style={{
                    "--page-preview-rotation": `${normalizedRotation}deg`,
                  }}
                >
                  {preview ? (
                    <img
                      alt=""
                      className="page-organizer-preview-image"
                      draggable="false"
                      src={preview}
                    />
                  ) : (
                    <>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                    </>
                  )}
                </span>
              </button>
              {active ? (
                <div className="page-organizer-card-actions">
                  <button
                    aria-label={t("Ruota pagina {{page}}", { page })}
                    onClick={event => {
                      event.stopPropagation();
                      pageOrganizer.rotatePageClockwise(page);
                    }}
                    type="button"
                  >
                    <Icon>rotate_right</Icon>
                  </button>
                  <button
                    aria-label={t("Elimina pagina {{page}}", { page })}
                    disabled={pageOrganizer.draftOrder.length <= 1}
                    onClick={event => {
                      event.stopPropagation();
                      pageOrganizer.deletePages([page]);
                    }}
                    type="button"
                  >
                    <Icon>delete</Icon>
                  </button>
                </div>
              ) : null}
              <strong>{index + 1}</strong>
              {page !== index + 1 ? (
                <small>{t("Origine pagina {{page}}", { page })}</small>
              ) : null}
              {replacement ? (
                <em className="page-organizer-replaced">
                  {t("Sostituita")}
                </em>
              ) : null}
            </article>
            {renderInsertionMarkers(index)}
          </Fragment>
        );
      })}
    </div>
  );
}
