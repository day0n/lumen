import type { ModelConfig } from '@lumen/shared/domain';
import type { ResolvedInput } from '../../engine/resolver.js';
import type { ExecuteFn, NodeOutput } from '../base.js';

const registry: Record<string, () => Promise<{ execute: ExecuteFn }>> = {
  'seedance-1.5-pro': () => import('./seedance.js'),
  'veo-3.1': () => import('./veo31.js'),
};

export async function executeVideo(input: ResolvedInput, model: ModelConfig): Promise<NodeOutput> {
  const loader = registry[model.id];
  if (!loader) {
    throw new Error(`unsupported video model: ${model.id}`);
  }
  const mod = await loader();
  return mod.execute(input, model.settings);
}
