import type { ModelConfig } from '@lumen/shared/domain';
import type { ResolvedInput } from '../../engine/resolver.js';
import type { ExecuteFn, ExecutionContext, NodeOutput } from '../base.js';

const registry: Record<string, () => Promise<{ execute: ExecuteFn }>> = {
  'seedance-1.5-pro': () => import('./seedance.js'),
  'veo-3.1': () => import('./veo31.js'),
  'lumen-video-edit': () => import('./edit.js'),
};

export async function executeVideo(
  input: ResolvedInput,
  model: ModelConfig,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  const loader = registry[model.id];
  if (!loader) {
    throw new Error(`unsupported video model: ${model.id}`);
  }
  const mod = await loader();
  return mod.execute(input, model.settings, context);
}
