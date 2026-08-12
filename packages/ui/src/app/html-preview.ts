import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'mtx-html-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<iframe sandbox="" [srcdoc]="document()" title="Email preview"></iframe>`,
  styles: `
    :host { display: block; height: 100%; }
    iframe { width: 100%; height: 100%; border: 0; background: #fff; }
  `,
})
export class HtmlPreview {
  readonly html = input.required<string>();
  readonly allowRemote = input(false);

  readonly #sanitizer = inject(DomSanitizer);

  readonly document = computed<SafeHtml>(() => {
    const imgSrc = this.allowRemote() ? 'data: https: http:' : 'data:';
    const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:`;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${this.html()}</body></html>`;
    // Trusted only in the sense that the iframe sandbox, not Angular, is the boundary.
    return this.#sanitizer.bypassSecurityTrustHtml(doc);
  });
}
