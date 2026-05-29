import type { ResolvedInput } from '../../engine/resolver.js';
import type { NodeOutput } from '../base.js';

export async function execute(
  _input: ResolvedInput,
  _settings: Record<string, unknown>,
): Promise<NodeOutput> {
  await sleep(600);
  const mockUrl = `https://mock.lumen.app/audio/${Date.now()}.mp3`;
  return { type: 'audio', value: mockUrl };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
