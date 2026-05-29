import type { ModelConfig, NodeType } from '@lumen/shared/domain';
import type { ResolvedInput } from '../engine/resolver.js';

export interface NodeOutput {
  type: NodeType;
  value: string;
}

export type ExecuteFn = (
  input: ResolvedInput,
  settings: Record<string, unknown>,
) => Promise<NodeOutput>;

export async function executeNode(
  type: NodeType,
  input: ResolvedInput,
  model: ModelConfig,
): Promise<NodeOutput> {
  switch (type) {
    case 'text': {
      const { executeText } = await import('../handlers/text/index.js');
      return executeText(input, model);
    }
    case 'image': {
      const { executeImage } = await import('../handlers/image/index.js');
      return executeImage(input, model);
    }
    case 'video': {
      const { executeVideo } = await import('../handlers/video/index.js');
      return executeVideo(input, model);
    }
    case 'audio': {
      const { executeAudio } = await import('../handlers/audio/index.js');
      return executeAudio(input, model);
    }
  }
}
