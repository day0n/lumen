import { AsyncLocalStorage } from 'node:async_hooks';

type ToolEvent = { name: string; data: Record<string, unknown> };
type ToolEventEmitter = (event: ToolEvent) => Promise<void> | void;

const storage = new AsyncLocalStorage<ToolEventEmitter>();

export function withToolEventEmitter<T>(
  emitter: ToolEventEmitter,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(emitter, fn);
}

export async function emitToolEvent(
  name: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const emitter = storage.getStore();
  if (!emitter) return;
  await emitter({ name, data });
}
