import { sleep } from '../../engine/cancellation.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import type { ExecutionContext, NodeOutput } from '../base.js';

export async function execute(
  _input: ResolvedInput,
  _settings: Record<string, unknown>,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  await sleep(600, context.signal);
  const mockUrl = `https://mock.lumen.app/audio/${Date.now()}.mp3`;
  return { type: 'audio', value: mockUrl };
}
