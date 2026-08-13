import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageViewer } from './message-viewer';
import type { Message } from './models';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    inboxId: 1,
    messageId: '<abc@cfp.dev>',
    fromAddr: 'no_reply+dev@cfp.dev',
    fromDisplay: 'Devoxx CFP <no_reply+dev@cfp.dev>',
    toAddrs: ['speaker@example.com'],
    ccAddrs: [],
    subject: 'Your talk was accepted',
    html: '<h1>Accepted</h1>',
    text: 'Accepted',
    raw: 'Subject: Your talk was accepted\r\n\r\nAccepted',
    headers: { subject: 'Your talk was accepted', 'x-custom': 'value' },
    sizeBytes: 42,
    hasHtml: true,
    parseError: null,
    attachments: [],
    receivedAt: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('MessageViewer', () => {
  let fixture: ComponentFixture<MessageViewer>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageViewer],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MessageViewer);
    fixture.componentRef.setInput('messageId', 1);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function load(m: Message = message()) {
    http.expectOne('/api/messages/1').flush(m);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the header summary', async () => {
    await load();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Your talk was accepted');
    expect(text).toContain('no_reply+dev@cfp.dev');
    expect(text).toContain('speaker@example.com');
  });

  it('defaults to the HTML tab and can switch to Text, Raw, and Headers by clicking the tab buttons', async () => {
    await load();
    expect(fixture.componentInstance.tab()).toBe('html');
    expect(fixture.nativeElement.querySelector('mtx-html-preview')).toBeTruthy();

    const buttons = () =>
      Array.from(fixture.nativeElement.querySelectorAll('.tabs button')) as HTMLButtonElement[];

    // Clicking the real button (rather than setting the `tab` signal directly) is what
    // actually exercises the (click) binding — a broken click handler would still pass
    // if the assertions only ever drove the signal programmatically.
    buttons()[2].click(); // Raw
    fixture.detectChanges();
    expect(fixture.componentInstance.tab()).toBe('raw');
    expect(fixture.nativeElement.textContent).toContain('Subject: Your talk was accepted');

    buttons()[3].click(); // Headers
    fixture.detectChanges();
    expect(fixture.componentInstance.tab()).toBe('headers');
    expect(fixture.nativeElement.textContent).toContain('x-custom');
  });

  it('opens on the Raw tab when the message failed to parse', async () => {
    await load(message({ parseError: 'bad MIME', html: null, text: null }));
    expect(fixture.componentInstance.tab()).toBe('raw');
  });

  it('lists attachment metadata without offering a download', async () => {
    await load(message({ attachments: [{ filename: 'slides.pdf', contentType: 'application/pdf', sizeBytes: 2048 }] }));
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('slides.pdf');
    expect(text).toContain('2.0 KB');
    expect(fixture.nativeElement.querySelector('.attachments a')).toBeNull();
  });

  it('emits after deleting', async () => {
    await load();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let emitted: number | undefined;
    fixture.componentInstance.deleted.subscribe((id) => (emitted = id));

    void fixture.componentInstance.remove();
    http.expectOne({ url: '/api/messages/1', method: 'DELETE' }).flush(null);
    await fixture.whenStable();
    expect(emitted).toBe(1);
  });

  it('does not delete when the user cancels the confirmation', async () => {
    await load();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    let emitted: number | undefined;
    fixture.componentInstance.deleted.subscribe((id) => (emitted = id));

    await fixture.componentInstance.remove();

    // http.verify() in afterEach would also fail on a stray unflushed request, but
    // asserting expectNone explicitly proves the cancel path never issues the DELETE —
    // this is an irreversible action and deserves a direct test, not just inspection.
    http.expectNone({ url: '/api/messages/1', method: 'DELETE' });
    expect(emitted).toBeUndefined();
  });
});
