import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from './bus.ts';
import type { MailtraxxEvent } from './bus.ts';

const cleared: MailtraxxEvent = { type: 'messages.cleared', inboxId: 1 };

test('delivers events to every subscriber', () => {
  const bus = new EventBus();
  const a: MailtraxxEvent[] = [];
  const b: MailtraxxEvent[] = [];
  bus.subscribe((e) => a.push(e));
  bus.subscribe((e) => b.push(e));
  bus.emit(cleared);
  assert.deepEqual(a, [cleared]);
  assert.deepEqual(b, [cleared]);
});

test('unsubscribing stops delivery', () => {
  const bus = new EventBus();
  const seen: MailtraxxEvent[] = [];
  const off = bus.subscribe((e) => seen.push(e));
  bus.emit(cleared);
  off();
  bus.emit(cleared);
  assert.equal(seen.length, 1);
});

test('one throwing subscriber does not stop the others', () => {
  const bus = new EventBus();
  const seen: MailtraxxEvent[] = [];
  bus.subscribe(() => {
    throw new Error('subscriber exploded');
  });
  bus.subscribe((e) => seen.push(e));
  assert.doesNotThrow(() => bus.emit(cleared));
  assert.equal(seen.length, 1);
});
