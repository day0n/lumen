import type { ModelConfig, NodeOutputType, NodeType } from '@lumen/shared/domain';
import { executeMediaModelWithRetry } from '../engine/model-errors.js';
import type { ResolvedInput } from '../engine/resolver.js';

export interface NodeOutput {
  type: NodeOutputType;
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
      return executeMediaModelWithRetry({
        nodeType: 'image',
        modelId: model.id,
        signal: context.signal,
        execute: () => executeImage(input, model, context),
      });
    }
    case 'video': {
      const { executeVideo } = await import('../handlers/video/index.js');
      if (model.id === 'lumen-video-edit') {
        return executeVideo(input, model, context);
      }
      return executeMediaModelWithRetry({
        nodeType: 'video',
        modelId: model.id,
        signal: context.signal,
        execute: () => executeVideo(input, model, context),
      });
    }
    case 'audio': {
      const { executeAudio } = await import('../handlers/audio/index.js');
      return executeAudio(input, model, context);
    }
    case 'composition': {
      const { executeComposition } = await import('../handlers/composition/index.js');
      return executeComposition(input, model.settings, context);
    }
  }
}
