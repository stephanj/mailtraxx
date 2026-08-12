import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { LiveFeed } from './live-feed';
import { MailtraxxApi } from './mailtraxx-api';
import type { Inbox } from './models';

@Component({
  selector: 'mtx-inbox-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="pane-header">
      <h1>mailtraxx</h1>
      <span
        class="status"
        [class.live]="feed.connected()"
        [title]="feed.connected() ? 'Live' : 'Disconnected'"
      ></span>
    </header>

    @if (inboxes.hasValue()) {
      <ul class="inbox-rows">
        @for (inbox of inboxes.value(); track inbox.id) {
          <li
            class="inbox-row"
            [class.active]="inbox.id === selectedId()"
            (click)="selected.emit(inbox)"
          >
            <span class="name" (dblclick)="rename(inbox)" title="Double-click to rename">{{
              inbox.name
            }}</span>
            <span class="count">{{ inbox.messageCount }}</span>
            <button type="button" class="clear" (click)="clear($event, inbox)" title="Clear inbox">
              Clear
            </button>
          </li>
        } @empty {
          <li class="empty">No inboxes yet. Point an app at SMTP port 2525.</li>
        }
      </ul>
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      background: var(--sidebar);
      border-right: 1px solid var(--line);
    }
    .pane-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 0.85rem;
      border-bottom: 1px solid var(--line);
    }
    h1 {
      font-size: 1rem;
      margin: 0;
      letter-spacing: 0.02em;
    }
    .status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
    }
    .status.live {
      background: var(--ok);
    }
    .inbox-rows {
      list-style: none;
      margin: 0;
      padding: 0;
      overflow-y: auto;
    }
    .inbox-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.6rem 0.85rem;
      cursor: pointer;
    }
    .inbox-row:hover {
      background: var(--hover);
    }
    .inbox-row.active {
      background: var(--accent-soft);
    }
    .name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      font-size: 0.85em;
    }
    .clear {
      opacity: 0;
      border: 0;
      background: none;
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      font-size: 0.8em;
    }
    .inbox-row:hover .clear {
      opacity: 1;
    }
    .empty {
      padding: 1rem 0.85rem;
      color: var(--muted);
      font-size: 0.9em;
    }
  `,
})
export class InboxList {
  readonly selectedId = input<number | null>(null);
  readonly selected = output<Inbox>();

  readonly feed = inject(LiveFeed);
  readonly #api = inject(MailtraxxApi);
  readonly inboxes = httpResource<Inbox[]>(() => '/api/inboxes');

  constructor() {
    effect(() => {
      if (this.feed.lastEvent()) this.inboxes.reload();
    });
  }

  async rename(inbox: Inbox): Promise<void> {
    const name = prompt('Rename inbox', inbox.name);
    if (!name?.trim()) return;
    await this.#api.renameInbox(inbox.id, name.trim());
    this.inboxes.reload();
  }

  async clear(event: Event, inbox: Inbox): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Delete all ${inbox.messageCount} messages in ${inbox.name}?`)) return;
    await this.#api.clearInbox(inbox.id);
    this.inboxes.reload();
  }
}
