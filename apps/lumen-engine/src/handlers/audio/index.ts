import type { ModelConfig } from '@lumen/shared/domain';
import type { ResolvedInput } from '../../engine/resolver.js';
import type { ExecuteFn, NodeOutput } from '../base.js';

const registry: Record<string, () => Promise<{ execute: ExecuteFn }>> = {
  'doubao-tts': () => import('./doubao-tts.js'),
  'fish-tts': () => import('./fish-tts.js'),
  'suno-music': () => import('./suno-music.js'),
};

export async function executeAudio(input: ResolvedInput, model: ModelConfig): Promise<NodeOutput> {
  const loader = registry[model.id];
  if (!loader) {
    throw new Error(`unsupported audio model: ${model.id}`);
  }
  const mod = await loader();
  return mod.execute(input, model.settings);
}
