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
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary()]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your talk was accepted');
    expect(fixture.nativeElement.textContent).toContain('speaker@example.com');
  });

  it('shows a placeholder when the inbox is empty', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No messages yet');
  });

  it('labels a message with no subject', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary({ subject: null })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('(no subject)');
  });

  it('flags a message that failed to parse', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary({ parseError: 'bad MIME' })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.parse-error')).toBeTruthy();
  });

  it('refetches when the search term changes', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary()]);
    await fixture.whenStable();

    fixture.componentInstance.search.set('accepted');
    fixture.detectChanges();

    // httpResource keeps its in-flight request open as an Angular "pending
    // task", so awaiting fixture.whenStable() here (before the new request
    // is flushed) would deadlock — stability can't be reached while a
    // request is outstanding. Flush first, then confirm stability.
    http.expectOne('/api/inboxes/1/messages?q=accepted').flush([summary()]);
    await fixture.whenStable();
  });

  it('emits the message the user clicks', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary()]);
    await fixture.whenStable();
    fixture.detectChanges();

    let emitted: MessageSummary | undefined;
    fixture.componentInstance.selected.subscribe((m: MessageSummary) => (emitted = m));
    fixture.nativeElement.querySelector('.message-row').click();
    expect(emitted?.id).toBe(1);
  });
});
