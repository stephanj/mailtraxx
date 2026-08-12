import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { LiveFeed } from './live-feed';
import type { MessageSummary } from './models';

// The server clamps ?limit= to 200 (see api.ts's parseLimit). Requesting the
// cap up front means the newest 200 messages are always reachable without
// search, instead of silently stopping at the server's *default* of 50.
const MESSAGE_LIMIT = 200;

@Component({
  selector: 'mtx-message-list',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="pane-header">
      <input
        type="search"
        class="search"
        placeholder="Search subject, sender, recipient"
        [value]="search()"
        (input)="search.set($any($event.target).value)"
      />
    </header>

    @if (messages.hasValue()) {
      @if (messages.value().length === 0) {
        <p class="empty">No messages yet. Send one from your app and it will appear here.</p>
      } @else {
        <ul class="message-rows">
          @for (message of messages.value(); track message.id) {
            <li
              class="message-row"
              [class.active]="message.id === selectedId()"
              (click)="selected.emit(message)"
            >
              <div class="row-top">
                <span class="subject">{{ message.subject ?? '(no subject)' }}</span>
                <time>{{ message.receivedAt | date: 'HH:mm:ss' }}</time>
              </div>
              <div class="row-bottom">
                <span class="to">{{ message.toAddrs.join(', ') }}</span>
                @if (message.parseError) {
                  <span class="parse-error" title="{{ message.parseError }}">parse failed</span>
                }
              </div>
            </li>
          }
        </ul>
        @if (atCap()) {
          <p class="cap-notice">
            Showing the newest {{ MESSAGE_LIMIT }} messages. Narrow with search to find older ones.
          </p>
        }
      }
    } @else if (messages.error()) {
      <p class="empty">Could not load messages.</p>
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-right: 1px solid var(--line);
    }
    .pane-header {
      padding: 0.75rem;
      border-bottom: 1px solid var(--line);
    }
    .search {
      width: 100%;
      padding: 0.5rem 0.65rem;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
    }
    .message-rows {
      list-style: none;
      margin: 0;
      padding: 0;
      overflow-y: auto;
    }
    .message-row {
      padding: 0.7rem 0.85rem;
      border-bottom: 1px solid var(--line);
      cursor: pointer;
    }
    .message-row:hover {
      background: var(--hover);
    }
    .message-row.active {
      background: var(--accent-soft);
    }
    .row-top {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .subject {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    time {
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      font-size: 0.85em;
    }
    .row-bottom {
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      font-size: 0.85em;
    }
    .parse-error {
      color: var(--warn);
    }
    .empty {
      padding: 1.5rem 0.85rem;
      color: var(--muted);
    }
    .cap-notice {
      padding: 0.6rem 0.85rem;
      margin: 0;
      color: var(--muted);
      font-size: 0.85em;
      border-top: 1px solid var(--line);
    }
  `,
})
export class MessageList {
  readonly inboxId = input.required<number>();
  readonly selectedId = input<number | null>(null);
  readonly selected = output<MessageSummary>();

  readonly search = signal('');
  readonly #feed = inject(LiveFeed);
  readonly MESSAGE_LIMIT = MESSAGE_LIMIT;

  readonly messages = httpResource<MessageSummary[]>(
    () => `/api/inboxes/${this.inboxId()}/messages?q=${encodeURIComponent(this.search())}&limit=${MESSAGE_LIMIT}`,
  );

  // Only meaningful once the request has resolved with a full page — an
  // in-flight or errored resource must not claim to be "at the cap".
  readonly atCap = computed(() => this.messages.hasValue() && this.messages.value().length >= MESSAGE_LIMIT);

  constructor() {
    // Any server-side change to this inbox refetches the list.
    effect(() => {
      const event = this.#feed.lastEvent();
      if (!event) return;
      const affected =
        event.type === 'message.created'
          ? event.message.inboxId
          : event.type === 'message.deleted'
            ? event.inboxId
            : event.type === 'messages.cleared'
              ? event.inboxId
              : null;
      if (affected === this.inboxId()) this.messages.reload();
    });
  }
}
