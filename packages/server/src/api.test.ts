import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleApi } from './api.ts';
import { SqliteStore } from './store.ts';
import { EventBus } from './bus.ts';
import type { ParsedMessage } from './types.ts';

function msg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    smtpUser: 'cfp',
    messageId: '<abc@cfp.dev>',
    fromAddr: 'no_reply+dev@cfp.dev',
    fromDisplay: 'Devoxx CFP <no_reply+dev@cfp.dev>',
    toAddrs: ['speaker@example.com'],
    ccAddrs: [],
    subject: 'Your talk was accepted',
    html: '<h1>Accepted</h1>',
    text: 'Accepted',
    raw: 'Subject: Your talk was accepted\r\n\r\nAccepted',
    headers: { subject: 'Your talk was accepted' },
    sizeBytes: 42,
    parseError: null,
    attachments: [],
    receivedAt: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

async function harness() {
  const store = new SqliteStore(':memory:', 500);
  const bus = new EventBus();
  const server = createServer((req, res) => {
    if (!handleApi(req, res, store, bus)) {
      res.writeHead(404).end('not api');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    store,
    bus,
    base,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    },
  };
}

test('GET /api/inboxes lists inboxes with counts', async () => {
  const h = await harness();
  h.store.saveMessage(msg());
  const res = await fetch(`${h.base}/api/inboxes`);
  assert.equal(res.status, 200);
  const inboxes = await res.json();
  assert.equal(inboxes.length, 1);
  assert.equal(inboxes[0].smtpUser, 'cfp');
  assert.equal(inboxes[0].messageCount, 1);
  await h.close();
});

test('PATCH /api/inboxes/:id renames', async () => {
  const h = await harness();
  const { inbox } = h.store.ensureInbox('cfp');
  const res = await fetch(`${h.base}/api/inboxes/${inbox.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Call for Papers' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, 'Call for Papers');
  assert.equal((await (await fetch(`${h.base}/api/inboxes/999`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  })).status), 404);
  await h.close();
});

test('GET /api/inboxes/:id/messages supports search and paging', async () => {
  const h = await harness();
  h.store.saveMessage(msg({ subject: 'Talk accepted', receivedAt: '2026-08-12T10:00:00.000Z' }));
  h.store.saveMessage(msg({ subject: 'Password reset', receivedAt: '2026-08-12T11:00:00.000Z' }));
  const id = h.store.listInboxes()[0].id;

  const all = await (await fetch(`${h.base}/api/inboxes/${id}/messages`)).json();
  assert.deepEqual(all.map((m: { subject: string }) => m.subject), ['Password reset', 'Talk accepted']);

  const searched = await (await fetch(`${h.base}/api/inboxes/${id}/messages?q=accepted`)).json();
  assert.equal(searched.length, 1);

  const paged = await (await fetch(`${h.base}/api/inboxes/${id}/messages?limit=1&offset=1`)).json();
  assert.deepEqual(paged.map((m: { subject: string }) => m.subject), ['Talk accepted']);
  await h.close();
});

test('GET /api/messages/:id returns the full message, and 404s when missing', async () => {
  const h = await harness();
  const saved = h.store.saveMessage(msg());
  const full = await (await fetch(`${h.base}/api/messages/${saved.message.id}`)).json();
  assert.equal(full.html, '<h1>Accepted</h1>');
  assert.equal(full.raw, 'Subject: Your talk was accepted\r\n\r\nAccepted');
  assert.equal((await fetch(`${h.base}/api/messages/999`)).status, 404);
  await h.close();
});

test('GET /api/messages/:id/raw downloads the source as .eml', async () => {
  const h = await harness();
  const saved = h.store.saveMessage(msg());
  const res = await fetch(`${h.base}/api/messages/${saved.message.id}/raw`);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  assert.equal(res.headers.get('content-disposition'), `attachment; filename="message-${saved.message.id}.eml"`);
  assert.equal(await res.text(), 'Subject: Your talk was accepted\r\n\r\nAccepted');
  await h.close();
});

test('DELETE /api/messages/:id removes it and emits an event', async () => {
  const h = await harness();
  const saved = h.store.saveMessage(msg());
  const events: string[] = [];
  h.bus.subscribe((e) => events.push(e.type));

  assert.equal((await fetch(`${h.base}/api/messages/${saved.message.id}`, { method: 'DELETE' })).status, 204);
  assert.equal(h.store.getMessage(saved.message.id), undefined);
  assert.deepEqual(events, ['message.deleted']);
  assert.equal((await fetch(`${h.base}/api/messages/${saved.message.id}`, { method: 'DELETE' })).status, 404);
  await h.close();
});

test('DELETE /api/inboxes/:id/messages clears it and emits an event', async () => {
  const h = await harness();
  h.store.saveMessage(msg());
  const id = h.store.listInboxes()[0].id;
  const events: string[] = [];
  h.bus.subscribe((e) => events.push(e.type));

  assert.equal((await fetch(`${h.base}/api/inboxes/${id}/messages`, { method: 'DELETE' })).status, 204);
  assert.equal(h.store.getInbox(id)?.messageCount, 0);
  assert.deepEqual(events, ['messages.cleared']);
  await h.close();
});

test('GET /api/events streams bus events as SSE', async () => {
  const h = await harness();
  const controller = new AbortController();
  const res = await fetch(`${h.base}/api/events`, { signal: controller.signal });
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /^: connected/);

  h.store.saveMessage(msg());
  h.bus.emit({ type: 'messages.cleared', inboxId: 1 });
  const next = await reader.read();
  const chunk = new TextDecoder().decode(next.value);
  assert.match(chunk, /data: /);
  assert.match(chunk, /messages\.cleared/);

  controller.abort();
  await h.close();
});

test('an unknown /api path is a JSON 404, and non-api paths fall through', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/api/nope`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.equal((await res.json()).error, 'Not found');

  assert.equal(await (await fetch(`${h.base}/index.html`)).text(), 'not api');
  await h.close();
});
