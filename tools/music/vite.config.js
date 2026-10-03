// The Strudel REPL for Stonefall's music: `npm run repl` in tools/music.
//
// Ctrl+S in the editor posts the code here and it is written to stonefall.strudel, which is what
// `npm run render` turns into the game's audio files.
import fs from 'node:fs';
import { defineConfig } from 'vite';

const track = new URL('./stonefall.strudel', import.meta.url);

export default defineConfig({
  server: { port: 7480, strictPort: true },
  plugins: [
    {
      name: 'save-track',
      configureServer(server) {
        server.middlewares.use('/__save', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            fs.writeFileSync(track, body);
            res.end('saved');
          });
        });
      },
    },
  ],
});
