# rewirepdf PDF.js Fork

This repository is rewirepdf's working fork of Mozilla's
[PDF.js](https://mozilla.github.io/pdf.js/). We keep PDF.js as the rendering,
parsing, text-layer, annotation, printing, and viewer engine, while rewirepdf
adds a product shell and experimental editing workflows around it.

The main rewirepdf application in this checkout lives in `viewer-next/`. It is a
React/Vite product interface that opens through explicit Viewer Next entry
points, such as:

```text
web/viewer.html?ui=next
```

The classic PDF.js viewer remains available and should continue to behave like
the upstream project.

## Why rewirepdf Forked PDF.js

rewirepdf needs deeper PDF editing capabilities than a product shell can provide
from the outside. This fork exists because we have started modifying PDF.js
internals to support future native PDF editing, especially source-based text
editing of existing PDF content.

The long-term goal is to let a user click existing text, edit it inline, and
save a real replacement into the original PDF content stream using PDF.js'
own architecture: parser, evaluator, font encoding checks, content stream
planning, token-level rewriting, and incremental saving. This is intentionally
different from placing a visual overlay on top of the old text.

The native text edit path is conservative by design. When PDF.js cannot prove
that an edit is safe, it should return `unsupported` with useful diagnostics
instead of guessing. Important examples include text whose visible spacing comes
from `TJ` spacing numbers rather than glyph spaces, page `/Contents` arrays,
Form XObjects, shared resources, annotation appearances, Type3 charprocs, and
stale writer targets.

Those capabilities belong in PDF.js core and viewer internals because they
depend on how PDF.js parses, evaluates, renders, selects, annotates, and tracks
document state. Viewer Next uses those capabilities from the product UI, but the
enabling work is intentionally close to the engine.

The goal is not to turn PDF.js core into a rewirepdf product layer. The goal is
to keep a focused fork where the engine can grow the minimal internal
affordances needed for editing, while application workflow, policy, and user
experience remain in `viewer-next/` and adjacent rewirepdf packages.

## What This Fork Is

- A PDF.js editor fork that stays close enough to Mozilla upstream to keep
  rebasing and syncing practical.
- A PDF.js engine branch with carefully scoped internal changes for future
  native PDF editing support.
- A place for small, guarded integration points that expose stable PDF viewer
  facts to the rewirepdf UI.
- The home of `viewer-next/`, where rewirepdf builds product workflows such as
  editing, signing, page organization, combining PDFs, and future creation or
  conversion tools.

## Native Text Edit Direction

The experimental native editing work should stay PDF.js-like:

- Source refs are collected during parsing/evaluation and propagated to the text
  layer as editable metadata.
- The viewer builds a text edit intent; the worker/core validates fonts,
  source text, operator fingerprints, layout policy, and target freshness.
- Content streams are rewritten through a token/filter path that validates the
  original anchor before replacing operands.
- Page content streams, multi-stream `/Contents`, and future container-aware
  targets such as Form XObjects are handled by explicit support rules.
- Unsupported cases should be structural and diagnosable, not silent visual
  fallbacks.

The core should not require qpdf WASM, QDF as an intermediate format, external
textual patches, or whiteout/overlay tricks for this native source text edit
pipeline.

## rewirepdf Development

From this repository root:

```bash
npm run viewer-next:dev -- --host 127.0.0.1
npm run viewer-next:build
npm run viewer-next:smoke
```

Use `npm run viewer-next:build` for general Viewer Next changes. Use
`npm run viewer-next:smoke` when changing upload, rendering, navigation, or PDF
viewer integration behavior.

## Upstream PDF.js

The sections below are the upstream PDF.js README content and remain useful for
working with the underlying engine.

# PDF.js [![CI](https://github.com/mozilla/pdf.js/actions/workflows/ci.yml/badge.svg?query=branch%3Amaster)](https://github.com/mozilla/pdf.js/actions/workflows/ci.yml?query=branch%3Amaster) [![codecov](https://codecov.io/gh/mozilla/pdf.js/branch/master/graph/badge.svg)](https://codecov.io/gh/mozilla/pdf.js)

[PDF.js](https://mozilla.github.io/pdf.js/) is a Portable Document Format (PDF) viewer that is built with HTML5.

PDF.js is community-driven and supported by Mozilla. Its goal is to
create a general-purpose, web standards-based platform for parsing and
rendering PDFs.

## Contributing

PDF.js is an open source project and always looking for more contributors. To
get involved, visit:

+ [Issue Reporting Guide](https://github.com/mozilla/pdf.js/blob/master/.github/CONTRIBUTING.md)
+ [Code Contribution Guide](https://github.com/mozilla/pdf.js/wiki/Contributing)
+ [Frequently Asked Questions](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)
+ [Good Beginner Bugs](https://github.com/mozilla/pdf.js/issues?q=is%3Aissue%20state%3Aopen%20label%3Agood-beginner-bug)
+ [Projects](https://github.com/mozilla/pdf.js/projects)

Feel free to stop by our [Matrix room](https://chat.mozilla.org/#/room/#pdfjs:mozilla.org) for questions or guidance.

## Getting Started

### Online demo

Please note that the "Modern browsers" version assumes native support for the
latest JavaScript features; please also see [this wiki page](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-support).

+ Modern browsers: https://mozilla.github.io/pdf.js/web/viewer.html

+ Older browsers: https://mozilla.github.io/pdf.js/legacy/web/viewer.html

### Browser Extensions

#### Firefox

PDF.js is built into version 19+ of Firefox.

#### Chrome

+ The official extension for Chrome can be installed from the [Chrome Web Store](https://chrome.google.com/webstore/detail/pdf-viewer/oemmndcbldboiebfnladdacbdfmadadm).
*This extension is maintained by [@Rob--W](https://github.com/Rob--W).*
+ Build Your Own - Get the code as explained below and issue `npx gulp chromium`. Then open
Chrome, go to `Tools > Extension` and load the (unpackaged) extension from the
directory `build/chromium`.

### PDF debugger

Browser the internal structure of a PDF document with https://mozilla.github.io/pdf.js/internal-viewer/web/debugger.html

## Getting the Code

To get a local copy of the current code, clone it using git:

    $ git clone https://github.com/mozilla/pdf.js.git
    $ cd pdf.js

Next, install Node.js via the [official package](https://nodejs.org) or via
[nvm](https://github.com/creationix/nvm). If everything worked out, install
all dependencies for PDF.js:

    $ npm install

Finally, you need to start a local web server as some browsers do not allow opening
PDF files using a `file://` URL. Run:

    $ npx gulp server

and then you can open:

+ http://localhost:8888/web/viewer.html

Please keep in mind that this assumes the latest version of Mozilla Firefox; refer to [Building PDF.js](https://github.com/mozilla/pdf.js/blob/master/README.md#building-pdfjs) for non-development usage of the PDF.js library.

It is also possible to view all test PDF files on the right side by opening:

+ http://localhost:8888/test/pdfs/?frame

## Building PDF.js

In order to bundle all `src/` files into two production scripts and build the generic
viewer, run:

    $ npx gulp generic

If you need to support older browsers, run:

    $ npx gulp generic-legacy

This will generate `pdf.js` and `pdf.worker.js` in the `build/generic/build/` directory (respectively `build/generic-legacy/build/`).
Both scripts are needed but only `pdf.js` needs to be included since `pdf.worker.js` will
be loaded by `pdf.js`. The PDF.js files are large and should be minified for production.

## Using PDF.js in a web application

To use PDF.js in a web application you can choose to use a pre-built version of the library
or to build it from source. We supply pre-built versions for usage with NPM under
the `pdfjs-dist` name. For more information and examples please refer to the
[wiki page](https://github.com/mozilla/pdf.js/wiki/Setup-pdf.js-in-a-website) on this subject.

## Including via a CDN

PDF.js is hosted on several free CDNs:
 - https://www.jsdelivr.com/package/npm/pdfjs-dist
 - https://cdnjs.com/libraries/pdf.js
 - https://unpkg.com/pdfjs-dist/

## Learning

You can play with the PDF.js API directly from your browser using the live demos below:

+ [Interactive examples](https://mozilla.github.io/pdf.js/examples/index.html#interactive-examples)

More examples can be found in the [examples folder](https://github.com/mozilla/pdf.js/tree/master/examples/). Some of them are using the pdfjs-dist package, which can be built and installed in this repo directory via `npx gulp dist-install` command.

For an introduction to the PDF.js code, check out the presentation by our
contributor Julian Viereck:

+ https://www.youtube.com/watch?v=Iv15UY-4Fg8

More learning resources can be found at:

+ https://github.com/mozilla/pdf.js/wiki/Additional-Learning-Resources

The API documentation can be found at:

+ https://mozilla.github.io/pdf.js/api/

## Questions

Check out our FAQs and get answers to common questions:

+ https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions

Talk to us on Matrix:

+ https://chat.mozilla.org/#/room/#pdfjs:mozilla.org

File an issue:

+ https://github.com/mozilla/pdf.js/issues/new/choose
