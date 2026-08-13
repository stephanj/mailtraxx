import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from './store.ts';
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

test('saveMessage creates the inbox and reports it as new', () => {
  const store = new SqliteStore(':memory:', 500);
  const result = store.saveMessage(msg());
  assert.equal(result.inboxCreated, true);
  assert.equal(result.inbox.smtpUser, 'cfp');
  assert.equal(result.message.subject, 'Your talk was accepted');
  assert.deepEqual(result.message.toAddrs, ['speaker@example.com']);
  assert.equal(result.message.hasHtml, true);
  assert.equal(store.getInbox(result.inbox.id)?.messageCount, 1);

  const second = store.saveMessage(msg({ subject: 'Second' }));
  assert.equal(second.inboxCreated, false);
  store.close();
});

test('getMessage returns the full body, headers, and attachment metadata', () => {
  const store = new SqliteStore(':memory:', 500);
  const saved = store.saveMessage(
    msg({ attachments: [{ filename: 'slides.pdf', contentType: 'application/pdf', sizeBytes: 1234 }] }),
  );
  const full = store.getMessage(saved.message.id)!;
  assert.equal(full.html, '<h1>Accepted</h1>');
  assert.equal(full.text, 'Accepted');
  assert.equal(full.raw, 'Subject: Your talk was accepted\r\n\r\nAccepted');
  assert.equal(full.hasHtml, true);
  assert.deepEqual(full.headers, { subject: 'Your talk was accepted' });
  assert.deepEqual(full.attachments, [
    { filename: 'slides.pdf', contentType: 'application/pdf', sizeBytes: 1234 },
  ]);
  assert.equal(store.getMessage(999), undefined);
  store.close();
});

test('a message that failed to parse still keeps its raw source', () => {
  const store = new SqliteStore(':memory:', 500);
  const saved = store.saveMessage(
    msg({ parseError: 'Unexpected end of multipart', html: null, text: null, subject: null, raw: 'garbage' }),
  );
  const full = store.getMessage(saved.message.id)!;
  assert.equal(full.parseError, 'Unexpected end of multipart');
  assert.equal(full.raw, 'garbage');
  assert.equal(full.hasHtml, false);
  store.close();
});

test('listMessages returns newest first and pages', () => {
  const store = new SqliteStore(':memory:', 500);
  for (let i = 0; i < 5; i++) {
    store.saveMessage(msg({ subject: `Message ${i}`, receivedAt: `2026-08-12T10:0${i}:00.000Z` }));
  }
  const inboxId = store.listInboxes()[0].id;

  const firstPage = store.listMessages(inboxId, { limit: 2, offset: 0 });
  assert.deepEqual(firstPage.map((m) => m.subject), ['Message 4', 'Message 3']);

  const secondPage = store.listMessages(inboxId, { limit: 2, offset: 2 });
  assert.deepEqual(secondPage.map((m) => m.subject), ['Message 2', 'Message 1']);
  store.close();
});

test('listMessages search matches subject, sender, and recipient, case-insensitively', () => {
  const store = new SqliteStore(':memory:', 500);
  store.saveMessage(msg({ subject: 'Talk accepted', toAddrs: ['alice@example.com'] }));
  store.saveMessage(msg({ subject: 'Password reset', toAddrs: ['bob@example.com'] }));
  const inboxId = store.listInboxes()[0].id;

  assert.equal(store.listMessages(inboxId, { q: 'accepted', limit: 50, offset: 0 }).length, 1);
  assert.equal(store.listMessages(inboxId, { q: 'BOB@', limit: 50, offset: 0 }).length, 1);
  assert.equal(store.listMessages(inboxId, { q: 'devoxx cfp', limit: 50, offset: 0 }).length, 2);
  assert.equal(store.listMessages(inboxId, { q: 'nothing', limit: 50, offset: 0 }).length, 0);
});

test('search treats % and _ as literal characters, not wildcards', () => {
  const store = new SqliteStore(':memory:', 500);
  store.saveMessage(msg({ subject: '50% off' }));
  store.saveMessage(msg({ subject: 'nothing special' }));
  const inboxId = store.listInboxes()[0].id;
  assert.equal(store.listMessages(inboxId, { q: '%', limit: 50, offset: 0 }).length, 1);
  store.close();
});

test('retention keeps only the newest N messages per inbox', () => {
  const store = new SqliteStore(':memory:', 3);
  for (let i = 0; i < 6; i++) {
    store.saveMessage(msg({ subject: `Message ${i}`, receivedAt: `2026-08-12T10:0${i}:00.000Z` }));
  }
  const inboxId = store.listInboxes()[0].id;
  const kept = store.listMessages(inboxId, { limit: 50, offset: 0 });
  assert.deepEqual(kept.map((m) => m.subject), ['Message 5', 'Message 4', 'Message 3']);
  assert.equal(store.getInbox(inboxId)?.messageCount, 3);
  store.close();
});

test('retention is per inbox, not global', () => {
  const store = new SqliteStore(':memory:', 2);
  for (let i = 0; i < 3; i++) store.saveMessage(msg({ smtpUser: 'app-one', receivedAt: `2026-08-12T10:0${i}:00.000Z` }));
  for (let i = 0; i < 3; i++) store.saveMessage(msg({ smtpUser: 'app-two', receivedAt: `2026-08-12T10:0${i}:00.000Z` }));
  for (const inbox of store.listInboxes()) assert.equal(inbox.messageCount, 2);
  store.close();
});

test('pruned messages take their attachment rows with them', () => {
  const store = new SqliteStore(':memory:', 1);
  store.saveMessage(msg({ attachments: [{ filename: 'old.pdf', contentType: 'application/pdf', sizeBytes: 1 }] }));
  store.saveMessage(msg({ receivedAt: '2026-08-12T11:00:00.000Z' }));
  const orphans = store.db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as unknown as { n: number };
  assert.equal(orphans.n, 0);
  store.close();
});

test('deleteMessage removes one message and reports its inbox', () => {
  const store = new SqliteStore(':memory:', 500);
  const saved = store.saveMessage(msg());
  assert.deepEqual(store.deleteMessage(saved.message.id), { inboxId: saved.inbox.id });
  assert.equal(store.getMessage(saved.message.id), undefined);
  assert.equal(store.deleteMessage(saved.message.id), undefined);
  store.close();
});

test('clearInbox empties one inbox and leaves the others alone', () => {
  const store = new SqliteStore(':memory:', 500);
  store.saveMessage(msg({ smtpUser: 'app-one' }));
  store.saveMessage(msg({ smtpUser: 'app-one' }));
  store.saveMessage(msg({ smtpUser: 'app-two' }));
  const one = store.listInboxes().find((i) => i.smtpUser === 'app-one')!;
  const two = store.listInboxes().find((i) => i.smtpUser === 'app-two')!;

  assert.equal(store.clearInbox(one.id), 2);
  assert.equal(store.getInbox(one.id)?.messageCount, 0);
  assert.equal(store.getInbox(two.id)?.messageCount, 1);
  store.close();
});
