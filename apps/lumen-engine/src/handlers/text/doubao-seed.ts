import { sleep } from '../../engine/cancellation.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import type { ExecutionContext, NodeOutput } from '../base.js';

export async function execute(
  input: ResolvedInput,
  _settings: Record<string, unknown>,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  // stub: simulate text generation with a delay
  await sleep(500, context.signal);
  const mockText = `[mock] Generated text for prompt: "${input.prompt.slice(0, 50)}..."`;
  return { type: 'text', value: mockText };
}
