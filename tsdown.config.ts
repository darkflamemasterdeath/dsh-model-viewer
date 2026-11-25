import { defineConfig } from "tsdown";

/**
 * Three build faces. The host entry is Node ESM at lib/index.js.
 * The browser entry is the ModuleLoader factory at lib/client.js.
 * The scene worker is standalone ESM at lib/scene-worker.js, served over the
 * plugin's own /api route and started as a module worker by client/viewer/parse.ts.
 *
 * Each face bakes `env.NODE_ENV` into `process.env.NODE_ENV` so `shared/debug.ts`
 * can gate development instrumentation. The mode is chosen in package.json via
 * `--env.NODE_ENV=…`, which is where a reader looks for it and where the two
 * commands can differ without touching this file.
 *
 * The `production` below is only the fallback for a bare `npx tsdown` with no
 * flag. Without it the browser bundle keeps a literal `process.env.NODE_ENV`,
 * and because the browser has no `process` the plugin throws on load instead of
 * silently building the wrong mode.
 */
export default defineConfig([
  {
    entry: { index: "service/index.ts" },
    env: { NODE_ENV: "production" },
    outDir: "lib",
    minify: true,
    format: ["esm"],
    platform: "node",
    target: "es2024",
    dts: false,
    clean: true,
    fixedExtension: false,
    outExtensions: () => ({ js: ".js" }),
    deps: { neverBundle: [/^@deepseek-ai\//] },
  },
  {
    entry: { client: "client/index.tsx" },
    env: { NODE_ENV: "production" },
    outDir: "lib",
    minify: true,
    format: ["cjs"],
    platform: "browser",
    target: "es2024",
    dts: false,
    clean: false,
    fixedExtension: false,
    outExtensions: () => ({ js: ".js" }),
    deps: {
      neverBundle: [
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@deepseek-ai/dsh-client-ui-primitives",
      ],
      alwaysBundle: [
        "three",
        "three/examples/jsm/controls/OrbitControls.js",
        "three/examples/jsm/loaders/FBXLoader.js",
        "three/examples/jsm/loaders/GLTFLoader.js",
        "three/examples/jsm/loaders/OBJLoader.js",
        "three/examples/jsm/loaders/PLYLoader.js",
        "three/examples/jsm/loaders/STLLoader.js",
      ],
    },
    banner:
      'window.__ModuleLoader__.load({ id: "dsh-model-viewer", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
    footer: "return module.exports; } });",
  },
  {
    entry: { "scene-worker": "client/viewer/scene-worker.ts" },
    env: { NODE_ENV: "production" },
    outDir: "lib",
    minify: true,
    format: ["esm"],
    platform: "browser",
    target: "es2024",
    dts: false,
    clean: false,
    fixedExtension: false,
    outExtensions: () => ({ js: ".js" }),
    deps: {
      alwaysBundle: [
        "three",
        "three/examples/jsm/loaders/FBXLoader.js",
        "three/examples/jsm/loaders/GLTFLoader.js",
        "three/examples/jsm/loaders/OBJLoader.js",
        "three/examples/jsm/loaders/PLYLoader.js",
        "three/examples/jsm/loaders/STLLoader.js",
      ],
    },
  },
]);
