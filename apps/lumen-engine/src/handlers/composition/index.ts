import type { ResolvedInput } from '../../engine/resolver.js';
import type { ExecutionContext, NodeOutput } from '../base.js';
import { execute as executeEdit } from '../video/edit.js';

export async function executeComposition(
  input: ResolvedInput,
  settings: Record<string, unknown>,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  const result = await executeEdit(input, settings, context);
  return { type: 'video', value: result.value };
}
