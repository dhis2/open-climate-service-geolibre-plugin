import { readFileSync } from "node:fs";
import { defineConfig, transformWithEsbuild, type Plugin } from "vite";

// Single source of truth for the plugin version: package.json. Injected into the
// bundle below so the plugin object's `version` can't drift from the manifest (the
// GeoLibre registry requires the entry module's version to match plugin.json).
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Library mode leaves whitespace in ES output so a downstream bundler keeps the
// `/*#__PURE__*/` annotations. Nothing bundles this file again: GeoLibre imports it as is and
// users download it from the plugin marketplace, so minify the finished chunk.
function minifyBundle(): Plugin {
  return {
    name: "ocs-minify-bundle",
    apply: "build",
    async renderChunk(code, chunk) {
      const result = await transformWithEsbuild(code, chunk.fileName, {
        minify: true,
        format: "esm",
        target: "es2022",
        sourcemap: true,
      });
      return { code: result.code, map: JSON.stringify(result.map) };
    },
  };
}

// Single-file ES bundle for GeoLibre: the plugin and chroma-js. Zarr rendering and
// MapLibre come from the GeoLibre host through its app API (addZarrLayer), so neither is
// imported here.
export default defineConfig({
  publicDir: false,
  plugins: [minifyBundle()],
  define: { __OCS_PLUGIN_VERSION__: JSON.stringify(version) },
  build: {
    outDir: "geolibre-plugin/dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    lib: {
      entry: "src/plugin.ts",
      formats: ["es"],
      fileName: () => "index.js",
      cssFileName: "style"
    },
    rollupOptions: {
      output: {
        // Emit one self-contained index.js even if a dependency adds a dynamic import: a
        // single file is safer for the GeoLibre plugin loader and keeps the bundle offline.
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) =>
          (assetInfo.names ?? []).includes("style.css") ? "style.css" : "[name][extname]"
      }
    }
  }
});
