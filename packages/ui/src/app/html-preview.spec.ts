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

  it('leaves ordinary email markup — headings, inline styles, images — intact', () => {
    const html = '<h1>Hi</h1><p style="color:red">Text</p><img src="https://tracker.example/p.gif">';
    const iframe = render(html).nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).toContain('<h1>Hi</h1>');
    expect(doc).toContain('<p style="color:red">Text</p>');
    expect(doc).toContain('<img src="https://tracker.example/p.gif">');
  });
});
