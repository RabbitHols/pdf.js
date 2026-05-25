import { useEffect, useRef, useState } from "react";
import { clamp } from "../app/math.js";

const TOOLBAR_VIEWPORT_PADDING = 12;
const TOOLBAR_SIDEBAR_GAP = 8;
const TOOLBAR_TOPBAR_GAP = 8;
const TOOLBAR_RAIL_GAP = 8;

function isVisibleElement(element) {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || 1) !== 0
  );
}

function getTopbarBoundary() {
  const topbar =
    document.querySelector(".topbar-row") || document.querySelector(".topbar");
  if (!topbar) {
    return TOOLBAR_VIEWPORT_PADDING;
  }

  const topbarRect = topbar.getBoundingClientRect();
  return Math.max(
    TOOLBAR_VIEWPORT_PADDING,
    topbarRect.bottom + TOOLBAR_TOPBAR_GAP
  );
}

function getLeftBoundary() {
  const sidebars = Array.from(
    document.querySelectorAll(".tool-context-sidenav")
  ).filter(isVisibleElement);
  if (!sidebars.length) {
    return TOOLBAR_VIEWPORT_PADDING;
  }

  const sidebarRight = Math.max(
    ...sidebars.map(sidebar => sidebar.getBoundingClientRect().right)
  );
  return Math.max(
    TOOLBAR_VIEWPORT_PADDING,
    sidebarRight + TOOLBAR_SIDEBAR_GAP
  );
}

function getRightBoundary() {
  const boundaries = [window.innerWidth - TOOLBAR_VIEWPORT_PADDING];
  const rail = document.querySelector(".edit-right-rail");
  if (rail && isVisibleElement(rail)) {
    boundaries.push(rail.getBoundingClientRect().left - TOOLBAR_RAIL_GAP);
  }

  const commentsPanel = document.querySelector(
    ".editor-context-content.comments-context-panel"
  );
  if (commentsPanel && isVisibleElement(commentsPanel)) {
    boundaries.push(
      commentsPanel.getBoundingClientRect().left - TOOLBAR_SIDEBAR_GAP
    );
  }

  return Math.min(...boundaries);
}

function constrainToolbarPosition(position, toolbarRect) {
  const minX = getLeftBoundary();
  const minY = getTopbarBoundary();
  const maxX = Math.max(minX, getRightBoundary() - toolbarRect.width);
  const maxY = Math.max(
    minY,
    window.innerHeight - toolbarRect.height - TOOLBAR_VIEWPORT_PADDING
  );

  return {
    x: clamp(position.x, minX, maxX),
    y: clamp(position.y, minY, maxY),
  };
}

export function useFloatingToolbarPosition() {
  const toolbarRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const userMovedRef = useRef(false);
  const [toolbarPosition, setToolbarPosition] = useState(null);

  useEffect(() => {
    let animationFrame = 0;

    function positionOutsidePdf() {
      if (userMovedRef.current) {
        return;
      }
      const toolbar = toolbarRef.current;
      const pdfSurface =
        document.querySelector(".editor-workspace .pdfViewer .page") ||
        document.querySelector(".editor-workspace .pdf-surface-shell");
      if (!toolbar || !pdfSurface) {
        return;
      }

      const toolbarRect = toolbar.getBoundingClientRect();
      const pdfRect = pdfSurface.getBoundingClientRect();
      const gap = 24;
      setToolbarPosition(
        constrainToolbarPosition(
          {
            x: pdfRect.left - toolbarRect.width - gap,
            y: pdfRect.top,
          },
          toolbarRect
        )
      );
    }

    function keepToolbarInBounds() {
      const toolbar = toolbarRef.current;
      if (!toolbar) {
        return;
      }

      if (!userMovedRef.current) {
        positionOutsidePdf();
        return;
      }

      const toolbarRect = toolbar.getBoundingClientRect();
      setToolbarPosition(currentPosition =>
        currentPosition
          ? constrainToolbarPosition(currentPosition, toolbarRect)
          : currentPosition
      );
    }

    function scheduleKeepToolbarInBounds() {
      if (animationFrame) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        keepToolbarInBounds();
      });
    }

    positionOutsidePdf();
    window.addEventListener("resize", keepToolbarInBounds);
    const observer = new MutationObserver(scheduleKeepToolbarInBounds);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return () => {
      window.removeEventListener("resize", keepToolbarInBounds);
      observer.disconnect();
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  function startDrag(event) {
    if (event.button !== 0) {
      return;
    }
    const toolbar = toolbarRef.current;
    if (!toolbar) {
      return;
    }

    const rect = toolbar.getBoundingClientRect();
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    userMovedRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);

    function onPointerMove(moveEvent) {
      setToolbarPosition(
        constrainToolbarPosition(
          {
            x: moveEvent.clientX - dragOffsetRef.current.x,
            y: moveEvent.clientY - dragOffsetRef.current.y,
          },
          rect
        )
      );
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  return {
    startDrag,
    toolbarPosition,
    toolbarRef,
  };
}
