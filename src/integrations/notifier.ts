/**
 * Teams notification boundary.
 *
 * The MVP never calls a network endpoint: posting to Teams from a public static
 * bundle would require an embedded secret. `MockNotificationGateway` only records
 * what *would* be sent, so the UI and the summary builder can be exercised today.
 *
 * To go live, implement `NotificationGateway` against an organisation-approved
 * Power Automate / Workflows endpoint that is called from a backend holding the
 * credential, and swap the instance in `createNotificationGateway`.
 */

export interface NotificationMessage {
  title: string;
  body: string;
  /** Deep link included in the post. */
  url: string;
  /** 'daily' = morning summary, 'urgent' = 重要度大 / 要注視 発生時 */
  kind: 'daily' | 'urgent';
}

export interface NotificationResult {
  delivered: boolean;
  /** Human readable outcome shown in the UI. */
  detail: string;
  at: string;
}

export interface NotificationGateway {
  readonly id: string;
  readonly available: boolean;
  send(message: NotificationMessage): Promise<NotificationResult>;
  /** Everything sent during this session. Used by the UI and by tests. */
  history(): readonly NotificationMessage[];
}

export class MockNotificationGateway implements NotificationGateway {
  readonly id = 'mock';
  /** Deliberately false: the button must not claim it posted anything. */
  readonly available = false;

  private readonly sent: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<NotificationResult> {
    this.sent.push(message);
    return {
      delivered: false,
      detail:
        'MVPではTeamsへの自動投稿を行いません。生成された投稿文をコピーして手動で投稿してください。',
      at: new Date().toISOString(),
    };
  }

  history(): readonly NotificationMessage[] {
    return this.sent;
  }
}

let gateway: NotificationGateway | null = null;

export function createNotificationGateway(): NotificationGateway {
  if (!gateway) gateway = new MockNotificationGateway();
  return gateway;
}

/** Test seam. */
export function setNotificationGateway(next: NotificationGateway | null): void {
  gateway = next;
}
