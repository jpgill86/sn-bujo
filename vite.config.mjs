import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    port: 8001,
    cors: true,
  },
  preview: {
    port: 8001,
    cors: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // public/ext.json is a dev-only manifest (points at localhost:8001);
    // the production manifest is generated separately by
    // scripts/build-manifest.mjs, so don't copy public/ into dist/.
    copyPublicDir: false,
  },
})
