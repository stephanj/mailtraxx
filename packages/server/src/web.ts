import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Config } from './config.ts';
import type { SqliteStore } from './store.ts';
import type { EventBus } from './bus.ts';
import { handleApi } from './api.ts';

export interface WebHandle {
  port: number;
  close(): Promise<void>;
}

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * True only when the `Host` header's hostname is one this server is meant to
 * answer for. Binding to 127.0.0.1 stops a remote network peer, but not a
 * remote web page: an attacker page on evil.com with a short DNS TTL can
 * rebind that hostname to 127.0.0.1, at which point `fetch('http://evil.com:1080/...')`
 * is same-origin from the browser and can read every captured message. Any
 * port is fine here — only the hostname is checked — and a missing or
 * unparseable Host header fails closed (rejected).
 */
export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return ALLOWED_HOSTNAMES.has(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function serveFile(path: string, res: ServerResponse): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': info.size,
    });
    createReadStream(path).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export async function startWebServer(
  config: Config,
  store: SqliteStore,
  bus: EventBus,
  uiRoot: string,
): Promise<WebHandle> {
  const root = resolve(uiRoot);

  const server = createServer((req, res) => {
    // UI is not meant to be embeddable; blocks framing the Delete/Clear
    // controls for clickjacking. writeHead() below merges with headers set
    // here rather than replacing them, so this survives every response path.
    res.setHeader('X-Frame-Options', 'DENY');

    if (!isAllowedHost(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
      return;
    }

    if (handleApi(req, res, store, bus)) return;

    void (async () => {
      const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
      let pathname: string;
      try {
        pathname = decodeURIComponent(rawPath);
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad Request');
        return;
      }

      // Path traversal guard, part 1: reject a literal ".." segment outright.
      // `new URL()`/`path.normalize()` both silently collapse
      // "/../../../etc/passwd" down to "/etc/passwd" (RFC 3986 dot-segment
      // removal) *before* any resolve/startsWith check ever runs, so relying
      // on the resolved path alone would let a traversal attempt through as
      // a quiet 404 instead of an explicit 403. We must inspect the raw,
      // undecoded-of-dots path first.
      if (pathname.split('/').includes('..')) {
        res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
        return;
      }

      const candidate = resolve(join(root, normalize(pathname)));

      // Path traversal guard, part 2: belt-and-suspenders — the resolved
      // path must stay under the UI root.
      if (candidate !== root && !candidate.startsWith(root + sep)) {
        res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
        return;
      }

      if (pathname !== '/' && (await serveFile(candidate, res))) return;
      // SPA fallback: unknown paths are client-side routes.
      if (await serveFile(join(root, 'index.html'), res)) return;

      res.writeHead(404, { 'content-type': 'text/plain' }).end('mailtraxx UI is not built yet');
    })();
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${config.httpPort} is already in use. Start mailtraxx with --http-port <n> to pick another.`)
          : err,
      );
    });
    server.listen(config.httpPort, '127.0.0.1', () => resolvePromise());
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((r) => {
        // server.close() alone waits for every open connection to end on its
        // own — which a long-lived /api/events SSE stream never does. Force
        // in-flight connections closed so shutdown resolves promptly instead
        // of hanging behind a client that's still listening.
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}
