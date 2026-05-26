/* Copyright 2026 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function normalizeClientRect(rect) {
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const width = Math.max(0, Number(rect?.width) || 0);
  const height = Math.max(0, Number(rect?.height) || 0);
  const right = Number.isFinite(Number(rect?.right))
    ? Number(rect.right)
    : left + width;
  const bottom = Number.isFinite(Number(rect?.bottom))
    ? Number(rect.bottom)
    : top + height;
  return {
    bottom,
    height: Math.max(0, bottom - top) || height,
    left,
    right,
    top,
    width: Math.max(0, right - left) || width,
  };
}

function getElementClientRect(element) {
  if (typeof element?.getBoundingClientRect === "function") {
    return normalizeClientRect(element.getBoundingClientRect());
  }
  return normalizeClientRect(null);
}

function unionClientRects(rects) {
  const usableRects = (rects || []).filter(rect => rect?.width || rect?.height);
  if (!usableRects.length) {
    return null;
  }

  const left = Math.min(...usableRects.map(rect => rect.left));
  const top = Math.min(...usableRects.map(rect => rect.top));
  const right = Math.max(...usableRects.map(rect => rect.right));
  const bottom = Math.max(...usableRects.map(rect => rect.bottom));
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function getClientRectForElements(elements) {
  return unionClientRects(
    elements?.map(element => getElementClientRect(element)) || []
  );
}

function getTextDivsForLineCandidate(lineCandidate) {
  return (
    lineCandidate?.textDivs ||
    (lineCandidate?.textDiv ? [lineCandidate.textDiv] : [])
  );
}

function getClientRectForLineCandidate(lineCandidate) {
  return getClientRectForElements(getTextDivsForLineCandidate(lineCandidate));
}

function getTextDivsForBlockCandidate(blockCandidate) {
  return (
    blockCandidate?.lines?.flatMap(line => getTextDivsForLineCandidate(line)) ||
    []
  );
}

function getClientRectForBlockCandidate(blockCandidate) {
  return getClientRectForElements(getTextDivsForBlockCandidate(blockCandidate));
}

function getCanvasPixelRectForClientRect(clientRect, canvas, options = null) {
  const canvasRect = getElementClientRect(canvas);
  if (!canvasRect.width || !canvasRect.height) {
    return null;
  }

  const padding =
    options?.padding === false
      ? 0
      : Math.max(8, Math.ceil(clientRect.height * 0.35));
  const left = Math.max(clientRect.left - padding, canvasRect.left);
  const top = Math.max(clientRect.top - padding, canvasRect.top);
  const right = Math.min(clientRect.right + padding * 3, canvasRect.right);
  const bottom = Math.min(clientRect.bottom + padding, canvasRect.bottom);
  if (right <= left || bottom <= top) {
    return null;
  }

  const scaleX = canvas.width / canvasRect.width;
  const scaleY = canvas.height / canvasRect.height;
  const x = Math.floor((left - canvasRect.left) * scaleX);
  const y = Math.floor((top - canvasRect.top) * scaleY);
  const width = Math.ceil((right - left) * scaleX);
  const height = Math.ceil((bottom - top) * scaleY);
  return {
    height: Math.min(height, canvas.height - y),
    width: Math.min(width, canvas.width - x),
    x,
    y,
  };
}

function getCanvasPixelRectForElement(element, canvas, options = null) {
  return getCanvasPixelRectForClientRect(
    getElementClientRect(element),
    canvas,
    options
  );
}

export {
  getCanvasPixelRectForClientRect,
  getCanvasPixelRectForElement,
  getClientRectForBlockCandidate,
  getClientRectForElements,
  getClientRectForLineCandidate,
  getElementClientRect,
  getTextDivsForBlockCandidate,
  getTextDivsForLineCandidate,
  normalizeClientRect,
  unionClientRects,
};
