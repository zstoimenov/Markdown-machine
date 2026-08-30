import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build works at the root, under a GitHub
  // Pages project path (/Markdown-machine/), or anywhere else it is served from.
  // The app has no client-side routing, so nothing else depends on the base.
  base: './',
  build: {
    // The service worker reads this to know what a build actually emitted, which
    // is how it precaches the lazy editor chunk without a hand-kept list. It goes
    // under assets/ rather than Vite's default dot-directory, which static hosts
    // have opinions about.
    manifest: 'assets/build-manifest.json',
  },
});
