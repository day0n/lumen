import type { ModelConfig, NodeType } from '@lumen/shared/domain';
import type { ResolvedInput } from '../engine/resolver.js';

export interface NodeOutput {
  type: NodeType;
  value: string;
}

export interface ExecutionContext {
  signal?: AbortSignal;
}

export type ExecuteFn = (
  input: ResolvedInput,
  settings: Record<string, unknown>,
  context?: ExecutionContext,
) => Promise<NodeOutput>;

export async function executeNode(
  type: NodeType,
  input: ResolvedInput,
  model: ModelConfig,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  switch (type) {
    case 'text': {
      const { executeText } = await import('../handlers/text/index.js');
      return executeText(input, model, context);
    }
    case 'image': {
      const { executeImage } = await import('../handlers/image/index.js');
      return executeImage(input, model, context);
    }
    case 'video': {
      const { executeVideo } = await import('../handlers/video/index.js');
      return executeVideo(input, model, context);
    }
    case 'audio': {
      const { executeAudio } = await import('../handlers/audio/index.js');
      return executeAudio(input, model, context);
    }
  }
}
