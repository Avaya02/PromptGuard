import { defineConfig } from "tsup";

/**
 * Builds the published CLI as one self-contained ESM file.
 *
 * Everything is inlined, including third-party dependencies, so installing the
 * CLI fetches a single tarball instead of ~70 packages. That is the difference
 * between a ~1s and a ~10s cold `npx promptguard`, and it leaves no transitive
 * dependency tree to audit.
 */
export default defineConfig({
  entry: { cli: "src/bin/prompt-guard.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: true,
  noExternal: [/.*/],
  banner: {
    // Several inlined dependencies are CommonJS and call require() for Node
    // built-ins, which an ESM bundle does not provide on its own.
    js: 'import { createRequire as __pgCreateRequire } from "node:module"; const require = __pgCreateRequire(import.meta.url);'
  }
});
