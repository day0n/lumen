import type { ModelConfig } from '@lumen/shared/domain';
import type { ResolvedInput } from '../../engine/resolver.js';
import type { ExecuteFn, ExecutionContext, NodeOutput } from '../base.js';

const registry: Record<string, () => Promise<{ execute: ExecuteFn }>> = {
  'doubao-seedream-3.0': () => import('./seedream.js'),
  'nano-banana2': () => import('./nano-banana2.js'),
};

export async function executeImage(
  input: ResolvedInput,
  model: ModelConfig,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  const loader = registry[model.id];
  if (!loader) {
    throw new Error(`unsupported image model: ${model.id}`);
  }
  const mod = await loader();
  return mod.execute(input, model.settings, context);
}
