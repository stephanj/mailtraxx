import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { startSmtpServer } from './smtp.ts';
import { SqliteStore } from './store.ts';
import { parseConfig } from './config.ts';
import type { SaveResult } from './types.ts';

async function harness(overrides: string[] = []) {
  const config = parseConfig(['--smtp-port', '0', ...overrides]);
  const store = new SqliteStore(':memory:', config.retain);
  const saved: SaveResult[] = [];
  const smtp = await startSmtpServer(config, store, (r) => saved.push(r));
  const transport = nodemailer.createTransport({
    host: '127.0.0.1',
    port: smtp.port,
    secure: false,
    auth: { user: '240f00ce858a00', pass: 'b6cba990e80601' },
  });
  return {
    store,
    saved,
    transport,
    async close() {
      transport.close();
      await smtp.close();
      store.close();
    },
  };
}

test('accepts authenticated mail and files it under the SMTP username', async () => {
  const h = await harness();
  await h.transport.sendMail({
    from: 'no_reply+dev@cfp.dev',
    to: 'speaker@example.com',
    subject: 'Your talk was accepted',
    html: '<h1>Accepted</h1>',
    text: 'Accepted',
  });

  assert.equal(h.saved.length, 1);
  const inbox = h.store.listInboxes()[0];
  assert.equal(inbox.smtpUser, '240f00ce858a00');
  const message = h.store.listMessages(inbox.id, { limit: 50, offset: 0 })[0];
  assert.equal(message.subject, 'Your talk was accepted');
  assert.deepEqual(message.toAddrs, ['speaker@example.com']);
  await h.close();
});

test('accepts any password, because it is a local capture server', async () => {
  const h = await harness();
  const anyPassword = nodemailer.createTransport({
    host: '127.0.0.1',
    port: (h.transport.options as { port: number }).port,
    secure: false,
    auth: { user: 'other-app', pass: 'literally-anything' },
  });
  await anyPassword.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 'Hi', text: 'Hi' });
  assert.deepEqual(h.store.listInboxes().map((i) => i.smtpUser), ['other-app']);
  anyPassword.close();
  await h.close();
});

test('unauthenticated mail lands in the default inbox', async () => {
  const h = await harness();
  const anon = nodemailer.createTransport({
    host: '127.0.0.1',
    port: (h.transport.options as { port: number }).port,
    secure: false,
  });
  await anon.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 'Anon', text: 'Anon' });
  assert.deepEqual(h.store.listInboxes().map((i) => i.smtpUser), ['default']);
  anon.close();
  await h.close();
});

test('rejects a message over the size limit with 552 and stores nothing', async () => {
  const h = await harness(['--max-size', '1']);
  await assert.rejects(
    h.transport.sendMail({
      from: 'a@b.c',
      to: 'd@e.f',
      subject: 'Huge',
      text: 'x'.repeat(2 * 1024 * 1024),
    }),
    (err: Error & { responseCode?: number }) => {
      assert.equal(err.responseCode, 552);
      return true;
    },
  );
  assert.equal(h.store.listInboxes().length, 0);
  await h.close();
});

test('a store failure is reported to the sender as 451, never silently dropped', async () => {
  const config = parseConfig(['--smtp-port', '0']);
  const store = new SqliteStore(':memory:', config.retain);
  store.saveMessage = () => {
    throw new Error('disk on fire');
  };
  const smtp = await startSmtpServer(config, store);
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: smtp.port, secure: false });

  await assert.rejects(
    transport.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 'Doomed', text: 'Doomed' }),
    (err: Error & { responseCode?: number }) => {
      assert.equal(err.responseCode, 451);
      return true;
    },
  );

  transport.close();
  await smtp.close();
  store.close();
});

test('an onSaved callback that throws does not turn a successful save into a 451', async () => {
  const config = parseConfig(['--smtp-port', '0']);
  const store = new SqliteStore(':memory:', config.retain);
  const smtp = await startSmtpServer(config, store, () => {
    throw new Error('subscriber blew up');
  });
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: smtp.port, secure: false });

  await transport.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 'Saved anyway', text: 'Saved anyway' });

  const inbox = store.listInboxes()[0];
  const message = store.listMessages(inbox.id, { limit: 50, offset: 0 })[0];
  assert.equal(message.subject, 'Saved anyway');

  transport.close();
  await smtp.close();
  store.close();
});
