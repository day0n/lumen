/**
 * Tool registry。
 *
 * 提供：register / unregister / get / has / get_definitions / execute / iter / size
 * execute 内做 cast → validate → run → 错误兜底。
 */

import { logger } from '../../observability/logger.js';
import { type ToolResult, isToolResult } from '../../schemas/tools.js';
import { type OpenAIFunctionSchema, type Tool, appendErrorHint } from './base.js';
import { withToolEventEmitter } from './runtime.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get size(): number {
    return this.tools.size;
  }

  get toolNames(): string[] {
    return [...this.tools.keys()];
  }

  *[Symbol.iterator](): IterableIterator<Tool> {
    yield* this.tools.values();
  }

  getDefinitions(opts: { exclude?: Set<string> } = {}): OpenAIFunctionSchema[] {
    const out: OpenAIFunctionSchema[] = [];
    for (const [name, tool] of this.tools) {
      if (opts.exclude?.has(name)) continue;
      out.push(tool.toSchema());
    }
    return out;
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
    opts: {
      onToolEvent?: (event: {
        name: string;
        data: Record<string, unknown>;
      }) => void | Promise<void>;
    } = {},
  ): Promise<string | ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      logger.error({ tool_name: name, available_tools: this.toolNames }, 'Tool registry miss');
      return `Error: Tool '${name}' not found. Available: ${this.toolNames.join(', ')}`;
    }

    try {
      logger.info(
        { tool_name: name, raw_arg_keys: Object.keys(params ?? {}).sort() },
        'Tool registry execute',
      );
      const cast = tool.castParams(params ?? {});
      const errors = tool.validateParams(cast);
      if (errors.length > 0) {
        logger.warn(
          { tool_name: name, errors, cast_arg_keys: Object.keys(cast).sort() },
          'Tool validation failed',
        );
        return `Error: Invalid parameters for tool '${name}': ${errors.join('; ')}\n\n[Analyze the error above and try a different approach.]`;
      }
      const runTool = () => tool.execute(cast);
      const result = opts.onToolEvent
        ? await withToolEventEmitter(opts.onToolEvent, runTool)
        : await runTool();
      logger.info(
        {
          tool_name: name,
          result_type: isToolResult(result) ? 'ToolResult' : typeof result,
        },
        'Tool registry result',
      );
      return appendErrorHint(result);
    } catch (err) {
      logger.error({ err, tool_name: name }, 'Tool raised an exception');
      const msg = err instanceof Error ? err.message : String(err);
      return `Error executing ${name}: ${msg}\n\n[Analyze the error above and try a different approach.]`;
    }
  }

  getByProtocol<T>(predicate: (t: Tool) => t is Tool & T): Array<Tool & T> {
    return [...this.tools.values()].filter(predicate);
  }
}
