import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

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
});
