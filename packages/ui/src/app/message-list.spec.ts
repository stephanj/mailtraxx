import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MessageList } from './message-list';
import type { MessageSummary } from './models';

// jsdom (the test DOM) has no EventSource implementation. LiveFeed opens one
// in its constructor, and MessageList injects LiveFeed, so component
// creation would throw without a stub — mirrors the fake used in
// live-feed.spec.ts. This does not touch any assertion in the specs below.
class FakeEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
  constructor(public readonly url: string) {}
}

function summary(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: 1,
    inboxId: 1,
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

describe('MessageList', () => {
  let fixture: ComponentFixture<MessageList>;
  let http: HttpTestingController;
  let originalEventSource: typeof EventSource | undefined;

  beforeEach(async () => {
    originalEventSource = (window as unknown as { EventSource?: typeof EventSource }).EventSource;
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;

    await TestBed.configureTestingModule({
      imports: [MessageList],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MessageList);
    fixture.componentRef.setInput('inboxId', 1);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    (window as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it('loads messages for the selected inbox', async () => {
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush([summary()]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your talk was accepted');
    expect(fixture.nativeElement.textContent).toContain('speaker@example.com');
  });

  it('shows a placeholder when the inbox is empty', async () => {
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No messages yet');
  });

  it('labels a message with no subject', async () => {
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush([summary({ subject: null })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('(no subject)');
  });

  it('flags a message that failed to parse', async () => {
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush([summary({ parseError: 'bad MIME' })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.parse-error')).toBeTruthy();
  });

  it('refetches when the search term changes', async () => {
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush([summary()]);
    await fixture.whenStable();

    fixture.componentInstance.search.set('accepted');
    fixture.detectChanges();

    // httpResource keeps its in-flight request open as an Angular "pending
    // task", so awaiting fixture.whenStable() here (before the new request
    // is flushed) would deadlock — stability can't be reached while a
    // request is outstanding. Flush first, then confirm stability.
    http.expectOne('/api/inboxes/1/messages?q=accepted&limit=200').flush([summary()]);
    await fixture.whenStable();
  });

  it('emits the message the user clicks', async () => {
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush([summary()]);
    await fixture.whenStable();
    fixture.detectChanges();

    let emitted: MessageSummary | undefined;
    fixture.componentInstance.selected.subscribe((m: MessageSummary) => (emitted = m));
    fixture.nativeElement.querySelector('.message-row').click();
    expect(emitted?.id).toBe(1);
  });

  it('requests the server-side cap of 200 messages, not the 50 default', async () => {
    // The server defaults to 50 when ?limit= is absent (see api.ts's
    // parseLimit); without an explicit limit, messages 51+ would be
    // unreachable except by guessing a search term. http.expectOne() below
    // fails the test outright if the URL lacks &limit=200.
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush([summary()]);
    await fixture.whenStable();
  });

  it('shows no cap notice when the result is under the limit', async () => {
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush([summary()]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cap-notice')).toBeFalsy();
  });

  it('shows an unobtrusive notice when the result hits the 200 cap', async () => {
    const full = Array.from({ length: 200 }, (_, i) => summary({ id: i + 1 }));
    http.expectOne('/api/inboxes/1/messages?q=&limit=200').flush(full);
    await fixture.whenStable();
    fixture.detectChanges();
    const notice = fixture.nativeElement.querySelector('.cap-notice');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('200');
  });
});
