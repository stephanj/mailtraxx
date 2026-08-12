import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { DatePipe, UpperCasePipe } from '@angular/common';
import { HtmlPreview } from './html-preview';
import { MailtraxxApi } from './mailtraxx-api';
import type { Message } from './models';

type Tab = 'html' | 'text' | 'raw' | 'headers';

@Component({
  selector: 'mtx-message-viewer',
  imports: [HtmlPreview, DatePipe, UpperCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message.hasValue()) {
      @let m = message.value();
      <header class="summary">
        <h2>{{ m.subject ?? '(no subject)' }}</h2>
        <dl>
          <dt>From</dt><dd>{{ m.fromDisplay ?? m.fromAddr }}</dd>
          <dt>To</dt><dd>{{ m.toAddrs.join(', ') }}</dd>
          @if (m.ccAddrs.length) { <dt>Cc</dt><dd>{{ m.ccAddrs.join(', ') }}</dd> }
          <dt>Received</dt><dd>{{ m.receivedAt | date: 'medium' }} · {{ size(m.sizeBytes) }}</dd>
        </dl>

        @if (m.parseError) {
          <p class="parse-error">This message could not be parsed: {{ m.parseError }}</p>
        }

        @if (m.attachments.length) {
          <ul class="attachments">
            @for (a of m.attachments; track $index) {
              <li>{{ a.filename ?? '(unnamed)' }} · {{ a.contentType ?? 'unknown type' }} · {{ size(a.sizeBytes) }}</li>
            }
          </ul>
        }

        <nav class="tabs">
          @for (t of tabs; track t) {
            <button type="button" [class.active]="tab() === t" (click)="tab.set(t)">{{ t | uppercase }}</button>
          }
          <span class="spacer"></span>
          @if (tab() === 'html') {
            <label class="remote">
              <input type="checkbox" [checked]="allowRemote()" (change)="allowRemote.set($any($event.target).checked)" />
              Load remote content
            </label>
          }
          <a [href]="rawUrl()" download>Download .eml</a>
          <button type="button" class="delete" (click)="remove()">Delete</button>
        </nav>
      </header>

      <section class="body">
        @switch (tab()) {
          @case ('html') {
            @if (m.html) {
              <mtx-html-preview [html]="m.html" [allowRemote]="allowRemote()" />
            } @else {
              <p class="empty">This message has no HTML part.</p>
            }
          }
          @case ('text') {
            @if (m.text) { <pre>{{ m.text }}</pre> } @else { <p class="empty">This message has no plain-text part.</p> }
          }
          @case ('raw') { <pre>{{ m.raw }}</pre> }
          @case ('headers') {
            <dl class="headers">
              @for (entry of headerEntries(); track entry[0]) {
                <dt>{{ entry[0] }}</dt><dd>{{ entry[1] }}</dd>
              }
            </dl>
          }
        }
      </section>
    } @else if (message.error()) {
      <p class="empty">Could not load this message.</p>
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    .summary { padding: 0.85rem; border-bottom: 1px solid var(--line); }
    h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.75rem; margin: 0; font-size: 0.9em; }
    dt { color: var(--muted); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .parse-error { color: var(--warn); font-size: 0.9em; }
    .attachments { margin: 0.5rem 0 0; padding-left: 1.1rem; color: var(--muted); font-size: 0.85em; }
    .tabs { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.85rem; }
    .tabs button { border: 1px solid var(--line); background: none; color: inherit; border-radius: 5px; padding: 0.25rem 0.6rem; font: inherit; font-size: 0.8em; cursor: pointer; }
    .tabs button.active { background: var(--accent-soft); }
    .tabs .spacer { flex: 1; }
    .tabs a { color: var(--muted); font-size: 0.8em; }
    .remote { color: var(--muted); font-size: 0.8em; display: flex; align-items: center; gap: 0.25rem; }
    .body { flex: 1; min-height: 0; overflow: auto; }
    pre { margin: 0; padding: 0.85rem; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.85em; }
    .headers { padding: 0.85rem; font-size: 0.85em; }
    .empty { padding: 1.5rem 0.85rem; color: var(--muted); }
  `,
})
export class MessageViewer {
  readonly messageId = input.required<number>();
  readonly deleted = output<number>();

  readonly tabs: Tab[] = ['html', 'text', 'raw', 'headers'];
  readonly tab = signal<Tab>('html');
  readonly allowRemote = signal(false);

  readonly #api = inject(MailtraxxApi);
  readonly message = httpResource<Message>(() => `/api/messages/${this.messageId()}`);

  readonly headerEntries = computed(() =>
    this.message.hasValue() ? Object.entries(this.message.value().headers) : [],
  );
  readonly rawUrl = computed(() => this.#api.rawUrl(this.messageId()));

  constructor() {
    // A new message resets the view; an unparseable one opens on Raw, the only tab with content.
    effect(() => {
      if (!this.message.hasValue()) return;
      this.allowRemote.set(false);
      this.tab.set(this.message.value().parseError ? 'raw' : 'html');
    });
  }

  size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async remove(): Promise<void> {
    if (!confirm('Delete this message?')) return;
    await this.#api.deleteMessage(this.messageId());
    this.deleted.emit(this.messageId());
  }
}
