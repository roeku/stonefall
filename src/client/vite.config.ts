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
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        default: path.resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name][extname]',
        sourcemapFileNames: '[name].js.map',
      },
    },
  },
});
