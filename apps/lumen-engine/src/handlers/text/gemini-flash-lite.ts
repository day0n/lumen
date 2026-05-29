import { getGoogleClient } from '../../clients/google.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { NodeOutput } from '../base.js';

export async function execute(
  input: ResolvedInput,
  _settings: Record<string, unknown>,
): Promise<NodeOutput> {
  const client = getGoogleClient();

  const response = await client.models.generateContent({
    model: 'gemini-3.5-flash-lite-preview-06-17',
    contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
  });

  const text = response.text ?? '';
  logger.info({ chars: text.length }, 'gemini flash lite response');

  return { type: 'text', value: text };
}
