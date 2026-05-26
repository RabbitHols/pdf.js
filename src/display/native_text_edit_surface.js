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

import {
  getCanvasPixelRectForClientRect,
  getCanvasPixelRectForElement,
} from "./native_text_edit_geometry.js";

function captureNativeTextEditPagePreviewSurface({
  canvas,
  element,
  pageView,
  padding = true,
} = {}) {
  if (!canvas || !element) {
    return null;
  }
  const rect = getCanvasPixelRectForElement(element, canvas, { padding });
  if (!rect?.width || !rect?.height) {
    return null;
  }

  const context = canvas.getContext("2d", { alpha: false });
  return {
    canvas,
    context,
    originalImageData: context.getImageData(
      rect.x,
      rect.y,
      rect.width,
      rect.height
    ),
    pageView,
    rect,
  };
}

function captureNativeTextEditOverlayPreviewSurface({
  canvas,
  pageView,
  targetCanvas,
  targetElement,
} = {}) {
  if (!canvas || !targetCanvas || !targetElement) {
    return null;
  }
  const targetRect = targetElement.getBoundingClientRect();
  const rect = getCanvasPixelRectForClientRect(targetRect, canvas, {
    padding: false,
  });
  if (!rect?.width || !rect?.height) {
    return null;
  }

  targetCanvas.width = rect.width;
  targetCanvas.height = rect.height;
  targetCanvas.style.width = `${targetRect.width}px`;
  targetCanvas.style.height = `${targetRect.height}px`;
  const context = canvas.getContext("2d", { alpha: false });
  const targetContext = targetCanvas.getContext("2d");
  const originalImageData = context.getImageData(
    rect.x,
    rect.y,
    rect.width,
    rect.height
  );
  targetContext.putImageData(originalImageData, 0, 0);
  return {
    canvas,
    context,
    originalImageData,
    pageView,
    rect,
    targetCanvas,
    targetContext,
  };
}

export {
  captureNativeTextEditOverlayPreviewSurface,
  captureNativeTextEditPagePreviewSurface,
};
