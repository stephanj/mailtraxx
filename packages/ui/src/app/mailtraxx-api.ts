import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Inbox } from './models';

@Injectable({ providedIn: 'root' })
export class MailtraxxApi {
  readonly #http = inject(HttpClient);

  renameInbox(id: number, name: string): Promise<Inbox> {
    return firstValueFrom(this.#http.patch<Inbox>(`/api/inboxes/${id}`, { name }));
  }

  clearInbox(id: number): Promise<void> {
    return firstValueFrom(this.#http.delete<void>(`/api/inboxes/${id}/messages`));
  }

  deleteMessage(id: number): Promise<void> {
    return firstValueFrom(this.#http.delete<void>(`/api/messages/${id}`));
  }

  rawUrl(id: number): string {
    return `/api/messages/${id}/raw`;
  }
}
