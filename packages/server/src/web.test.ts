import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from './web.ts';
import { SqliteStore } from './store.ts';
import { EventBus } from './bus.ts';
import { parseConfig } from './config.ts';

async function harness() {
  const uiRoot = await mkdtemp(join(tmpdir(), 'mailtraxx-ui-'));
  await writeFile(join(uiRoot, 'index.html'), '<title>mailtraxx</title>');
  await mkdir(join(uiRoot, 'assets'), { recursive: true });
  await writeFile(join(uiRoot, 'assets', 'app.js'), 'console.log(1)');

  const store = new SqliteStore(':memory:', 500);
  const bus = new EventBus();
  const web = await startWebServer(parseConfig(['--http-port', '0']), store, bus, uiRoot);
  return {
    base: `http://127.0.0.1:${web.port}`,
    store,
    async close() {
      await web.close();
      store.close();
      await rm(uiRoot, { recursive: true, force: true });
    },
  };
}

test('serves the SPA index at the root', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await res.text(), /mailtraxx/);
  await h.close();
});

test('serves static assets with the right content type', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/assets/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  await h.close();
});

test('falls back to index.html for SPA deep links', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/inbox/1/message/2`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /mailtraxx/);
  await h.close();
});

test('still routes /api requests to the API', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/api/inboxes`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
  await h.close();
});

test('refuses to serve files outside the UI root', async () => {
  const h = await harness();
  // fetch() would normalize the `..` segments away client-side, so the guard would
  // never see them. node:http sends the path verbatim, which is what an attacker does.
  const { request } = await import('node:http');
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: Number(new URL(h.base).port), path: '/../../../etc/passwd', method: 'GET' },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
  await h.close();
});

test(
  "close() doesn't hang behind an open /api/events SSE connection",
  { timeout: 5000 },
  async () => {
    const h = await harness();
    // A real UI holds this connection open indefinitely; server.close() alone
    // waits for every open connection to end on its own, so a naive
    // implementation would hang here forever once the SPA is generating
    // traffic like this.
    const controller = new AbortController();
    const res = await fetch(`${h.base}/api/events`, { signal: controller.signal });
    assert.equal(res.status, 200);
    res.body?.getReader().read().catch(() => {});

    const closed = h.close();
    const timedOut = await Promise.race([
      closed.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 2000)),
    ]);
    // Release the client socket either way so a regression can't hang the
    // rest of the suite while this assertion fails loudly instead.
    controller.abort();
    assert.equal(timedOut, false, 'close() should not wait for the SSE client to disconnect first');
    await closed;
  },
);

test('reports a busy port instead of crashing anonymously', async () => {
  const store = new SqliteStore(':memory:', 500);
  const bus = new EventBus();
  const first = await startWebServer(parseConfig(['--http-port', '0']), store, bus, tmpdir());
  await assert.rejects(
    startWebServer(parseConfig(['--http-port', String(first.port)]), store, bus, tmpdir()),
    /already in use/,
  );
  await first.close();
  store.close();
});
