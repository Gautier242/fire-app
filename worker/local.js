// Run the coordination worker on this machine, against memory, so the owner can
// see and use it before deciding whether it should exist in public.
//
// Nothing here is deployed and nothing here talks to Cloudflare. It is the same
// handler the Worker entrypoint calls, given the in-memory store the tests use, so
// what you click is what would ship -- including every refusal.
//
// Data lives in this process only: stop the server and every post is gone. That is
// deliberate. A local copy accumulating real people's messages would be the one
// thing this design is trying to avoid.
//
//   node worker/local.js            -> http://localhost:8787
//
// stdlib only. Node 18+ has Request, Response and Headers as globals, so the whole
// adapter is the twenty lines below.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { handle } from './index.js';
import { memoryStore } from './memory_store.js';

const PORT = Number(process.env.PORT || 8787);
const HERE = dirname(fileURLToPath(import.meta.url));

// The moderator token is printed at startup rather than hidden in an env file: on
// this machine the point is to try the queue, and a token nobody can find is a
// review screen nobody opens.
const MODERATOR_TOKEN = 'local-moderator';

const ctx = {
  store: memoryStore(),
  now: () => Date.now(),
  moderatorToken: MODERATOR_TOKEN,
};

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

const server = createServer(async (req, res) => {
  const url = `http://localhost:${PORT}${req.url}`;

  if (!req.url.startsWith('/api/')) {
    // The demo page, so there is something to click rather than only curl. The query
    // string is stripped before routing: the moderator link carries ?token=, and
    // matching on the raw URL sent it looking for a file named after the token.
    const path = req.url.split('?')[0];
    const file = path === '/' || path === '' ? 'demo.html' : path.slice(1);
    try {
      const page = await readFile(join(HERE, file));
      res.writeHead(200, { 'content-type': file.endsWith('.html')
        ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' });
      res.end(page);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
    return;
  }

  // Cloudflare sets CF-Connecting-IP at its edge; nothing sets it here, and the
  // handler refuses a write it cannot attribute. Supplying the socket address keeps
  // the per-address limit real rather than bypassed: every request from this browser
  // shares one address, so five posts in an hour is reachable in a few clicks. That
  // is the point -- the limits are the product, and they should be easy to feel.
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  headers.set('CF-Connecting-IP',
    req.socket.remoteAddress ? String(req.socket.remoteAddress) : '127.0.0.1');

  const request = new Request(url, {
    method: req.method,
    headers,
    body: await body(req),
  });

  const response = await handle(request, ctx);
  const out = {};
  response.headers.forEach((value, key) => { out[key] = value; });
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, () => {
  process.stdout.write(
    `\ncoordination board, local only, nothing published anywhere\n`
    + `  page       http://localhost:${PORT}/\n`
    + `  moderator  http://localhost:${PORT}/?token=${MODERATOR_TOKEN}\n`
    + `  storage    memory; everything disappears when you stop this\n\n`
    + `Ctrl-C to stop.\n\n`);
});
