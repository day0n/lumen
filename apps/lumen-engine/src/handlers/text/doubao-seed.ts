import type { ResolvedInput } from '../../engine/resolver.js';
import type { NodeOutput } from '../base.js';

export async function execute(
  input: ResolvedInput,
  _settings: Record<string, unknown>,
): Promise<NodeOutput> {
  // stub: simulate text generation with a delay
  await sleep(500);
  const mockText = `[mock] Generated text for prompt: "${input.prompt.slice(0, 50)}..."`;
  return { type: 'text', value: mockText };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
