import { defineConfig } from 'vite';
import path from 'path';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { mockApiPlugin } from './devServer/mockApi';

// https://vitejs.dev/config/
export default defineConfig({
  // mockApiPlugin only attaches middleware in `configureServer`, so it is inert during
  // `vite build` and adds nothing to the shipped bundle. It exists so the real client can be
  // played in a browser without Devvit auth, an upload, or a subreddit.
  plugins: [react(), tailwind(), mockApiPlugin()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  build: {
    emptyOutDir: true,
    outDir: '../../dist/client',
    // Devvit uploads every file in outDir, unfiltered, as a public web view asset. The source
    // map was 6.4 MB of an 11 MB upload, re-sent on every playtest rebuild, and it published
    // the whole source. `npm run play` still serves the client with source maps.
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        default: path.resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
