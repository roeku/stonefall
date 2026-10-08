import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'fs/promises';
import path from 'path';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { mockApiPlugin } from './devServer/mockApi';

/**
 * R3F's <Canvas> calls `extend(THREE)`, which registers every three.js class so that any tag
 * works, and keeps all of three in the bundle. This has it register THREE_CATALOGUE instead: the
 * classes the game creates by tag (threeCatalogue.ts). Applied to the build and to the dev
 * server's pre-bundled dependencies alike, so a tag missing from the catalogue fails in
 * `npm run play` the same way it would on Reddit.
 */
const R3F_ENTRY = /@react-three[\\/]fiber[\\/]dist[\\/]react-three-fiber\.esm\.js$/;
const R3F_EXTEND = 'React.useMemo(() => extend(THREE), []);';
const CATALOGUE = path.resolve(__dirname, 'threeCatalogue.ts');

const registerCatalogue = (code: string): string => {
  // Fails the build rather than quietly shipping all of three once R3F changes this line.
  if (!code.includes(R3F_EXTEND))
    throw new Error('threeCatalogue: R3F no longer calls extend(THREE); update vite.config.ts');
  return (
    `import { THREE_CATALOGUE } from ${JSON.stringify(CATALOGUE)};\n` +
    code.replace(R3F_EXTEND, 'React.useMemo(() => extend(THREE_CATALOGUE), []);')
  );
};

const threeCatalogue = (): Plugin => ({
  name: 'three-catalogue',
  enforce: 'pre',
  transform(code, id) {
    if (R3F_ENTRY.test(id)) return { code: registerCatalogue(code), map: null };
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  // mockApiPlugin only attaches middleware in `configureServer`, so it is inert during
  // `vite build` and adds nothing to the shipped bundle. It exists so the real client can be
  // played in a browser without Devvit auth, an upload, or a subreddit.
  plugins: [react(), tailwind(), mockApiPlugin(), threeCatalogue()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
    esbuildOptions: {
      plugins: [
        {
          name: 'three-catalogue',
          setup(build) {
            build.onLoad({ filter: R3F_ENTRY }, async (args) => ({
              contents: registerCatalogue(await readFile(args.path, 'utf8')),
              loader: 'js',
            }));
          },
        },
      ],
    },
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
