import { TestBed } from '@angular/core/testing';
import { LiveFeed } from './live-feed';

class FakeEventSource {
  static last: FakeEventSource | undefined;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly listeners: Record<string, (e: MessageEvent) => void> = {};
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners[type] = fn;
  }

  close() {
    this.closed = true;
  }
}

describe('LiveFeed', () => {
  let original: typeof EventSource;

  beforeEach(() => {
    original = window.EventSource;
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    (window as unknown as { EventSource: unknown }).EventSource = original;
  });

  it('connects to the events endpoint', () => {
    TestBed.inject(LiveFeed);
    expect(FakeEventSource.last?.url).toBe('/api/events');
  });

  it('exposes named events as a signal — the path the server actually uses', () => {
    const feed = TestBed.inject(LiveFeed);
    expect(feed.lastEvent()).toBeNull();

    const event = { type: 'message.created', message: { id: 3, inboxId: 1 } };
    FakeEventSource.last!.listeners['message.created']({ data: JSON.stringify(event) } as MessageEvent);

    expect(feed.lastEvent()).toEqual(event);
  });

  it('also accepts unnamed frames via onmessage', () => {
    const feed = TestBed.inject(LiveFeed);
    FakeEventSource.last!.onmessage!({
      data: JSON.stringify({ type: 'messages.cleared', inboxId: 7 }),
    } as MessageEvent);
    expect(feed.lastEvent()).toEqual({ type: 'messages.cleared', inboxId: 7 });
  });

  it('tracks connection state', () => {
    const feed = TestBed.inject(LiveFeed);
    expect(feed.connected()).toBe(false);
    FakeEventSource.last!.onopen!();
    expect(feed.connected()).toBe(true);
    FakeEventSource.last!.onerror!();
    expect(feed.connected()).toBe(false);
  });

  it('ignores malformed event payloads', () => {
    const feed = TestBed.inject(LiveFeed);
    FakeEventSource.last!.onmessage!({ data: 'not json' } as MessageEvent);
    expect(feed.lastEvent()).toBeNull();
  });
});
