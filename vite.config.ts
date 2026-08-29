import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build works at the root, under a GitHub
  // Pages project path (/Markdown-machine/), or anywhere else it is served from.
  // The app has no client-side routing, so nothing else depends on the base.
  base: './',
});
