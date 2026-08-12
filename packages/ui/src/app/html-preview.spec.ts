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
});
