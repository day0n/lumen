/**
 * 工具注册表。
 *
 * 维护 name → Tool 的映射，并对外暴露增删查、定义导出与调用入口。
 * execute 的处理链路为：参数纠正 → 校验 → 执行 → 异常兜底。
 */

import { logger } from '../../observability/logger.js';
import { type ToolResult, isToolResult } from '../../schemas/tools.js';
import { type OpenAIFunctionSchema, type Tool, appendErrorHint } from './base.js';
import { withToolEventEmitter } from './runtime.js';

export class ToolCatalog {
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
      logger.error({ tool_name: name, available_tools: this.toolNames }, 'unknown tool requested');
      return `Error: Tool '${name}' not found. Available: ${this.toolNames.join(', ')}`;
    }

    try {
      logger.info(
        { tool_name: name, raw_arg_keys: Object.keys(params ?? {}).sort() },
        'dispatching tool call',
      );
      const cast = tool.castParams(params ?? {});
      const errors = tool.validateParams(cast);
      if (errors.length > 0) {
        logger.warn(
          { tool_name: name, errors, cast_arg_keys: Object.keys(cast).sort() },
          'tool parameter validation rejected',
        );
        return `Error: Invalid parameters for tool '${name}': ${errors.join('; ')}\n\n[Re-read the error above, then adjust your inputs or take a different route.]`;
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
        'tool call returned',
      );
      return appendErrorHint(result);
    } catch (err) {
      logger.error({ err, tool_name: name }, 'tool threw during execution');
      const msg = err instanceof Error ? err.message : String(err);
      return `Error executing ${name}: ${msg}\n\n[Re-read the error above, then adjust your inputs or take a different route.]`;
    }
  }

  getByProtocol<T>(predicate: (t: Tool) => t is Tool & T): Array<Tool & T> {
    return [...this.tools.values()].filter(predicate);
  }
}
