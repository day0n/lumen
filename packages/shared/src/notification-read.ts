export interface OptimisticNotificationReadOptions {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  setRead(isRead: boolean): void;
}

export async function markNotificationReadOptimistically(
  notificationId: string,
  options: OptimisticNotificationReadOptions,
): Promise<void> {
  options.setRead(true);

  try {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('Fetch is unavailable');
    }

    const response = await fetchImpl(
      `/api/notifications/official/${encodeURIComponent(notificationId)}/read`,
      { method: 'POST' },
    );
    if (!response.ok) {
      throw new Error(`Notification read failed with status ${response.status}`);
    }
    if (response.status === 204) return;

    const payload: unknown = await response.json();
    if (!isNotificationReadSuccess(payload)) {
      throw new Error('Notification read returned an invalid response');
    }
  } catch (error) {
    options.setRead(false);
    throw error;
  }
}

function isNotificationReadSuccess(
  payload: unknown,
): payload is { data: { read: true }; ok: true } {
  if (typeof payload !== 'object' || payload === null) return false;
  if (!('ok' in payload) || payload.ok !== true || !('data' in payload)) return false;
  const data = payload.data;
  return typeof data === 'object' && data !== null && 'read' in data && data.read === true;
}
