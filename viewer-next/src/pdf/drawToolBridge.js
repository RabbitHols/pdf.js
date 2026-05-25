const CUSTOM_DRAW_TOOLS = new Set([
  "line",
  "arrow",
  "checkmark",
  "cross",
  "rectangle",
  "circle",
  "callout",
  "polygon",
  "cloud",
  "polyline",
]);

const FILLABLE_DRAW_TOOLS = new Set([
  "rectangle",
  "circle",
  "callout",
  "polygon",
  "cloud",
]);

const DEFAULT_THICKNESS = 2;
const DEFAULT_OPACITY = 1;
const DEFAULT_FILL_COLOR = "";
const DEFAULT_STROKE_COLOR = "#1f2937";
const DEFAULT_STROKE = [31, 41, 55];
const DEFAULT_DRAW_STYLE = {
  color: DEFAULT_STROKE_COLOR,
  fillColor: DEFAULT_FILL_COLOR,
  pdfColor: DEFAULT_STROKE,
  strokeWidth: DEFAULT_THICKNESS,
};
const DRAW_SHAPE_STAMP_METADATA = Symbol("viewerNextDrawShape");
const STAMP_PREVIEW_WIDTH = 178;
const STAMP_SVG_WIDTH = 240;
const STAMP_ASSET_HEIGHT = 112;
const STAMP_SVG_HEIGHT = 154;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getValidScale(value) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function getPageUnitScale(page, pageView) {
  const pageRect = page?.getBoundingClientRect();
  const rawDims = pageView?.viewport?.rawDims;
  const pageWidth = rawDims?.pageWidth;
  const pageHeight = rawDims?.pageHeight;
  const scaleX = pageRect?.width && pageWidth ? pageRect.width / pageWidth : 1;
  const scaleY =
    pageRect?.height && pageHeight ? pageRect.height / pageHeight : scaleX;
  return {
    x: getValidScale(scaleX),
    y: getValidScale(scaleY),
  };
}

function getStampPreviewWidth(page, pageView) {
  return Math.max(24, STAMP_PREVIEW_WIDTH * getPageUnitScale(page, pageView).x);
}

async function withAnnotationEditorMode(pdfViewer, mode, callback) {
  const uiManager =
    pdfViewer?._layerProperties?.annotationEditorUIManager || null;
  if (!uiManager) {
    return callback();
  }

  const previousMode = uiManager.getMode();
  if (previousMode !== mode) {
    await uiManager.updateMode(mode);
  }

  try {
    return await callback();
  } finally {
    if (previousMode !== mode && uiManager.getMode() !== previousMode) {
      await uiManager.updateMode(previousMode);
    }
  }
}

function buildCenteredBox(point, width, height, boundsWidth, boundsHeight) {
  const fittedWidth = Math.min(width, boundsWidth);
  const fittedHeight = Math.min(height, boundsHeight);
  const left = clamp(point.x - fittedWidth / 2, 0, boundsWidth - fittedWidth);
  const top = clamp(point.y - fittedHeight / 2, 0, boundsHeight - fittedHeight);
  return {
    bottom: top + fittedHeight,
    left,
    right: left + fittedWidth,
    top,
  };
}

function getPoint(event, layerDiv) {
  const rect = layerDiv.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clonePoint(point) {
  return {
    x: point.x,
    y: point.y,
  };
}

function normalizeHexColor(value) {
  const color = String(value || "").trim();
  if (/^#[\da-f]{6}$/i.test(color)) {
    return color.toLowerCase();
  }
  if (/^#[\da-f]{3}$/i.test(color)) {
    return `#${color
      .slice(1)
      .split("")
      .map(part => part + part)
      .join("")}`.toLowerCase();
  }
  return DEFAULT_STROKE_COLOR;
}

function hexToRgb(color) {
  const normalized = normalizeHexColor(color);
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function normalizeDrawStyle(style = {}) {
  const color = style.color === "" ? "" : normalizeHexColor(style.color);
  const fillColor = style.fillColor ? normalizeHexColor(style.fillColor) : "";
  const strokeWidth = clamp(
    Number(style.strokeWidth || style.thickness || DEFAULT_THICKNESS),
    1,
    12
  );
  return {
    color,
    fillColor,
    pdfColor: color ? hexToRgb(color) : DEFAULT_STROKE,
    strokeWidth,
  };
}

function lineSegmentsFromPoints(points, close = false) {
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1], points[index]]);
  }
  if (close && points.length > 2) {
    segments.push([points.at(-1), points[0]]);
  }
  return segments;
}

function buildRegularPolygon(start, end, sides) {
  const center = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const radiusX = Math.abs(end.x - start.x) / 2;
  const radiusY = Math.abs(end.y - start.y) / 2;
  const points = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
    points.push({
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    });
  }
  return points;
}

function buildArrowHead(start, end) {
  const length = distance(start, end);
  if (length < 8) {
    return [];
  }
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = clamp(length * 0.22, 12, 32);
  const spread = Math.PI / 7;
  return [
    [
      end,
      {
        x: end.x - Math.cos(angle - spread) * headLength,
        y: end.y - Math.sin(angle - spread) * headLength,
      },
    ],
    [
      end,
      {
        x: end.x - Math.cos(angle + spread) * headLength,
        y: end.y - Math.sin(angle + spread) * headLength,
      },
    ],
  ];
}

function buildCloudPoints(start, end) {
  const center = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const radiusX = Math.abs(end.x - start.x) / 2;
  const radiusY = Math.abs(end.y - start.y) / 2;
  const points = [];
  const steps = 36;
  for (let index = 0; index < steps; index += 1) {
    const angle = (index * Math.PI * 2) / steps;
    const ripple = 1 + Math.sin(angle * 8) * 0.1;
    points.push({
      x: center.x + Math.cos(angle) * radiusX * ripple,
      y: center.y + Math.sin(angle) * radiusY * ripple,
    });
  }
  return points;
}

function buildCalloutGeometry(start, end, layerDiv) {
  const layerRect = layerDiv.getBoundingClientRect();
  const width = clamp(Math.abs(end.x - start.x) * 0.68, 118, 260);
  const height = clamp(Math.abs(end.y - start.y) * 0.46, 30, 96);
  const gap = 12;
  const pointsRight = end.x >= start.x;
  const boxLeft = pointsRight
    ? clamp(end.x, 0, layerRect.width - width)
    : clamp(end.x - width, 0, layerRect.width - width);
  const boxTop = clamp(end.y - height / 2, 0, layerRect.height - height);
  const boxRight = boxLeft + width;
  const boxBottom = boxTop + height;
  const anchorY = clamp(start.y, boxTop + gap, boxBottom - gap);
  const connector = {
    x: pointsRight ? boxLeft : boxRight,
    y: anchorY,
  };
  const box = {
    bottom: boxBottom,
    left: boxLeft,
    right: boxRight,
    top: boxTop,
  };
  const textBox = {
    bottom: boxBottom - 4,
    left: boxLeft + 8,
    right: boxRight - 8,
    top: boxTop + 6,
  };
  const arrow = [connector, start];
  return {
    box,
    segments: [
      ...lineSegmentsFromPoints(
        [
          { x: boxLeft, y: boxTop },
          { x: boxRight, y: boxTop },
          { x: boxRight, y: boxBottom },
          { x: boxLeft, y: boxBottom },
        ],
        true
      ),
      arrow,
      ...buildArrowHead(connector, start),
    ],
    textBox,
  };
}

function buildSegments(tool, start, end, layerDiv) {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);

  switch (tool) {
    case "arrow":
      return [[[start, end]], buildArrowHead(start, end)].flat();
    case "checkmark": {
      const width = right - left;
      const height = bottom - top;
      return lineSegmentsFromPoints([
        { x: left + width * 0.14, y: top + height * 0.55 },
        { x: left + width * 0.4, y: top + height * 0.82 },
        { x: left + width * 0.88, y: top + height * 0.18 },
      ]);
    }
    case "cross": {
      const insetX = (right - left) * 0.16;
      const insetY = (bottom - top) * 0.16;
      return [
        [
          { x: left + insetX, y: top + insetY },
          { x: right - insetX, y: bottom - insetY },
        ],
        [
          { x: right - insetX, y: top + insetY },
          { x: left + insetX, y: bottom - insetY },
        ],
      ];
    }
    case "rectangle":
      return lineSegmentsFromPoints(
        [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
        true
      );
    case "circle":
      return lineSegmentsFromPoints(buildRegularPolygon(start, end, 40), true);
    case "callout":
      return buildCalloutGeometry(start, end, layerDiv).segments;
    case "polygon":
      return lineSegmentsFromPoints(buildRegularPolygon(start, end, 6), true);
    case "cloud":
      return lineSegmentsFromPoints(buildCloudPoints(start, end), true);
    case "polyline": {
      const midX = (start.x + end.x) / 2;
      return lineSegmentsFromPoints([
        start,
        { x: midX, y: start.y },
        { x: midX, y: end.y },
        end,
      ]);
    }
    case "line":
    default:
      return [[start, end]];
  }
}

function segmentsToSvgPath(segments) {
  return segments
    .map(([start, end]) => `M ${start.x} ${start.y} L ${end.x} ${end.y}`)
    .join(" ");
}

function getSegmentPoints(segments) {
  return segments.flatMap(([start, end]) => [start, end]);
}

function getPointBounds(points, margin, layerDiv) {
  const layerRect = layerDiv.getBoundingClientRect();
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const left = clamp(Math.min(...xs) - margin, 0, layerRect.width);
  const top = clamp(Math.min(...ys) - margin, 0, layerRect.height);
  const right = clamp(Math.max(...xs) + margin, left + 1, layerRect.width);
  const bottom = clamp(Math.max(...ys) + margin, top + 1, layerRect.height);
  return {
    bottom,
    left,
    right,
    top,
  };
}

function localizePoint(point, box) {
  return {
    x: point.x - box.left,
    y: point.y - box.top,
  };
}

function localizeSegments(segments, box) {
  return segments.map(([start, end]) => [
    localizePoint(start, box),
    localizePoint(end, box),
  ]);
}

function pointsToSvgAttribute(points, box) {
  return points
    .map(point => {
      const local = localizePoint(point, box);
      return `${local.x.toFixed(2)},${local.y.toFixed(2)}`;
    })
    .join(" ");
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildFilledShapeSvg(
  tool,
  start,
  end,
  layerDiv,
  style,
  allowNoFill = false
) {
  if (
    !FILLABLE_DRAW_TOOLS.has(tool) ||
    (!style.fillColor && !allowNoFill)
  ) {
    return null;
  }

  const geometry =
    tool === "callout" ? buildCalloutGeometry(start, end, layerDiv) : null;
  const segments =
    geometry?.segments || buildSegments(tool, start, end, layerDiv);
  const points = getSegmentPoints(segments);
  if (!points.length) {
    return null;
  }

  const margin = style.strokeWidth * 2;
  const box = getPointBounds(points, margin, layerDiv);
  const width = Math.max(1, box.right - box.left);
  const height = Math.max(1, box.bottom - box.top);
  const outlinePath = segmentsToSvgPath(localizeSegments(segments, box));
  let fillMarkup = "";

  if (!style.fillColor) {
    fillMarkup = "";
  } else if (tool === "circle") {
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    const center = localizePoint(
      {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
      },
      box
    );
    fillMarkup = `<ellipse cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" rx="${Math.max(1, (right - left) / 2).toFixed(2)}" ry="${Math.max(1, (bottom - top) / 2).toFixed(2)}" fill="${escapeXml(style.fillColor)}"/>`;
  } else if (tool === "callout" && geometry?.box) {
    const fillPoints = [
      { x: geometry.box.left, y: geometry.box.top },
      { x: geometry.box.right, y: geometry.box.top },
      { x: geometry.box.right, y: geometry.box.bottom },
      { x: geometry.box.left, y: geometry.box.bottom },
    ];
    fillMarkup = `<polygon points="${pointsToSvgAttribute(fillPoints, box)}" fill="${escapeXml(style.fillColor)}"/>`;
  } else {
    const fillPoints =
      tool === "rectangle"
        ? [
            { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
            { x: Math.max(start.x, end.x), y: Math.min(start.y, end.y) },
            { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
            { x: Math.min(start.x, end.x), y: Math.max(start.y, end.y) },
          ]
        : tool === "polygon"
          ? buildRegularPolygon(start, end, 6)
          : buildCloudPoints(start, end);
    fillMarkup = `<polygon points="${pointsToSvgAttribute(fillPoints, box)}" fill="${escapeXml(style.fillColor)}"/>`;
  }

  const outlineMarkup = style.color
    ? `
  <path d="${escapeXml(outlinePath)}" fill="none" stroke="${escapeXml(style.color)}" stroke-width="${style.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" role="img" aria-label="Draw shape">
  <rect width="100%" height="100%" fill="transparent"/>
  ${fillMarkup}${outlineMarkup}
</svg>`;
  return {
    bitmapUrl: svgDataUrl(svg),
    box,
    shapeMetadata: {
      end: clonePoint(end),
      start: clonePoint(start),
      tool,
    },
  };
}

function toPdfPoint(pageView, point) {
  const [x, y] = pageView.viewport.convertToPdfPoint(point.x, point.y);
  return { x, y };
}

function toPdfRect(pageView, box) {
  const topLeft = toPdfPoint(pageView, {
    x: box.left,
    y: box.top,
  });
  const bottomRight = toPdfPoint(pageView, {
    x: box.right,
    y: box.bottom,
  });
  return [
    Math.min(topLeft.x, bottomRight.x),
    Math.min(topLeft.y, bottomRight.y),
    Math.max(topLeft.x, bottomRight.x),
    Math.max(topLeft.y, bottomRight.y),
  ];
}

function buildInkPaths(pageView, segments, thickness = DEFAULT_THICKNESS) {
  const lines = [];
  const points = [];
  const pdfPoints = [];

  for (const [segmentStart, segmentEnd] of segments) {
    const start = toPdfPoint(pageView, segmentStart);
    const end = toPdfPoint(pageView, segmentEnd);
    pdfPoints.push(start, end);
    points.push([start.x, start.y, end.x, end.y]);
    lines.push([
      NaN,
      NaN,
      NaN,
      NaN,
      start.x,
      start.y,
      NaN,
      NaN,
      NaN,
      NaN,
      end.x,
      end.y,
    ]);
  }

  const xs = pdfPoints.map(point => point.x);
  const ys = pdfPoints.map(point => point.y);
  const margin = thickness * 2;
  return {
    paths: {
      lines,
      points,
    },
    rect: [
      Math.min(...xs) - margin,
      Math.min(...ys) - margin,
      Math.max(...xs) + margin,
      Math.max(...ys) + margin,
    ],
  };
}

function createPreview(layerDiv, style) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("viewer-next-shape-draft");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.style.fill = style.fillColor || "none";
  path.style.stroke = style.color || "transparent";
  path.style.strokeWidth = `${style.strokeWidth}px`;
  svg.append(path);
  layerDiv.append(svg);
  return { path, svg };
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getStampIdentityLines(stampSelection) {
  if (!stampSelection?.requiresIdentity) {
    return [];
  }
  const identity = stampSelection.identity || {};
  return [
    identity.name,
    identity.title,
    identity.includeDate === false ? "" : identity.date,
  ].filter(Boolean);
}

function getStampBitmapHeight(stampSelection) {
  return getStampIdentityLines(stampSelection).length
    ? STAMP_SVG_HEIGHT
    : STAMP_ASSET_HEIGHT;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function createStampPreview(page) {
  const preview = document.createElement("div");
  preview.className = "viewer-next-stamp-cursor-preview";
  preview.hidden = true;
  preview.style.width = `${STAMP_PREVIEW_WIDTH}px`;

  const image = document.createElement("img");
  image.alt = "";
  preview.append(image);

  const identity = document.createElement("div");
  identity.className = "viewer-next-stamp-cursor-identity";
  preview.append(identity);

  page.append(preview);
  return { element: preview, identity, image, page };
}

function updateStampPreviewContent(preview, stampSelection) {
  preview.image.src = stampSelection?.asset || "";
  const identityLines = getStampIdentityLines(stampSelection);
  preview.identity.hidden = !identityLines.length;
  preview.identity.replaceChildren(
    ...identityLines.map(line => {
      const span = document.createElement("span");
      span.textContent = line;
      return span;
    })
  );
}

async function revealPlacedStampEditor(editor) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (editor.div) {
      editor.div.hidden = false;
      editor.onScaleChanging?.();
      if (editor.div.querySelector("canvas")) {
        break;
      }
    }
  }
}

export function createDrawToolBridge({
  emitState,
  pdfjsLib,
  pdfViewer,
  selectEditorAtPoint,
  viewer,
}) {
  let activeDrawTool = "draw";
  let activeDrawStyle = DEFAULT_DRAW_STYLE;
  let activeStampSelection = null;
  const stampBitmapUrlCache = new Map();
  let stampPreview = null;
  let session = null;

  async function addInkAnnotation({
    color,
    drawTool,
    segments,
    shapeMetadata,
    thickness,
  }) {
    const pageView = session.pageView;
    const editorLayer =
      pageView.annotationEditorLayer?.annotationEditorLayer || null;
    if (!editorLayer || segments.length === 0) {
      return null;
    }

    const { paths, rect } = buildInkPaths(pageView, segments, thickness);
    const editor = await editorLayer.deserialize({
      annotationType: pdfjsLib.AnnotationEditorType.INK,
      color,
      deleted: false,
      opacity: DEFAULT_OPACITY,
      pageIndex: pageView.id - 1,
      paths,
      rect,
      rotation: pageView.viewport.rotation,
      thickness,
    });

    if (editor) {
      editor.viewerNextDrawTool = drawTool || activeDrawTool || "draw";
      editor.viewerNextDrawShapeMetadata = shapeMetadata || null;
      editorLayer.add(editor);
      editorLayer.setSelected(editor);
      editor.focus?.();
    }
    return editor;
  }

  async function addShapeStampAnnotation(shape, pageView = session?.pageView) {
    const editorLayer =
      pageView?.annotationEditorLayer?.annotationEditorLayer || null;
    if (!editorLayer || !shape?.bitmapUrl || !shape?.box) {
      return null;
    }

    const stampMode = pdfjsLib.AnnotationEditorType.STAMP;
    const editor = await withAnnotationEditorMode(
      pdfViewer,
      stampMode,
      () =>
        editorLayer.createAndAddNewEditor(
          {
            offsetX: shape.box.left,
            offsetY: shape.box.top,
          },
          true,
          {
            bitmapUrl: shape.bitmapUrl,
            historyType: "shape",
          }
        )
    );
    if (!editor) {
      return null;
    }

    const [editorParentWidth, editorParentHeight] = editor.parentDimensions;
    editor.width = (shape.box.right - shape.box.left) / editorParentWidth;
    editor.height = (shape.box.bottom - shape.box.top) / editorParentHeight;
    editor.x = shape.box.left / editorParentWidth;
    editor.y = shape.box.top / editorParentHeight;
    editor._initialOptions.isCentered = false;
    editor.altTextData = {
      altText: "Draw shape",
      decorative: false,
    };
    editor[DRAW_SHAPE_STAMP_METADATA] = shape.shapeMetadata || null;
    editor.viewerNextDrawTool = shape.shapeMetadata?.tool || "draw";
    editor.viewerNextDrawShapeMetadata = shape.shapeMetadata || null;
    editor.setDims();
    editor.fixAndSetPosition();
    await revealPlacedStampEditor(editor);
    return editor;
  }

  function getSelectedDrawShapeEditors() {
    const uiManager =
      pdfViewer?._layerProperties?.annotationEditorUIManager || null;
    return (uiManager?.getSelectedEditors?.() || []).filter(
      editor =>
        editor?.[DRAW_SHAPE_STAMP_METADATA] ||
        editor?.viewerNextDrawShapeMetadata
    );
  }

  function getEditorCssBox(editor) {
    const [parentWidth, parentHeight] = editor.parentDimensions || [];
    if (!parentWidth || !parentHeight) {
      return null;
    }
    return {
      bottom: (editor.y + editor.height) * parentHeight,
      left: editor.x * parentWidth,
      right: (editor.x + editor.width) * parentWidth,
      top: editor.y * parentHeight,
    };
  }

  async function restyleDrawShapeEditor(editor) {
    const metadata =
      editor?.[DRAW_SHAPE_STAMP_METADATA] ||
      editor?.viewerNextDrawShapeMetadata;
    const layerDiv = editor?.parent?.div || null;
    const pageView = editor?.parent?.viewport
      ? pdfViewer.getPageView(editor.parent.pageIndex)
      : null;
    const box = getEditorCssBox(editor);
    if (!metadata || !layerDiv || !pageView || !box) {
      return false;
    }

    const nextShape = buildFilledShapeSvg(
      metadata.tool,
      metadata.start,
      metadata.end,
      layerDiv,
      activeDrawStyle,
      true
    );
    if (!nextShape) {
      return false;
    }

    nextShape.box = box;
    nextShape.shapeMetadata = metadata;
    const nextEditor = await addShapeStampAnnotation(nextShape, pageView);
    if (!nextEditor) {
      return false;
    }
    editor.remove();
    nextEditor.parent?.setSelected(nextEditor);
    nextEditor.focus?.();
    await revealPlacedStampEditor(nextEditor);
    return true;
  }

  async function restyleSelectedDrawShapeEditors() {
    const editors = getSelectedDrawShapeEditors();
    if (!editors.length) {
      return false;
    }
    const results = await Promise.all(
      editors.map(editor => restyleDrawShapeEditor(editor))
    );
    return results.some(Boolean);
  }

  async function addCalloutTextEditor(textBox) {
    const editorLayer =
      session.pageView.annotationEditorLayer?.annotationEditorLayer || null;
    if (!editorLayer) {
      return null;
    }
    await editorLayer.pasteEditor(
      {
        mode: pdfjsLib.AnnotationEditorType.FREETEXT,
      },
      {
        color: activeDrawStyle.color,
        fontFamily: "Helvetica",
        fontSize: 12,
        isCentered: false,
        x: textBox.left + 8,
        y: textBox.top + 22,
      }
    );

    const editorDiv = Array.from(
      session.layerDiv.querySelectorAll(".freeTextEditor")
    ).at(-1);
    editorDiv?.classList.add("viewer-next-callout-text");
    if (editorDiv) {
      const layerRect = session.layerDiv.getBoundingClientRect();
      editorDiv.style.width = `${(
        (100 * (textBox.right - textBox.left)) /
        layerRect.width
      ).toFixed(2)}%`;
      editorDiv.style.minHeight = `${Math.max(textBox.bottom - textBox.top, 28)}px`;
    }
    const textDiv = editorDiv?.querySelector(".internal");
    textDiv?.replaceChildren();
    textDiv?.focus();
    return editorDiv;
  }

  async function assetToDataUrl(asset) {
    if (!asset || asset.startsWith("data:")) {
      return asset || "";
    }
    if (stampBitmapUrlCache.has(asset)) {
      return stampBitmapUrlCache.get(asset);
    }
    const response = await fetch(asset);
    if (!response.ok) {
      throw new Error(`Unable to load stamp asset: ${response.status}`);
    }
    const dataUrl = await blobToDataUrl(await response.blob());
    stampBitmapUrlCache.set(asset, dataUrl);
    return dataUrl;
  }

  async function getStampBitmapUrl(stampSelection) {
    const identityLines = getStampIdentityLines(stampSelection);
    const cacheKey = JSON.stringify({
      asset: stampSelection.asset,
      identityLines,
      label: stampSelection.label,
    });
    if (stampBitmapUrlCache.has(cacheKey)) {
      return stampBitmapUrlCache.get(cacheKey);
    }

    const assetDataUrl = await assetToDataUrl(stampSelection.asset);
    const canvasHeight = getStampBitmapHeight(stampSelection);
    const textStartY = STAMP_SVG_HEIGHT - 34;
    const text = identityLines
      .slice(0, 3)
      .map(
        (line, index) =>
          `<text x="${STAMP_SVG_WIDTH / 2}" y="${textStartY + index * 15}" text-anchor="middle">${escapeXml(line)}</text>`
      )
      .join("");
    const identityContent = identityLines.length
      ? `
  <image href="${escapeXml(assetDataUrl)}" x="0" y="0" width="${STAMP_SVG_WIDTH}" height="112" preserveAspectRatio="xMidYMid meet"/>
  <g font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="#1f2937">${text}</g>`
      : `
  <image href="${escapeXml(assetDataUrl)}" x="0" y="0" width="${STAMP_SVG_WIDTH}" height="${STAMP_ASSET_HEIGHT}" preserveAspectRatio="xMidYMid meet"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STAMP_SVG_WIDTH}" height="${canvasHeight}" viewBox="0 0 ${STAMP_SVG_WIDTH} ${canvasHeight}" role="img" aria-label="${escapeXml(stampSelection.label || "Stamp")}">
  <rect width="${STAMP_SVG_WIDTH}" height="${canvasHeight}" fill="transparent"/>${identityContent}
</svg>`;
    const bitmapUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    stampBitmapUrlCache.set(cacheKey, bitmapUrl);
    return bitmapUrl;
  }

  async function createShapeAnnotation() {
    if (!session || distance(session.start, session.end) < 4) {
      return;
    }
    if (
      !activeDrawStyle.color &&
      (!FILLABLE_DRAW_TOOLS.has(activeDrawTool) || !activeDrawStyle.fillColor)
    ) {
      return;
    }

    if (activeDrawTool === "callout") {
      const geometry = buildCalloutGeometry(
        session.start,
        session.end,
        session.layerDiv
      );
      if (activeDrawStyle.fillColor) {
        const editor = await addShapeStampAnnotation(
          buildFilledShapeSvg(
            activeDrawTool,
            session.start,
            session.end,
            session.layerDiv,
            activeDrawStyle
          )
        );
        await addCalloutTextEditor(geometry.textBox);
        if (editor) {
          emitState();
        }
        return;
      }
      await addInkAnnotation({
        color: activeDrawStyle.pdfColor,
        drawTool: activeDrawTool,
        segments: geometry.segments,
        shapeMetadata: {
          end: clonePoint(session.end),
          start: clonePoint(session.start),
          tool: activeDrawTool,
        },
        thickness: activeDrawStyle.strokeWidth,
      });
      await addCalloutTextEditor(geometry.textBox);
      emitState();
      return;
    }

    const filledShape = buildFilledShapeSvg(
      activeDrawTool,
      session.start,
      session.end,
      session.layerDiv,
      activeDrawStyle
    );
    if (filledShape) {
      const editor = await addShapeStampAnnotation(filledShape);
      if (editor) {
        emitState();
      }
      return;
    }

    const segments = buildSegments(
      activeDrawTool,
      session.start,
      session.end,
      session.layerDiv
    );
    const editor = await addInkAnnotation({
      color: activeDrawStyle.pdfColor,
      drawTool: activeDrawTool,
      segments,
      shapeMetadata: FILLABLE_DRAW_TOOLS.has(activeDrawTool)
        ? {
            end: clonePoint(session.end),
            start: clonePoint(session.start),
            tool: activeDrawTool,
          }
        : null,
      thickness: activeDrawStyle.strokeWidth,
    });
    if (editor) {
      emitState();
    }
  }

  function clearSession() {
    session?.preview.svg.remove();
    session?.abortController.abort();
    session = null;
  }

  function clearStampPreview() {
    stampPreview?.element.remove();
    stampPreview = null;
  }

  function getPageViewFromLayer(layerDiv) {
    const page = layerDiv.closest(".page");
    return getPageViewFromPage(page);
  }

  function getPageViewFromPage(page) {
    const pageNumber = Number(page?.dataset.pageNumber || 0);
    if (!pageNumber) {
      return null;
    }
    return pdfViewer.getPageView(pageNumber - 1);
  }

  function getLayerDivFromEventTarget(target) {
    const directLayer = target.closest?.(".annotationEditorLayer");
    if (directLayer && viewer.contains(directLayer)) {
      return directLayer;
    }
    const page = target.closest?.(".page");
    return page?.querySelector(".annotationEditorLayer") || null;
  }

  function getPageFromEventTarget(target) {
    const page = target.closest?.(".page");
    return page && viewer.contains(page) ? page : null;
  }

  function isStampPlacementActive() {
    return activeDrawTool === "stamp-palette" && Boolean(activeStampSelection);
  }

  function syncStampPlacementState() {
    viewer.classList.toggle(
      "viewer-next-stamp-placement-active",
      isStampPlacementActive()
    );
  }

  function moveStampPreview(event, layerDiv = null) {
    if (!isStampPlacementActive()) {
      clearStampPreview();
      return null;
    }
    const page =
      getPageFromEventTarget(event.target) || layerDiv?.closest(".page");
    const nextLayerDiv =
      layerDiv || page?.querySelector(".annotationEditorLayer");
    if (!page || !viewer.contains(page)) {
      clearStampPreview();
      return null;
    }
    if (stampPreview?.page !== page) {
      clearStampPreview();
      stampPreview = createStampPreview(page);
    }
    updateStampPreviewContent(stampPreview, activeStampSelection);
    stampPreview.element.style.width = `${getStampPreviewWidth(
      page,
      getPageViewFromPage(page)
    )}px`;
    const point = getPoint(event, page);
    stampPreview.element.style.left = `${point.x}px`;
    stampPreview.element.style.top = `${point.y}px`;
    stampPreview.element.hidden = false;
    return { layerDiv: nextLayerDiv, point };
  }

  async function waitForStampEditorLayer(page, pageView) {
    const stampMode = pdfjsLib.AnnotationEditorType.STAMP;
    if (pdfViewer.annotationEditorMode !== stampMode) {
      pdfViewer.annotationEditorMode = { mode: stampMode };
    }
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const layerDiv = page.querySelector(".annotationEditorLayer");
      const editorLayer =
        pageView?.annotationEditorLayer?.annotationEditorLayer;
      if (layerDiv && editorLayer && viewer.contains(layerDiv)) {
        return { editorLayer, layerDiv };
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return null;
  }

  async function placeStamp(event) {
    if (!isStampPlacementActive() || event.button !== 0) {
      return;
    }
    viewer.dataset.stampPlacementStatus = "pointerdown";

    const page = getPageFromEventTarget(event.target);
    if (!page) {
      viewer.dataset.stampPlacementStatus = "no-page";
      return;
    }

    const pageView = getPageViewFromPage(page);
    if (!pageView) {
      viewer.dataset.stampPlacementStatus = "no-page-view";
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const clickPageRect = page.getBoundingClientRect();
    const clickRatio = {
      x: clickPageRect.width
        ? clamp(
            (event.clientX - clickPageRect.left) / clickPageRect.width,
            0,
            1
          )
        : 0,
      y: clickPageRect.height
        ? clamp(
            (event.clientY - clickPageRect.top) / clickPageRect.height,
            0,
            1
          )
        : 0,
    };
    moveStampPreview(event);
    try {
      viewer.dataset.stampPlacementStatus = "waiting-layer";
      const readyLayer = await waitForStampEditorLayer(page, pageView);
      if (!readyLayer) {
        viewer.dataset.stampPlacementStatus = "layer-timeout";
        throw new Error("Stamp annotation editor layer was not ready");
      }
      viewer.dataset.stampPlacementStatus = "creating";
      const bitmapUrl = await getStampBitmapUrl(activeStampSelection);
      const previewRect = stampPreview?.element.getBoundingClientRect();
      const layerRect =
        readyLayer.editorLayer.boundingClientRect ||
        page.getBoundingClientRect();
      const fallbackPageRect = page.getBoundingClientRect();
      const parentWidth = layerRect.width || fallbackPageRect.width;
      const parentHeight = layerRect.height || fallbackPageRect.height;
      const point = {
        x: clickRatio.x * parentWidth,
        y: clickRatio.y * parentHeight,
      };
      const stampWidth =
        previewRect?.width || getStampPreviewWidth(page, pageView);
      const stampHeight =
        (stampWidth * getStampBitmapHeight(activeStampSelection)) /
        STAMP_SVG_WIDTH;
      const stampBox = buildCenteredBox(
        point,
        stampWidth,
        stampHeight,
        parentWidth,
        parentHeight
      );
      const editor = readyLayer.editorLayer.createAndAddNewEditor(
        {
          offsetX: point.x,
          offsetY: point.y,
        },
        true,
        {
          bitmapUrl,
          historyType: "stamp",
        }
      );
      if (editor) {
        const [editorParentWidth, editorParentHeight] = editor.parentDimensions;
        editor.width = (stampBox.right - stampBox.left) / editorParentWidth;
        editor.height = (stampBox.bottom - stampBox.top) / editorParentHeight;
        editor.x = stampBox.left / editorParentWidth;
        editor.y = stampBox.top / editorParentHeight;
        editor._initialOptions.isCentered = false;
        editor.altTextData = {
          altText: activeStampSelection.label || "Stamp",
          decorative: false,
        };
        editor.setDims();
        editor.fixAndSetPosition();
        await revealPlacedStampEditor(editor);
        viewer.dataset.stampPlacementStatus = "created";
      } else {
        viewer.dataset.stampPlacementStatus = "no-editor";
      }

      await new Promise(resolve => requestAnimationFrame(resolve));
      selectEditorAtPoint?.({
        clientX: event.clientX,
        clientY: event.clientY,
      });
    } catch (reason) {
      viewer.dataset.stampPlacementStatus = "error";
      console.error("Viewer Next stamp placement failed", reason);
    } finally {
      stampPreview?.element.setAttribute("hidden", "");
      emitState();
    }
  }

  function onStampPointerMove(event) {
    moveStampPreview(event);
  }

  function onStampPointerLeave() {
    clearStampPreview();
  }

  function onPointerDown(event) {
    if (activeDrawTool === "stamp-palette") {
      void placeStamp(event);
      return;
    }
    if (!CUSTOM_DRAW_TOOLS.has(activeDrawTool) || event.button !== 0) {
      return;
    }
    if (
      selectEditorAtPoint?.({
        clientX: event.clientX,
        clientY: event.clientY,
        pointerEvent: event,
      })
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    const layerDiv = getLayerDivFromEventTarget(event.target);
    if (!layerDiv || !viewer.contains(layerDiv)) {
      return;
    }

    const pageView = getPageViewFromLayer(layerDiv);
    if (!pageView?.annotationEditorLayer?.annotationEditorLayer) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    clearSession();
    const point = getPoint(event, layerDiv);
    const abortController = new AbortController();
    session = {
      abortController,
      end: point,
      layerDiv,
      pageView,
      preview: createPreview(layerDiv, activeDrawStyle),
      start: point,
    };
    session.preview.path.setAttribute("d", "");

    layerDiv.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onPointerMove, {
      signal: abortController.signal,
    });
    window.addEventListener("pointerup", onPointerUp, {
      signal: abortController.signal,
    });
    window.addEventListener("pointercancel", clearSession, {
      signal: abortController.signal,
    });
  }

  function onPointerMove(event) {
    if (!session) {
      return;
    }
    event.preventDefault();
    session.end = getPoint(event, session.layerDiv);
    const segments = buildSegments(
      activeDrawTool,
      session.start,
      session.end,
      session.layerDiv
    );
    session.preview.path.setAttribute("d", segmentsToSvgPath(segments));
  }

  function onPointerUp(event) {
    if (!session) {
      return;
    }
    event.preventDefault();
    session.end = getPoint(event, session.layerDiv);
    const finishedSession = session;
    clearSession();
    session = finishedSession;
    void createShapeAnnotation().finally(() => {
      clearSession();
    });
  }

  viewer.addEventListener("pointerdown", onPointerDown, true);
  viewer.addEventListener("pointerleave", onStampPointerLeave, true);
  viewer.addEventListener("pointermove", onStampPointerMove, true);

  return {
    destroy() {
      clearSession();
      clearStampPreview();
      viewer.classList.remove("viewer-next-stamp-placement-active");
      viewer.removeEventListener("pointerdown", onPointerDown, true);
      viewer.removeEventListener("pointerleave", onStampPointerLeave, true);
      viewer.removeEventListener("pointermove", onStampPointerMove, true);
    },
    getState() {
      return {
        stampSelection: activeStampSelection,
        style: {
          color: activeDrawStyle.color,
          fillColor: activeDrawStyle.fillColor,
          strokeWidth: activeDrawStyle.strokeWidth,
        },
        tool: activeDrawTool,
      };
    },
    setDrawStyle(style) {
      activeDrawStyle = normalizeDrawStyle(style);
      if (session?.preview?.path) {
        session.preview.path.style.stroke =
          activeDrawStyle.color || "transparent";
        session.preview.path.style.fill = activeDrawStyle.fillColor || "none";
        session.preview.path.style.strokeWidth = `${activeDrawStyle.strokeWidth}px`;
      }
      void restyleSelectedDrawShapeEditors().then(updated => {
        if (updated) {
          emitState();
        }
      });
      emitState();
    },
    setDrawTool(toolId) {
      activeDrawTool =
        toolId === "stamp-palette" || CUSTOM_DRAW_TOOLS.has(toolId)
          ? toolId
          : "draw";
      clearSession();
      if (activeDrawTool !== "stamp-palette") {
        clearStampPreview();
      }
      syncStampPlacementState();
      emitState();
    },
    setStampSelection(stampSelection) {
      activeStampSelection = stampSelection || null;
      activeDrawTool = activeStampSelection ? "stamp-palette" : "draw";
      clearSession();
      clearStampPreview();
      syncStampPlacementState();
      emitState();
    },
  };
}
