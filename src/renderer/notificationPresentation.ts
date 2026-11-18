import type { AppNotificationPayload } from "../shared/types";

export function notificationOperation(key: string): string {
  return /^(switch|auth):[^:]+/.exec(key)?.[0] ?? key;
}

/** Phases replace their own operation; a delayed progress event cannot revive it. */
export function mergeNotification(
  current: AppNotificationPayload[],
  incoming: AppNotificationPayload
): AppNotificationPayload[] {
  const operation = notificationOperation(incoming.key);
  const previous = current.find((item) => notificationOperation(item.key) === operation);
  if (previous && (incoming.createdAt < previous.createdAt
    || incoming.tone === "progress" && previous.tone !== "progress")) return current;
  return [incoming, ...current.filter((item) => notificationOperation(item.key) !== operation)].slice(0, 3);
}

export function notificationDeadline(notice: AppNotificationPayload): number | null {
  if (notice.timeoutType === "never" || notice.progress && notice.tone === "progress") return null;
  return notice.createdAt * 1_000 + 7_000;
}
