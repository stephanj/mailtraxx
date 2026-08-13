import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { App } from './app';
import { LiveFeed } from './live-feed';
import type { MailtraxxEvent, Message, MessageSummary } from './models';

// jsdom has no EventSource implementation. App renders mtx-inbox-list, whose
// LiveFeed dependency opens one immediately, so even instantiating the fixture
// needs a stub — same reasoning as message-list.spec.ts. HttpClientTesting
// stands in for provideHttpClient() so InboxList's httpResource has a backend.
class FakeEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
  constructor(public readonly url: string) {}
}

describe('App', () => {
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(async () => {
    originalEventSource = (window as unknown as { EventSource?: typeof EventSource }).EventSource;
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    (window as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it('creates the shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  function summary(overrides: Partial<MessageSummary> = {}): MessageSummary {
    return {
      id: 1,
      inboxId: 7,
      fromDisplay: 'Devoxx CFP <no_reply+dev@cfp.dev>',
      toAddrs: ['speaker@example.com'],
      subject: 'Your talk was accepted',
      sizeBytes: 42,
      hasHtml: true,
      parseError: null,
      receivedAt: '2026-08-12T10:00:00.000Z',
      ...overrides,
    };
  }

  function fullMessage(s: MessageSummary): Message {
    return {
      ...s,
      messageId: null,
      fromAddr: 'no_reply+dev@cfp.dev',
      ccAddrs: [],
      html: '<h1>Accepted</h1>',
      text: 'Accepted',
      raw: 'raw',
      headers: {},
      attachments: [],
    };
  }

  async function createWithSelectedMessage(lastEvent: ReturnType<typeof signal<MailtraxxEvent | null>>) {
    TestBed.overrideProvider(LiveFeed, { useValue: { lastEvent, connected: signal(true) } });
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    const selected = summary();
    fixture.componentInstance.message.set(selected);
    fixture.detectChanges();

    // Both MessageViewer's and InboxList's httpResource fire a request as
    // soon as the message is selected / the shell is created; each registers
    // an Angular PendingTask, so flush before awaiting whenStable() or it
    // deadlocks (see message-list.spec.ts).
    http.expectOne(`/api/messages/${selected.id}`).flush(fullMessage(selected));
    http.expectOne('/api/inboxes').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, selected };
  }

  it('clears the selected message when it is deleted elsewhere', async () => {
    const lastEvent = signal<MailtraxxEvent | null>(null);
    const { fixture, selected } = await createWithSelectedMessage(lastEvent);

    lastEvent.set({ type: 'message.deleted', id: selected.id, inboxId: selected.inboxId });
    fixture.detectChanges();

    expect(fixture.componentInstance.message()).toBeNull();
  });

  it('clears the selected message when its inbox is cleared', async () => {
    const lastEvent = signal<MailtraxxEvent | null>(null);
    const { fixture, selected } = await createWithSelectedMessage(lastEvent);

    lastEvent.set({ type: 'messages.cleared', inboxId: selected.inboxId });
    fixture.detectChanges();

    expect(fixture.componentInstance.message()).toBeNull();
  });

  it('leaves the selected message alone for an unrelated deletion', async () => {
    const lastEvent = signal<MailtraxxEvent | null>(null);
    const { fixture, selected } = await createWithSelectedMessage(lastEvent);

    lastEvent.set({ type: 'message.deleted', id: selected.id + 1, inboxId: selected.inboxId });
    fixture.detectChanges();

    expect(fixture.componentInstance.message()).not.toBeNull();
  });
});
