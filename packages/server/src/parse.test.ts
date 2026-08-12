import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from './parse.ts';
import type { EnvelopeInfo } from './parse.ts';

const envelope: EnvelopeInfo = {
  smtpUser: 'cfp',
  mailFrom: 'no_reply+dev@cfp.dev',
  rcptTo: ['speaker@example.com'],
  receivedAt: '2026-08-12T10:00:00.000Z',
};

function raw(body: string): Buffer {
  return Buffer.from(body.replace(/\n/g, '\r\n'), 'utf8');
}

test('parses a multipart message with both html and text parts', async () => {
  const source = raw(
    [
      'From: Devoxx CFP <no_reply+dev@cfp.dev>',
      'To: speaker@example.com',
      'Cc: chair@example.com',
      'Subject: Your talk was accepted',
      'Message-ID: <abc@cfp.dev>',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Accepted',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<h1>Accepted</h1>',
      '--b1--',
      '',
    ].join('\n'),
  );

  const m = await parseMessage(source, envelope);
  assert.equal(m.subject, 'Your talk was accepted');
  assert.equal(m.text?.trim(), 'Accepted');
  assert.equal(m.html?.trim(), '<h1>Accepted</h1>');
  assert.equal(m.fromDisplay, 'Devoxx CFP <no_reply+dev@cfp.dev>');
  assert.equal(m.messageId, '<abc@cfp.dev>');
  assert.deepEqual(m.ccAddrs, ['chair@example.com']);
  assert.equal(m.parseError, null);
  assert.equal(m.sizeBytes, source.length);
  assert.equal(m.raw, source.toString('utf8'));
});

test('envelope recipients win over To: headers, because that is who actually gets it', async () => {
  const source = raw(['To: displayed@example.com', 'Subject: Hi', '', 'Body', ''].join('\n'));
  const m = await parseMessage(source, { ...envelope, rcptTo: ['real@example.com', 'bcc@example.com'] });
  assert.deepEqual(m.toAddrs, ['real@example.com', 'bcc@example.com']);
  assert.equal(m.fromAddr, 'no_reply+dev@cfp.dev');
});

test('a text-only message has no html', async () => {
  const m = await parseMessage(raw(['Subject: Plain', '', 'Just text', ''].join('\n')), envelope);
  assert.equal(m.html, null);
  assert.equal(m.text?.trim(), 'Just text');
});

test('an html-only message has no text', async () => {
  const source = raw(['Subject: Rich', 'Content-Type: text/html; charset=utf-8', '', '<p>Rich</p>', ''].join('\n'));
  const m = await parseMessage(source, envelope);
  assert.equal(m.html?.trim(), '<p>Rich</p>');
  assert.equal(m.text, null);
});

test('a message with no Subject parses with a null subject', async () => {
  const m = await parseMessage(raw(['From: a@b.c', '', 'Body', ''].join('\n')), envelope);
  assert.equal(m.subject, null);
  assert.equal(m.parseError, null);
});

test('quoted-printable and UTF-8 subjects are decoded', async () => {
  const source = raw(
    [
      'Subject: =?utf-8?Q?Caf=C3=A9_r=C3=A9serv=C3=A9?=',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Caf=C3=A9',
      '',
    ].join('\n'),
  );
  const m = await parseMessage(source, envelope);
  assert.equal(m.subject, 'Café réservé');
  assert.equal(m.text?.trim(), 'Café');
});

test('attachment metadata is captured but content is not', async () => {
  const source = raw(
    [
      'Subject: With attachment',
      'Content-Type: multipart/mixed; boundary="b2"',
      '',
      '--b2',
      'Content-Type: text/plain',
      '',
      'See attached',
      '--b2',
      'Content-Type: application/pdf; name="slides.pdf"',
      'Content-Disposition: attachment; filename="slides.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'aGVsbG8=',
      '--b2--',
      '',
    ].join('\n'),
  );
  const m = await parseMessage(source, envelope);
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'slides.pdf');
  assert.equal(m.attachments[0].contentType, 'application/pdf');
  assert.equal(m.attachments[0].sizeBytes, 5);
  assert.ok(!('content' in m.attachments[0]));
});

test('headers are flattened to a plain string map', async () => {
  const m = await parseMessage(raw(['Subject: Hi', 'X-Custom: value', '', 'Body', ''].join('\n')), envelope);
  assert.equal(m.headers['x-custom'], 'value');
  assert.equal(typeof m.headers['subject'], 'string');
});

test('unparseable input still yields a message with raw preserved', async () => {
  const source = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
  const m = await parseMessage(source, envelope);
  assert.equal(m.raw.length > 0, true);
  assert.equal(m.sizeBytes, 4);
  assert.equal(m.toAddrs.length, 1);
});
