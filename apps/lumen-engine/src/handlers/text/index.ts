import type { ModelConfig } from '@lumen/shared/domain';
import type { ResolvedInput } from '../../engine/resolver.js';
import type { ExecuteFn, NodeOutput } from '../base.js';

const registry: Record<string, () => Promise<{ execute: ExecuteFn }>> = {
  'doubao-seed-2.0-pro': () => import('./doubao-seed.js'),
  'gemini-3.5-flash-lite': () => import('./gemini-flash-lite.js'),
};

export async function executeText(input: ResolvedInput, model: ModelConfig): Promise<NodeOutput> {
  const loader = registry[model.id];
  if (!loader) {
    throw new Error(`unsupported text model: ${model.id}`);
  }
  const mod = await loader();
  return mod.execute(input, model.settings);
}
