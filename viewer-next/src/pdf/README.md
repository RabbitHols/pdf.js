# Viewer Next PDF Boundary

This directory is the only Viewer Next layer that imports pdf.js viewer/runtime
modules. Those reusable modules now live under `src/display`; historical `web/`
paths remain compatibility re-exports for the classic viewer. React components
consume `createViewerEngine` from `index.js` and receive state through the
engine callback.

## Internal Entrypoints

- `index.js` exports `createViewerEngine` and the current engine contract
  metadata.
- `viewerEngine.js` wires the pdf.js runtime, lifecycle, find, annotation
  editor, native text edit/redact, print, and file actions.
- `viewerCoreRuntime.js` is the first extracted runtime seam around pdf.js
  rendering, text layer, selection, find, link service, rendering queue, and
  annotation editor support. It currently consumes UI-free viewer modules from
  `web/`, and is the file to shrink as those modules become shared core
  modules.
- `src/display/text_layer_builder.js` owns text-layer DOM creation,
  browser-selection handling, copy normalization, find text mapping, and native
  text-edit source refs. `web/text_layer_builder.js` re-exports it for the
  classic viewer while Viewer Next inherits it through `PDFPageView`.
- `src/display/pdf_page_view.js` owns per-page canvas/text/annotation/draw/editor
  layer orchestration. `web/pdf_page_view.js` re-exports it for the classic
  viewer while the remaining `web/pdf_viewer.js` runtime continues to construct
  the same class.
- `src/display/renderable_view.js`, `src/display/base_pdf_page_view.js`, and
  `src/display/draw_layer_builder.js` own the reusable render-state, page-canvas
  base class, and draw-layer builder used by `PDFPageView`. Their historical
  `web/` paths remain compatibility re-exports.
- `src/display/text_accessibility.js`, `src/display/text_highlighter.js`,
  `src/display/autolinker.js`, `src/display/pdf_page_detail_view.js`, and
  `src/display/pdf_rendering_queue.js` continue the same pattern for text
  accessibility, find highlighting, inferred links, partial-detail rendering,
  and page render scheduling. Their historical `web/` paths remain compatibility
  re-exports.
- `src/display/annotation_layer_builder.js`,
  `src/display/annotation_editor_layer_builder.js`,
  `src/display/struct_tree_layer_builder.js`, and
  `src/display/xfa_layer_builder.js` own page overlay builders. Their historical
  `web/` paths remain compatibility re-exports.
- `src/display/ui_utils.js`, `src/display/app_options.js`,
  `src/display/pdf_link_service.js`, `src/display/pdf_find_utils.js`, and
  `src/display/pdf_find_controller.js` own shared viewer utilities, options,
  navigation/linking, and find normalization/controller logic. Their historical
  `web/` paths remain compatibility re-exports.
- `src/display/pdf_viewer.js` owns document-level page lifecycle, page cache,
  scrolling, zoom/scale, visible-page calculation, copy plumbing, and creation
  of `PDFPageView` instances. `web/pdf_viewer.js` re-exports it for the classic
  viewer and legacy imports.
- `pdfjsViewerAdapter.js` is a compatibility alias for older imports.
- `pdfViewerRuntime.js` is a compatibility alias for the previous internal
  runtime name.

## Future npm Shape

A future package should expose an engine entrypoint and leave the product shell
as a separate consumer:

```js
import { createViewerEngine } from "@pdfjs/viewer-next-engine";
```

The package boundary needs to include:

- a worker URL strategy for `pdf.worker.mjs`;
- copied cMaps, standard fonts, WASM, and sandbox assets;
- viewer CSS plus a documented way for consumers to layer product UI CSS;
- stable source normalization for `Uint8Array`, `ArrayBuffer`, and `{ data }`;
- an imperative handle matching `viewerNextEngineContract.methods`;
- a state contract matching `viewerNextEngineContract.stateKeys`.

The current Vite build copies runtime assets under
`build/generic/viewer-next/pdfjs/` and derives the worker URL in
`pdfDocumentLoader.js`. Keep that strategy centralized here when preparing a
standalone package.

## Interaction State Contract

`viewerEngine.getState()` and `onViewerStateChange` include
`viewerInteractionState`, a small serializable model emitted by the pdf.js
boundary for toolbar and context UI surfaces.

Shape:

```js
{
  activeTool: "select",
  selectionKind: "none",
  selectionBounds: null,
  selectedEditorCount: 0,
  selectedEditorIds: [],
  contextTarget: null,
  contextTargetKind: null,
  capabilities: {
    canBookmark: false,
    canComment: false,
    canDelete: false,
    canHighlight: false,
    canRedact: false,
    canStyle: false,
    canUseContextMenu: false,
  },
}
```

`selectionBounds`, when present, contains `page` and `viewport` rectangles as
plain numbers relative to the selected page and the pdf viewer container.
`contextTarget` mirrors the current target kind/page/editor ids without exposing
pdf.js mutable objects. Annotation editor ids/count/details come through the
pdf.js `AnnotationEditorUIManager#getSelectedEditors()` facade and are
normalized under `viewer-next/src/pdf/` before reaching React.

`contextTarget.kind` is the concrete target for target-specific UI, currently
`text`, `freetext`, `highlight`, `ink`, `image`, `stamp`, `signature`,
`native-text`, or `redaction`. `selectionKind` remains the broader class
(`text`, `annotation-editor`, `native-text`, `redaction`, or `none`) for simple
toolbar state.

React surfaces should render visible selection capabilities from this model and
send actions back through engine methods such as `setTool`,
`addCommentToSelection`, `addBookmarkFromSelection`, and
`deleteSelectedAnnotation`; pdf.js then emits the next confirmed state. The
floating toolbar, Edit side nav text-formatting panel, bookmarks/comment header
actions, capability panel, context target action strip, and the lightweight
Viewer Next context menu now consume this normalized state. The context menu asks
the engine for `readInteractionStateAtPoint({ clientX, clientY })` before
opening, which lets pdf.js confirm annotation-editor selection at the pointer
without React duplicating hit testing.

Legacy fields such as `viewerState.activeTool`,
`viewerState.editing.hasSelectedEditor`, and
`viewerState.bookmarks.canAddFromSelection` remain compatibility/debt for older
surfaces and state assertions while remaining consumers migrate. Broad
`viewerState.capabilities` is still the support/static capability bucket for
features such as native text edit, native redact, print, annotation tool support,
and signature/image availability; target-specific selection actions should use
`viewerInteractionState.capabilities` instead.

Signature and image tools are exposed through the annotation-editor facade and
signature dialog/storage adapters. Viewer Next should only show richer popovers
or reuse affordances from confirmed `annotationTools`/signature storage support,
not by importing classic viewer UI state directly.

## Native Integration Direction

The next architecture slice should make the pdf boundary emit a normalized
Viewer Next interaction state instead of letting React surfaces infer pdf.js
state independently.

Long term, Viewer Next should continue to work if the classic `web/viewer` UI is
removed. `web/viewer.html?ui=next` is a compatibility/router entrypoint, not the
target runtime dependency.

The primary built URL is now
`build/generic/viewer-next/index.html?view=...`. The browser smoke opens that
direct entrypoint for the main flow and keeps `web/viewer.html?ui=next` as a
small compatibility redirect check.

Viewer Next imports shared viewer CSS and reusable viewer controllers from
`src/display`. The historical `web/` paths remain compatibility re-exports for
the classic viewer.

Target consumers include the floating toolbar, context menu, context side panel,
capability panel, and topbar status. pdf.js remains the source of truth for
document state, rendering, selection, annotation editor selection, page/scale,
history, and save/export. React remains the source of truth for product layout,
routing, open panels, preferences, and user intent.

See:

- `viewer-next-design/WEB_LOGIC_EXTRACTION_PROGRESS.md`
- `viewer-next-design/NATIVE_PDFJS_INTEGRATION_INPUT.md`
