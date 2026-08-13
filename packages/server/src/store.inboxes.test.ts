import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from './store.ts';

function newStore() {
  return new SqliteStore(':memory:', 500);
}

test('ensureInbox creates an inbox on first use and reuses it after', () => {
  const store = newStore();
  const first = store.ensureInbox('240f00ce858a00');
  assert.equal(first.created, true);
  assert.equal(first.inbox.smtpUser, '240f00ce858a00');
  assert.equal(first.inbox.name, '240f00ce858a00');
  assert.equal(first.inbox.messageCount, 0);
  assert.equal(first.inbox.latestReceivedAt, null);

  const second = store.ensureInbox('240f00ce858a00');
  assert.equal(second.created, false);
  assert.equal(second.inbox.id, first.inbox.id);
  assert.equal(store.listInboxes().length, 1);
  store.close();
});

test('different SMTP users get different inboxes', () => {
  const store = newStore();
  const a = store.ensureInbox('app-one');
  const b = store.ensureInbox('app-two');
  assert.notEqual(a.inbox.id, b.inbox.id);
  assert.deepEqual(store.listInboxes().map((i) => i.smtpUser).sort(), ['app-one', 'app-two']);
  store.close();
});

test('renameInbox changes the display name but not the routing key', () => {
  const store = newStore();
  const { inbox } = store.ensureInbox('240f00ce858a00');
  const renamed = store.renameInbox(inbox.id, 'Call for Papers');
  assert.equal(renamed?.name, 'Call for Papers');
  assert.equal(renamed?.smtpUser, '240f00ce858a00');
  assert.equal(store.ensureInbox('240f00ce858a00').inbox.id, inbox.id);
  store.close();
});

test('renameInbox returns undefined for an unknown inbox', () => {
  const store = newStore();
  assert.equal(store.renameInbox(999, 'nope'), undefined);
  store.close();
});

test('schema survives reopening the same database file', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'mailtraxx-'));
  const path = join(dir, 'nested', 'test.db');

  const first = new SqliteStore(path, 500);
  first.ensureInbox('persisted');
  first.close();

  const second = new SqliteStore(path, 500);
  assert.equal(second.listInboxes()[0].smtpUser, 'persisted');
  second.close();
  await rm(dir, { recursive: true, force: true });
});
