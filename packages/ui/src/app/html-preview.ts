import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Elements that can navigate the frame or embed/submit content on their own — independent
// of the CSP and independent of the sandbox. <meta http-equiv="refresh"> and <base href>
// are navigation primitives: no CSP fetch directive governs navigation (the `navigate-to`
// directive was dropped from the spec), and the sandboxed browsing context's navigation
// restriction only constrains navigating *other* browsing contexts (parent/top/siblings),
// not the iframe's own document — so `sandbox=""` alone does not stop a meta-refresh from
// firing the moment the message is opened, even with `allowRemote` off. <link>, <form>,
// <object>, <embed>, <iframe>, and <frame> are further embedding/navigation/submission
// vectors an img-src/style-src CSP does not close. These must be removed from the
// untrusted markup itself, using a real parser (never regex/string replacement) — this is
// a third, independent layer on top of the sandbox and CSP, not a replacement for either.
const DISALLOWED_TAGS = ['meta', 'base', 'link', 'form', 'object', 'embed', 'iframe', 'frame'];

// Schemes a link may keep. Anything else — javascript:, data:, and relative hrefs that
// cannot resolve without the <base> we strip — has its href removed. This matters because
// the sandbox grants `allow-popups-to-escape-sandbox`, so a surviving `javascript:` href
// would open in a context that is no longer sandboxed.
const ALLOWED_LINK_SCHEMES = ['http:', 'https:', 'mailto:'];

/** True when `href` is one of the schemes a captured message is allowed to link to. */
function isSafeHref(href: string): boolean {
  try {
    return ALLOWED_LINK_SCHEMES.includes(new URL(href).protocol);
  } catch {
    // Relative or unparseable. Without a <base> it could not resolve anyway.
    return false;
  }
}

/**
 * Removes the navigation/embedding elements the sandbox and CSP cannot cover, then makes
 * the surviving links safe to click: every anchor opens a new tab, so nothing can navigate
 * the preview frame itself away from the message.
 */
function prepareMessageHtml(html: string): string {
  // Parsing untrusted HTML with DOMParser does not execute scripts or load subresources —
  // the resulting document is never inserted into a live page, so this step is itself safe.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(DISALLOWED_TAGS.join(',')).forEach((el) => el.remove());

  doc.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (href === null) return;

    if (!isSafeHref(href)) {
      anchor.removeAttribute('href');
      return;
    }
    // Forced, not defaulted: an email's own target="_self" would otherwise replace the
    // preview with the live remote page — a request that fires even with remote content
    // switched off, since navigation is governed by neither the CSP nor the sandbox.
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });

  return doc.body.innerHTML;
}

@Component({
  selector: 'mtx-html-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // allow-popups lets a click open the link; allow-popups-to-escape-sandbox means the tab
  // it opens is an ordinary one rather than a crippled sandboxed copy. Neither grants the
  // preview itself anything: no allow-scripts, no allow-same-origin, so the message can
  // still not run code or read this origin, and with no scripts a popup can only be opened
  // by a real user click.
  template: `<iframe
    sandbox="allow-popups allow-popups-to-escape-sandbox"
    [srcdoc]="document()"
    title="Email preview"
  ></iframe>`,
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
    const body = prepareMessageHtml(this.html());
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${body}</body></html>`;
    // Trusted only in the sense that the iframe sandbox, not Angular, is the boundary.
    return this.#sanitizer.bypassSecurityTrustHtml(doc);
  });
}
