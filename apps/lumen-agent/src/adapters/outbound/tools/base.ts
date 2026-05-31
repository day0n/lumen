/**
 * 工具抽象基类。
 *
 * 子类需声明 name / description / parameters 并实现 execute。基类额外提供：
 *   - castParams：尽量把 LLM 误传的 "数字字符串"、用 null 表示省略等情况纠正回来
 *   - validateParams：对参数做一层浅层 JSON-Schema 校验
 *   - toSchema：导出成 OpenAI function-calling 所需的格式
 */

import type { ToolResult } from '../../../domain/contracts/tools.js';
import { isToolResult } from '../../../domain/contracts/tools.js';
import { logger } from '../../../platform/logger.js';

const TYPE_MAP: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  integer: (v) => typeof v === 'number' && Number.isInteger(v) && typeof v !== 'boolean',
  number: (v) => typeof v === 'number' && typeof v !== 'boolean',
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
};

function resolveType(t: unknown): string | null {
  if (Array.isArray(t)) {
    for (const item of t) if (item !== 'null') return item as string;
    return null;
  }
  return (t as string) ?? null;
}

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  description?: string;
  nullable?: boolean;
  [k: string]: unknown;
}

export interface OpenAIFunctionSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JsonSchema;
  /** 执行超时（秒）。null = 不限。 */
  readonly timeoutSeconds: number | null = null;

  abstract execute(args: Record<string, unknown>): Promise<string | ToolResult>;

  toSchema(): OpenAIFunctionSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }

  // ── cast / validate ────────────────────────────────────────────

  castParams(params: Record<string, unknown>): Record<string, unknown> {
    const schema = this.parameters ?? {};
    if ((schema.type ?? 'object') !== 'object') return params;
    return this.castObject(params, schema);
  }

  private castObject(obj: unknown, schema: JsonSchema): Record<string, unknown> {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // LLM 经常用 null 表示 "省略"，对非必填字段直接剔掉
      if (value === null && !required.has(key)) continue;
      if (key in props) {
        result[key] = this.castValue(value, props[key]!);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private castValue(val: unknown, schema: JsonSchema): unknown {
    let value = val;
    const t = resolveType(schema.type);

    if (t === 'integer' && typeof value === 'string') {
      const n = Number.parseInt(value, 10);
      return Number.isNaN(n) ? value : n;
    }
    if (t === 'number' && typeof value === 'string') {
      const n = Number.parseFloat(value);
      return Number.isNaN(n) ? value : n;
    }
    if (t === 'string') {
      return value == null ? value : String(value);
    }
    if (t === 'boolean' && typeof value === 'string') {
      const low = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(low)) return true;
      if (['false', '0', 'no', 'n', 'off'].includes(low)) return false;
      return value;
    }
    if ((t === 'array' || t === 'object') && typeof value === 'string') {
      const stripped = value.trim();
      if (stripped.startsWith('[') || stripped.startsWith('{')) {
        try {
          const parsed = JSON.parse(stripped);
          if (
            t === 'array' ? Array.isArray(parsed) : typeof parsed === 'object' && parsed !== null
          ) {
            value = parsed;
          }
        } catch {
          // 解析失败就保持原值
        }
      }
    }
    if (t === 'array' && Array.isArray(value) && schema.items) {
      return value.map((item) => this.castValue(item, schema.items!));
    }
    if (t === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return this.castObject(value, schema);
    }
    return value;
  }

  validateParams(params: Record<string, unknown>): string[] {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      return [`expected an object of parameters but received ${typeof params}`];
    }
    const schema = this.parameters ?? {};
    const t = resolveType(schema.type);
    if (t && t !== 'object') {
      throw new Error(`top-level parameter schema must be of type object, not ${t}`);
    }
    return this.validate(params, { ...schema, type: 'object' }, '');
  }

  private validate(val: unknown, schema: JsonSchema, path: string): string[] {
    const rawType = schema.type;
    const nullable =
      (Array.isArray(rawType) && rawType.includes('null')) || schema.nullable === true;
    const t = resolveType(rawType);
    const label = path || 'parameter';
    if (nullable && val === null) return [];

    if (t && TYPE_MAP[t] && !TYPE_MAP[t]!(val)) {
      return [`${label} should be of type ${t}`];
    }
    const errors: string[] = [];
    if (schema.enum && !schema.enum.includes(val)) {
      errors.push(`${label} must be one of: ${JSON.stringify(schema.enum)}`);
    }
    if (t === 'integer' || t === 'number') {
      if (schema.minimum !== undefined && (val as number) < schema.minimum) {
        errors.push(`${label} must be no less than ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && (val as number) > schema.maximum) {
        errors.push(`${label} must be no greater than ${schema.maximum}`);
      }
    }
    if (t === 'string' && typeof val === 'string') {
      if (schema.minLength !== undefined && val.length < schema.minLength) {
        errors.push(`${label} needs at least ${schema.minLength} character(s)`);
      }
      if (schema.maxLength !== undefined && val.length > schema.maxLength) {
        errors.push(`${label} may have at most ${schema.maxLength} character(s)`);
      }
    }
    if (t === 'object' && typeof val === 'object' && val !== null) {
      const props = schema.properties ?? {};
      for (const k of schema.required ?? []) {
        if (!(k in (val as Record<string, unknown>))) {
          errors.push(`required field missing: ${path ? `${path}.${k}` : k}`);
        }
      }
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (k in props) {
          errors.push(...this.validate(v, props[k]!, path ? `${path}.${k}` : k));
        }
      }
    }
    if (t === 'array' && Array.isArray(val) && schema.items) {
      val.forEach((item, i) => {
        errors.push(...this.validate(item, schema.items!, path ? `${path}[${i}]` : `[${i}]`));
      });
    }
    return errors;
  }
}

// ── 一组可选 mixin / interface（前期占位） ────────────────────────

export interface TurnAware {
  onTurnStart?(): void;
  onTurnEnd?(): boolean;
}

export interface ContextAware {
  setRoutingContext(channel: string, chatId: string, messageId?: string): void;
}

// ── helper：执行结果统一加 hint ────────────────────────────────────

const ERROR_HINT =
  '\n\n[Re-read the error above, then adjust your inputs or take a different route.]';

export function appendErrorHint(result: string | ToolResult): string | ToolResult {
  if (isToolResult(result)) {
    if (result.content.startsWith('Error')) result.content += ERROR_HINT;
    return result;
  }
  if (typeof result === 'string' && result.startsWith('Error')) {
    return result + ERROR_HINT;
  }
  return result;
}

export { logger };
