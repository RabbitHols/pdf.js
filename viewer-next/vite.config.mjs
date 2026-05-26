import path from "node:path";
import { createReadStream } from "node:fs";
import { access, cp, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = __dirname;
const repoRoot = path.resolve(appRoot, "..");
const usePdfjsSource = process.env.VIEWER_NEXT_PDFJS_SOURCE === "source";
const tauriDevHost = process.env.TAURI_DEV_HOST;
const isTauriBuild = Boolean(
  process.env.TAURI_ENV_PLATFORM ||
    process.env.TAURI_ENV_DEBUG ||
    tauriDevHost
);
const viewerNextOutDir = path.resolve(repoRoot, "build/generic/viewer-next");
const tauriBuildOptions = isTauriBuild
  ? {
      minify: process.env.TAURI_ENV_DEBUG ? false : "oxc",
      sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
      target:
        process.env.TAURI_ENV_PLATFORM === "windows"
          ? "chrome105"
          : "safari13",
    }
  : {};
const pdfjsRuntimeAssets = [
  {
    mount: "pdfjs/cmaps",
    sources: [["build/generic/web/cmaps", "external/bcmaps"]],
  },
  {
    mount: "pdfjs/standard_fonts",
    sources: [["build/generic/web/standard_fonts", "external/standard_fonts"]],
  },
  {
    mount: "pdfjs/wasm",
    sources: [
      ["external/jbig2"],
      ["external/openjpeg"],
      ["external/qcms"],
      ["external/quickjs"],
    ],
  },
];

const contentTypes = new Map([
  [".bcmap", "application/octet-stream"],
  [".cff", "font/cff"],
  [".js", "text/javascript; charset=utf-8"],
  [".otf", "font/otf"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
]);

function copyPdfjsRuntimeAssets() {
  return {
    name: "viewer-next-pdfjs-runtime-assets",
    async configureServer(server) {
      const assetRoots = await Promise.all(
        pdfjsRuntimeAssets.map(async ({ mount, sources }) => ({
          mount: `/${mount}/`,
          roots: await existingSourcePaths(sources),
        }))
      );
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?", 1)[0] || "";
        const assetRoot = assetRoots.find(({ mount }) => url.startsWith(mount));
        if (!assetRoot) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(
          url.slice(assetRoot.mount.length)
        );
        for (const root of assetRoot.roots) {
          const filePath = path.resolve(root, relativePath);
          if (!filePath.startsWith(`${root}${path.sep}`)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }

          try {
            const fileStat = await stat(filePath);
            if (!fileStat.isFile()) {
              continue;
            }
            res.setHeader(
              "Content-Type",
              contentTypes.get(path.extname(filePath)) ||
                "application/octet-stream"
            );
            createReadStream(filePath).pipe(res);
            return;
          } catch {}
        }
        next();
      });
    },
    async closeBundle() {
      for (const { mount, sources } of pdfjsRuntimeAssets) {
        for (const candidates of sources) {
          await cp(
            await firstExistingPath(candidates),
            path.resolve(viewerNextOutDir, mount),
            {
              dereference: true,
              recursive: true,
            }
          );
        }
      }
    },
  };
}

async function existingSourcePaths(sources) {
  return Promise.all(
    sources.map(candidates => firstExistingPath(candidates))
  );
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    const resolved = path.resolve(repoRoot, candidate);
    try {
      await access(resolved);
      return resolved;
    } catch {}
  }
  throw new Error(
    `Missing Viewer Next pdf.js asset source: ${candidates.join(", ")}`
  );
}

export default defineConfig({
  root: __dirname,
  base: "./",
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  plugins: [react(), copyPdfjsRuntimeAssets()],
  optimizeDeps: {
    include: usePdfjsSource
      ? ["@rewirepdf/pdfjs", "@rewirepdf/pdfjs/viewer-core"]
      : ["@rewirepdf/pdfjs"],
  },
  resolve: {
    alias: [
      {
        find: /^@rewirepdf\/pdfjs$/,
        replacement: path.resolve(
          repoRoot,
          usePdfjsSource ? "src/pdf.js" : "build/generic/build/pdf.mjs"
        ),
      },
      {
        find: /^@rewirepdf\/pdfjs\/viewer-core$/,
        replacement: path.resolve(
          repoRoot,
          usePdfjsSource
            ? "viewer-next/src/pdf/viewerCoreCompat.js"
            : "build/components/pdf_viewer.mjs"
        ),
      },
      {
        find: /^@rewirepdf\/pdfjs\/viewer\.css$/,
        replacement: path.resolve(repoRoot, "build/components/pdf_viewer.css"),
      },
      {
        find: "viewer-next-pdf-worker",
        replacement: path.resolve(
          repoRoot,
          usePdfjsSource
            ? "src/pdf.worker.js?url"
            : "build/generic/build/pdf.worker.mjs?url"
        ),
      },
      {
        find: "display-binary_data_factory",
        replacement: path.resolve(
          repoRoot,
          "src/display/binary_data_factory.js"
        ),
      },
      {
        find: "display-network_stream",
        replacement: path.resolve(
          repoRoot,
          "src/display/network_stream.js"
        ),
      },
      {
        find: "display-node_utils",
        replacement: path.resolve(repoRoot, "src/display/stubs.js"),
      },
      {
        find: "pdfjs-lib",
        replacement: path.resolve(
          repoRoot,
          usePdfjsSource ? "src/pdf.js" : "build/generic/build/pdf.mjs"
        ),
      },
      {
        find: "pdfjs/pdf.worker.js",
        replacement: path.resolve(
          repoRoot,
          usePdfjsSource
            ? "src/pdf.worker.js"
            : "build/generic/build/pdf.worker.mjs"
        ),
      },
      {
        find: "web-null_l10n",
        replacement: path.resolve(__dirname, "src/pdf/nullL10n.js"),
      },
    ],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    host: tauriDevHost || false,
    hmr: tauriDevHost
      ? {
          host: tauriDevHost,
          port: 5174,
          protocol: "ws",
        }
      : undefined,
    port: 5173,
    strictPort: isTauriBuild,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: viewerNextOutDir,
    emptyOutDir: true,
    ...tauriBuildOptions,
  },
});
