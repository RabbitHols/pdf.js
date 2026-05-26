/* Copyright 2014 Mozilla Foundation
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
  FindState,
  normalize,
  PDFFindController,
} from "./pdf_find_controller.js";
import {
  LinkTarget,
  PDFLinkService,
  SimpleLinkService,
} from "./pdf_link_service.js";
import {
  normalizeWheelEventDirection,
  parseQueryString,
  ProgressBar,
  ScrollMode,
  SpreadMode,
} from "./ui_utils.js";
import { AnnotationLayerBuilder } from "./annotation_layer_builder.js";
import { DownloadManager } from "./download_manager.js";
import { EventBus } from "./event_utils.js";
import { GenericL10n } from "./genericl10n.js";
import { PagesMapper } from "../src/display/pages_mapper.js";
import { PDFHistory } from "./pdf_history.js";
import { PDFPageView } from "./pdf_page_view.js";
import { PDFRenderingQueue } from "./pdf_rendering_queue.js";
import { PDFScriptingManager } from "./pdf_scripting_manager.component.js";
import { PDFSinglePageViewer } from "./pdf_single_page_viewer.js";
import { PDFViewer } from "./pdf_viewer.js";
import { RenderingStates } from "./renderable_view.js";
import { StructTreeLayerBuilder } from "./struct_tree_layer_builder.js";
import { TextLayerBuilder } from "./text_layer_builder.js";
import { XfaLayerBuilder } from "./xfa_layer_builder.js";

class NativeControllerStub {
  constructor(services = {}) {
    this.services = services;
  }

  setServices(services = {}) {
    this.services = services;
    return this;
  }

  clear() {}

  disable() {}
}

class NativeTextEditServiceStub {
  hasCommittedBytes() {
    return false;
  }

  getCommittedBytes() {
    return null;
  }

  clear() {}

  disableVisualEditing() {}
}

function setNativeTextEditModeForApplication(app, enabled) {
  app._nativeTextEditPageNumber = enabled
    ? app.pdfViewer?.currentPageNumber || null
    : null;
  app.updateNativeTextEditButton?.();
}

function setNativeRedactModeForApplication(app, enabled) {
  app._nativeRedactPageNumber = enabled
    ? app.pdfViewer?.currentPageNumber || null
    : null;
  app.updateNativeRedactButton?.();
}

function syncNativeTextEditModePageForApplication(app, pageNumber) {
  if (app._nativeTextEditPageNumber !== null) {
    app._nativeTextEditPageNumber = pageNumber;
  }
}

function syncNativeRedactModePageForApplication(app, pageNumber) {
  if (app._nativeRedactPageNumber !== null) {
    app._nativeRedactPageNumber = pageNumber;
  }
}

globalThis.pdfjsViewer = {
  AnnotationLayerBuilder,
  DownloadManager,
  EventBus,
  FindState,
  GenericL10n,
  LinkTarget,
  normalize,
  normalizeWheelEventDirection,
  parseQueryString,
  PDFFindController,
  PDFHistory,
  PDFLinkService,
  PDFPageView,
  PDFRenderingQueue,
  PDFScriptingManager,
  PDFSinglePageViewer,
  PDFViewer,
  PagesMapper,
  ProgressBar,
  RenderingStates,
  ScrollMode,
  SimpleLinkService,
  SpreadMode,
  StructTreeLayerBuilder,
  TextLayerBuilder,
  XfaLayerBuilder,
};

export {
  AnnotationLayerBuilder,
  DownloadManager,
  EventBus,
  FindState,
  GenericL10n,
  LinkTarget,
  NativeControllerStub as NativeRedactController,
  NativeControllerStub as NativeTextEditController,
  NativeTextEditServiceStub as NativeTextEditService,
  normalize,
  normalizeWheelEventDirection,
  parseQueryString,
  PDFFindController,
  PDFHistory,
  PDFLinkService,
  PDFPageView,
  PDFRenderingQueue,
  PDFScriptingManager,
  PDFSinglePageViewer,
  PDFViewer,
  PagesMapper,
  ProgressBar,
  RenderingStates,
  ScrollMode,
  setNativeRedactModeForApplication,
  setNativeTextEditModeForApplication,
  SimpleLinkService,
  SpreadMode,
  StructTreeLayerBuilder,
  syncNativeRedactModePageForApplication,
  syncNativeTextEditModePageForApplication,
  TextLayerBuilder,
  XfaLayerBuilder,
};
