import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SqliteStore } from './store.ts';
import type { EventBus } from './bus.ts';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not found' });
}

/**
 * Parses `?limit=`, defaulting to 50 and clamping to [1, 200]. Missing or non-finite falls
 * back to the default. Truncated to an integer — SQLite's `LIMIT` rejects fractional values
 * with a "datatype mismatch" error, so a value like `2.7` must not reach the driver as-is.
 */
function parseLimit(raw: string | null): number {
  if (raw === null) return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.trunc(Math.max(1, Math.min(n, 200)));
}

/**
 * Parses `?offset=`, defaulting to 0 and clamping to [0, Number.MAX_SAFE_INTEGER]. Missing or
 * non-finite falls back to the default. Truncated to an integer for the same reason as
 * `parseLimit`, and bounded above so an overflowed value (e.g. `1e21`) can't reach SQLite,
 * which also rejects a fractional or out-of-range `OFFSET` with "datatype mismatch".
 */
function parseOffset(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(Math.max(0, Math.min(n, Number.MAX_SAFE_INTEGER)));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function streamEvents(res: ServerResponse, bus: EventBus, req: IncomingMessage): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const unsubscribe = bus.subscribe((event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  // Keeps proxies and idle sockets from dropping a quiet stream.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

  const stop = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', stop);
  res.on('close', stop);
}

/**
 * Handles /api/* requests. Returns false for anything else so the caller can
 * fall through to static file serving.
 */
export function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  store: SqliteStore,
  bus: EventBus,
): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;

  const segments = url.pathname.split('/').filter(Boolean).slice(1); // drop 'api'
  const method = req.method ?? 'GET';

  void (async () => {
    try {
      // GET /api/events
      if (method === 'GET' && segments[0] === 'events' && segments.length === 1) {
        return streamEvents(res, bus, req);
      }

      // GET /api/inboxes
      if (method === 'GET' && segments[0] === 'inboxes' && segments.length === 1) {
        return sendJson(res, 200, store.listInboxes());
      }

      // PATCH /api/inboxes/:id
      if (method === 'PATCH' && segments[0] === 'inboxes' && segments.length === 2) {
        let body: { name?: unknown };
        try {
          body = (await readJsonBody(req)) as { name?: unknown };
        } catch {
          // Don't leak the JSON parser's internal message (e.g. "Unexpected
          // token X in JSON at position N") to the client.
          return sendJson(res, 400, { error: 'Malformed JSON body' });
        }
        if (typeof body.name !== 'string' || body.name.trim() === '') {
          return sendJson(res, 400, { error: 'name must be a non-empty string' });
        }
        const inbox = store.renameInbox(Number(segments[1]), body.name.trim());
        return inbox ? sendJson(res, 200, inbox) : notFound(res);
      }

      // GET /api/inboxes/:id/messages
      if (method === 'GET' && segments[0] === 'inboxes' && segments[2] === 'messages' && segments.length === 3) {
        const inboxId = Number(segments[1]);
        if (!store.getInbox(inboxId)) return notFound(res);
        const limit = parseLimit(url.searchParams.get('limit'));
        const offset = parseOffset(url.searchParams.get('offset'));
        const q = url.searchParams.get('q') ?? undefined;
        return sendJson(res, 200, store.listMessages(inboxId, { q, limit, offset }));
      }

      // DELETE /api/inboxes/:id/messages
      if (method === 'DELETE' && segments[0] === 'inboxes' && segments[2] === 'messages' && segments.length === 3) {
        const inboxId = Number(segments[1]);
        if (!store.getInbox(inboxId)) return notFound(res);
        store.clearInbox(inboxId);
        bus.emit({ type: 'messages.cleared', inboxId });
        return res.writeHead(204).end();
      }

      // GET /api/messages/:id/raw
      if (method === 'GET' && segments[0] === 'messages' && segments[2] === 'raw' && segments.length === 3) {
        const message = store.getMessage(Number(segments[1]));
        if (!message) return notFound(res);
        res.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `attachment; filename="message-${message.id}.eml"`,
        });
        return res.end(message.raw);
      }

      // GET /api/messages/:id
      if (method === 'GET' && segments[0] === 'messages' && segments.length === 2) {
        const message = store.getMessage(Number(segments[1]));
        return message ? sendJson(res, 200, message) : notFound(res);
      }

      // DELETE /api/messages/:id
      if (method === 'DELETE' && segments[0] === 'messages' && segments.length === 2) {
        const deleted = store.deleteMessage(Number(segments[1]));
        if (!deleted) return notFound(res);
        bus.emit({ type: 'message.deleted', id: Number(segments[1]), inboxId: deleted.inboxId });
        return res.writeHead(204).end();
      }

      notFound(res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
      else res.end();
    }
  })();

  return true;
}
