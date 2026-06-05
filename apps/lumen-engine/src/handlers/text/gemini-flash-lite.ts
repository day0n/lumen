import { getGoogleClient } from '../../clients/google.js';
import { throwIfCancelled } from '../../engine/cancellation.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { ExecutionContext, NodeOutput } from '../base.js';

export async function execute(
  input: ResolvedInput,
  _settings: Record<string, unknown>,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  const { signal } = context;
  throwIfCancelled(signal);
  const client = getGoogleClient();

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
  });
  throwIfCancelled(signal);

  const text = response.text ?? '';
  logger.info({ chars: text.length }, 'gemini flash lite response');

  return { type: 'text', value: text };
}
