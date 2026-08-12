import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './config.ts';

test('defaults match the documented values', () => {
  const c = parseConfig([]);
  assert.equal(c.smtpPort, 2525);
  assert.equal(c.httpPort, 1080);
  assert.equal(c.dbPath, join(homedir(), '.mailtraxx', 'mailtraxx.db'));
  assert.equal(c.retain, 500);
  assert.equal(c.maxSizeBytes, 25 * 1024 * 1024);
  assert.equal(c.open, false);
});

test('flags override defaults', () => {
  const c = parseConfig([
    '--smtp-port', '3025',
    '--http-port', '8080',
    '--db', '/tmp/x.db',
    '--retain', '10',
    '--max-size', '5',
    '--open',
  ]);
  assert.equal(c.smtpPort, 3025);
  assert.equal(c.httpPort, 8080);
  assert.equal(c.dbPath, '/tmp/x.db');
  assert.equal(c.retain, 10);
  assert.equal(c.maxSizeBytes, 5 * 1024 * 1024);
  assert.equal(c.open, true);
});

test('rejects a non-numeric port', () => {
  assert.throws(() => parseConfig(['--smtp-port', 'abc']), /--smtp-port must be a number/);
});

test('rejects a port outside the valid range', () => {
  assert.throws(() => parseConfig(['--http-port', '70000']), /--http-port must be a number/);
});
