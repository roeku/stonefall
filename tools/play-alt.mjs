// A second play server, for when another chat already has `npm run play` on :7474.
//
// The same Vite config and in-memory mock as `npm run play`, on another port, with a dep cache
// of its own: two servers sharing node_modules/.vite can re-optimise deps under each other, and
// the page on the other port then fails to load its modules. Its mock state is its own too, so
// nothing done here shows up on :7474. `.claude/launch.json` runs it as "stonefall-play-alt".
//
//   node tools/play-alt.mjs [port]    (default 7475)
import path from 'node:path';
import { createServer } from 'vite';

const repo = path.resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] ?? 7475);

const server = await createServer({
  configFile: path.join(repo, 'src/client/vite.config.ts'),
  root: path.join(repo, 'src/client'),
  cacheDir: path.join(repo, `node_modules/.vite-${port}`),
  server: { port, strictPort: true, host: true },
});
await server.listen();
server.printUrls();
