import { normalizeWheelEventDirection } from "@rewirepdf/pdfjs/viewer-core";

export function createWheelZoomController({ container, emitState, pdfViewer }) {
  let wheelUnusedTicks = 0;
  let wheelUnusedFactor = 1;

  function accumulateTicks(ticks) {
    wheelUnusedTicks += ticks;
    const wholeTicks = Math.trunc(wheelUnusedTicks);
    wheelUnusedTicks -= wholeTicks;
    return wholeTicks;
  }

  function accumulateFactor(previousScale, factor) {
    wheelUnusedFactor *= factor;
    const newScale = Math.floor(previousScale * wheelUnusedFactor * 100) / 100;
    wheelUnusedFactor = newScale / previousScale;
    return newScale;
  }

  function getWheelZoomOrigin(event) {
    const rect = container.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      return [x, y];
    }
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  }

  function zoomWithWheel(event) {
    const origin = getWheelZoomOrigin(event);
    let scaleFactor = Math.exp(-event.deltaY / 100);

    const isPinchToZoom =
      event.ctrlKey &&
      event.deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
      event.deltaX === 0 &&
      Math.abs(scaleFactor - 1) < 0.05 &&
      event.deltaZ === 0;

    if (isPinchToZoom) {
      scaleFactor = accumulateFactor(pdfViewer.currentScale, scaleFactor);
      pdfViewer.updateScale({ scaleFactor, origin });
      emitState();
      return;
    }

    const delta = normalizeWheelEventDirection(event);
    let ticks = 0;
    if (
      event.deltaMode === WheelEvent.DOM_DELTA_LINE ||
      event.deltaMode === WheelEvent.DOM_DELTA_PAGE
    ) {
      ticks = Math.abs(delta) >= 1 ? Math.sign(delta) : accumulateTicks(delta);
    } else {
      const pixelsPerLineScale = 30;
      ticks = accumulateTicks(delta / pixelsPerLineScale);
    }

    if (ticks) {
      pdfViewer.updateScale({ steps: ticks, origin });
      emitState();
    }
  }

  return {
    zoomWithWheel,
  };
}
