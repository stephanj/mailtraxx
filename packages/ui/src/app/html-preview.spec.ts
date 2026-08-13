import { TestBed } from '@angular/core/testing';
import { HtmlPreview } from './html-preview';

describe('HtmlPreview', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HtmlPreview] }).compileComponents();
  });

  function render(html: string, allowRemote = false) {
    const fixture = TestBed.createComponent(HtmlPreview);
    fixture.componentRef.setInput('html', html);
    fixture.componentRef.setInput('allowRemote', allowRemote);
    fixture.detectChanges();
    return fixture;
  }

  it('renders into a sandboxed iframe that cannot run scripts', () => {
    const iframe = render('<h1>Hi</h1>').nativeElement.querySelector('iframe') as HTMLIFrameElement;
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(iframe).toBeTruthy();
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('injects a CSP that blocks remote content by default', () => {
    const iframe = render('<img src="https://tracker.example/p.gif">').nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain("img-src data:");
    expect(doc).toContain('<img src="https://tracker.example/p.gif">');
  });

  it('permits remote images once the user opts in', () => {
    const iframe = render('<img src="https://tracker.example/p.gif">', true).nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).toContain('img-src data: https: http:');
  });

  it('strips a meta-refresh navigation even though it is neither a script nor blocked by CSP', () => {
    // CSP fetch directives don't govern navigation, and the sandbox's navigation
    // restriction only applies to *other* browsing contexts, not the iframe's own
    // content — so a bare `sandbox=""` + `default-src 'none'` does not stop this.
    const html = '<h1>Hi</h1><meta http-equiv="refresh" content="0;url=https://attacker.example/beacon?x=1">';
    const iframe = render(html).nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).not.toContain('http-equiv="refresh"');
    expect(doc).not.toContain('attacker.example');
  });

  it('strips a base tag that could redirect relative links and image loads', () => {
    const html = '<base href="https://attacker.example/"><h1>Hi</h1>';
    const iframe = render(html).nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).not.toContain('<base');
    expect(doc).not.toContain('attacker.example');
  });

  it('permits link clicks to open a new tab', () => {
    // Real HTML email links carry target="_blank". A bare sandbox="" sets the sandboxed
    // auxiliary navigation flag, and the browser blocks the click outright:
    // "Blocked opening '...' in a new window because the request was made in a sandboxed
    // frame whose 'allow-popups' permission is not set." Escaping the sandbox for the
    // popup only means the destination opens as a normal tab, the way a mail client opens
    // a link — the preview frame itself stays script-free and opaque-origin.
    const iframe = render('<a href="https://cfp.dev/">link</a>').nativeElement.querySelector('iframe');
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-popups');
    expect(sandbox).toContain('allow-popups-to-escape-sandbox');
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('forces every link to open in a new tab so the preview is never navigated away', () => {
    // A link with no target self-navigates the frame — permitted by the sandbox and
    // ungoverned by CSP — which would replace the message with the live remote page and
    // leak a request even with remote content switched off.
    const iframe = render('<a href="https://cfp.dev/">no target</a>').nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).toContain('target="_blank"');
    expect(doc).toContain('rel="noopener noreferrer"');
  });

  it('rewrites an existing target so it cannot aim at the preview frame', () => {
    const iframe = render('<a href="https://cfp.dev/" target="_self">self</a>').nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).not.toContain('target="_self"');
    expect(doc).toContain('target="_blank"');
  });

  it('neutralises javascript: and data: hrefs while keeping the link text', () => {
    // Popups escape the sandbox, so a javascript: href must never survive to be clicked.
    const html = '<a href="javascript:alert(1)">a</a><a href="JavaScript:alert(2)">b</a><a href="data:text/html,<h1>x">c</a>';
    const iframe = render(html).nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc.toLowerCase()).not.toContain('javascript:');
    expect(doc).not.toContain('data:text/html');
    expect(doc).toContain('>a</a>');
    expect(doc).toContain('>b</a>');
    expect(doc).toContain('>c</a>');
  });

  it('keeps http, https and mailto links working', () => {
    const html = '<a href="https://cfp.dev/">s</a><a href="http://cfp.dev/">p</a><a href="mailto:a@b.c">m</a>';
    const iframe = render(html).nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).toContain('href="https://cfp.dev/"');
    expect(doc).toContain('href="http://cfp.dev/"');
    expect(doc).toContain('href="mailto:a@b.c"');
  });

  it('leaves ordinary email markup — headings, inline styles, images — intact', () => {
    const html = '<h1>Hi</h1><p style="color:red">Text</p><img src="https://tracker.example/p.gif">';
    const iframe = render(html).nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).toContain('<h1>Hi</h1>');
    expect(doc).toContain('<p style="color:red">Text</p>');
    expect(doc).toContain('<img src="https://tracker.example/p.gif">');
  });
});
