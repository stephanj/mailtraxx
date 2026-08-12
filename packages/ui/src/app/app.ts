import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { InboxList } from './inbox-list';
import { MessageList } from './message-list';
import { MessageViewer } from './message-viewer';
import type { Inbox, MessageSummary } from './models';

@Component({
  selector: 'app-root',
  imports: [InboxList, MessageList, MessageViewer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <mtx-inbox-list [selectedId]="inbox()?.id ?? null" (selected)="selectInbox($event)" />

      @if (inbox(); as current) {
        <mtx-message-list
          [inboxId]="current.id"
          [selectedId]="message()?.id ?? null"
          (selected)="message.set($event)"
        />
      } @else {
        <div class="placeholder">Select an inbox</div>
      }

      @if (message(); as selected) {
        <mtx-message-viewer [messageId]="selected.id" (deleted)="message.set(null)" />
      } @else {
        <div class="placeholder">Select a message</div>
      }
    </div>
  `,
  styles: `
    .shell {
      display: grid;
      grid-template-columns: 15rem 22rem 1fr;
      height: 100dvh;
    }
    .placeholder {
      display: grid;
      place-items: center;
      color: var(--muted);
    }
  `,
})
export class App {
  readonly inbox = signal<Inbox | null>(null);
  readonly message = signal<MessageSummary | null>(null);

  selectInbox(inbox: Inbox): void {
    this.inbox.set(inbox);
    this.message.set(null);
  }
}
