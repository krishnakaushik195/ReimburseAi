import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Loaded with native require: PGlite reads its WASM/data files and tesseract.js spawns worker threads from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "tesseract.js"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/zlibjs/**/*",
    ],
  },
  experimental: {
    serverActions: {
      // Receipts are uploaded through a Server Action (10 MB limit + multipart overhead).
      bodySizeLimit: "11mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
