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

import { AnnotationEditorType } from "pdfjs-lib";
import { CursorTool } from "./ui_utils.js";

function shouldDisableNativeTextEditForAnnotationMode(mode) {
  return mode !== AnnotationEditorType.NONE;
}

function shouldDisableNativeTextEditForCursorTool({ reset = false, tool }) {
  return !reset && tool !== CursorTool.SELECT;
}

function setNativeTextEditModeForApplication(app, enabled) {
  if (!enabled || !app.pdfDocument) {
    const service = app.ensureNativeTextEditService();
    service.disableVisualEditing();
    app._nativeTextEditPageNumber = null;
    app.updateNativeTextEditButton();
    return;
  }

  if (
    app.pdfViewer.annotationEditorMode !== AnnotationEditorType.DISABLE &&
    app.pdfViewer.annotationEditorMode !== AnnotationEditorType.NONE
  ) {
    app.pdfViewer.annotationEditorMode = {
      mode: AnnotationEditorType.NONE,
    };
  }
  app.pdfCursorTools?.switchTool(CursorTool.SELECT);

  const pageNumber = app.pdfViewer.currentPageNumber;
  app._nativeTextEditPageNumber = pageNumber;
  syncNativeTextEditModePageForApplication(app, pageNumber);
}

function syncNativeTextEditModePageForApplication(app, pageNumber) {
  if (!app.pdfDocument || app._nativeTextEditPageNumber === null) {
    return;
  }
  const service = app.ensureNativeTextEditService();
  app._nativeTextEditPageNumber = pageNumber;
  service.enableVisualEditing({
    pageNumber,
    previewRect: true,
    refresh: true,
    reopen: false,
    validate: true,
  });
  app.updateNativeTextEditButton();
}

function bindNativeTextEditModeEvents({ app, eventBus, pdfViewer, opts }) {
  eventBus._on(
    "switchannotationeditormode",
    evt => {
      const mode = evt.mode;
      if (shouldDisableNativeTextEditForAnnotationMode(mode)) {
        app.setNativeTextEditMode(false);
      }
      pdfViewer.annotationEditorMode = { ...evt, mode };
    },
    opts
  );
  eventBus._on(
    "pagechanging",
    evt => {
      syncNativeTextEditModePageForApplication(app, evt.pageNumber);
    },
    opts
  );
  eventBus._on(
    "switchcursortool",
    evt => {
      if (shouldDisableNativeTextEditForCursorTool(evt)) {
        app.setNativeTextEditMode(false);
      }
    },
    opts
  );
}

export {
  bindNativeTextEditModeEvents,
  setNativeTextEditModeForApplication,
  shouldDisableNativeTextEditForAnnotationMode,
  shouldDisableNativeTextEditForCursorTool,
  syncNativeTextEditModePageForApplication,
};
