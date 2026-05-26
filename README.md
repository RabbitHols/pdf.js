# rewirepdf

rewirepdf is a working fork of Mozilla's
[PDF.js](https://mozilla.github.io/pdf.js/) focused on native PDF editing in the
browser.

PDF.js remains the foundation for parsing, rendering, text layers, annotations,
printing, and viewer behavior. rewirepdf extends that engine with experimental
editing internals and a product shell in `viewer-next/`.

## Why This Fork Exists

Editing existing PDF content cannot be solved cleanly from a product shell
alone. A real editor needs access to the same facts PDF.js uses to parse,
evaluate, render, select, and track document state.

This fork exists because rewirepdf modifies PDF.js internals to support native,
source-based editing. The goal is to edit the original PDF content when it is
safe to do so, instead of simulating edits with white boxes, overlays, or
external conversion pipelines.

## Native Source Text Editing

rewirepdf currently includes an experimental native source text editing
pipeline.

The pipeline:

- preserves source references while PDF.js parses and evaluates text;
- exposes editable metadata through the text layer;
- maps visible text back to PDF content stream operators;
- validates replacements against the original source text, font encoding,
  operator fingerprints, layout policy, and target freshness;
- rewrites content streams conservatively through token-level filters;
- saves changes through incremental PDF updates.

This path is intentionally conservative. When PDF.js cannot prove that an edit
is safe, it should return `unsupported` with useful diagnostics rather than
guessing.

Important edge cases include text whose visible spacing comes from `TJ` spacing
numbers, page `/Contents` arrays, Form XObjects, shared resources, annotation
appearance streams, Type3 charprocs, and stale writer targets.

## Architecture Rules

- Keep native editing logic close to PDF.js core/display/viewer internals when
  it depends on parsing, evaluation, layout, fonts, operators, or incremental
  save behavior.
- Keep application workflow, policy, and UI in `viewer-next/`.
- Do not require qpdf WASM, QDF as an intermediate format, external textual
  patches, or visual whiteout/overlay tricks for native source text editing.
- Keep unsupported cases structural and diagnosable.
- Keep the classic PDF.js viewer available and avoid product-specific rewrites
  of unrelated upstream behavior.

## Viewer Next

The rewirepdf product shell lives in `viewer-next/`. It is a React/Vite
interface that uses PDF.js through the local viewer-core boundary.

Useful entry points:

```text
web/viewer.html?ui=next
build/generic/viewer-next/index.html
```

## Development

From this repository root:

```bash
npm install
npm run viewer-next:dev -- --host 127.0.0.1
npm run viewer-next:build
npm run viewer-next:smoke
```

Use `npm run viewer-next:build` for general Viewer Next and integration changes.
Use `npm run viewer-next:smoke` for upload, rendering, navigation, or PDF viewer
behavior changes.

The underlying PDF.js generic build is still available through the usual gulp
tasks, for example:

```bash
npx gulp generic
npx gulp server
```

## Status

rewirepdf is experimental. The native editing work is active, browser-based, and
intended to remain conservative: correctness and explicit diagnostics matter
more than pretending every PDF is editable.

This repository is a fork of Mozilla PDF.js. PDF.js is developed and maintained
by Mozilla and its contributors; rewirepdf builds on that work.
