/**
 * 所有工具的基类。
 *
 * 子类只需声明 name / description / parameters 三个元信息并实现 execute，
 * 基类负责把 LLM 传来的参数"擦干净"再交给业务逻辑：
 *   - castParams   尽量把字符串数字、用 null 表示"不填"等常见误传纠正过来
 *   - validateParams  按 JSON Schema 做一层浅校验，返回人类可读的错误列表
 *   - toSchema     导出 OpenAI function-calling 需要的结构
 */

import type { ToolResult } from '../../../domain/contracts/tools.js';
import { isToolResult } from '../../../domain/contracts/tools.js';

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

type ScalarOrContainer = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

const TRUTHY = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSY = new Set(['false', '0', 'no', 'n', 'off']);

/** Schema 的 type 允许写成 ["string","null"] 这种联合，取第一个非 null 的具体类型。 */
function pickType(type: JsonSchema['type']): ScalarOrContainer | null {
  const raw = Array.isArray(type) ? type.find((t) => t !== 'null') : type;
  return (raw as ScalarOrContainer | undefined) ?? null;
}

function isNullable(schema: JsonSchema): boolean {
  return (Array.isArray(schema.type) && schema.type.includes('null')) || schema.nullable === true;
}

/** 运行时值是否符合给定的 schema 类型。 */
function valueIsType(type: ScalarOrContainer, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 把单个值往目标标量类型上靠；靠不动就原样返回，交给后续校验报错。 */
function coerceScalar(type: ScalarOrContainer, value: unknown): unknown {
  if (type === 'string') {
    return value == null ? value : String(value);
  }
  if (typeof value !== 'string') return value;

  if (type === 'integer') {
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n) ? value : n;
  }
  if (type === 'number') {
    const n = Number.parseFloat(value);
    return Number.isNaN(n) ? value : n;
  }
  if (type === 'boolean') {
    const norm = value.trim().toLowerCase();
    if (TRUTHY.has(norm)) return true;
    if (FALSY.has(norm)) return false;
  }
  return value;
}

/** 容器类型若误传成 JSON 字符串，尝试解析回来。 */
function maybeParseJson(type: ScalarOrContainer, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const head = value.trimStart()[0];
  if ((type === 'array' && head !== '[') || (type === 'object' && head !== '{')) return value;
  try {
    const parsed = JSON.parse(value);
    const ok = type === 'array' ? Array.isArray(parsed) : isPlainObject(parsed);
    return ok ? parsed : value;
  } catch {
    return value;
  }
}

export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JsonSchema;
  /** execute 的最长执行时间（秒）；null 表示不设上限。 */
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

  // ── 参数纠正 ──────────────────────────────────────────────────────

  castParams(params: Record<string, unknown>): Record<string, unknown> {
    const schema = this.parameters ?? {};
    if ((pickType(schema.type) ?? 'object') !== 'object') return params;
    return this.castFields(params, schema);
  }

  private castFields(input: unknown, schema: JsonSchema): Record<string, unknown> {
    if (!isPlainObject(input)) return input as Record<string, unknown>;
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      // 选填字段传了 null 视为"省略"，直接丢掉，避免误判类型。
      if (value === null && !required.has(key)) continue;
      out[key] = key in props ? this.castOne(value, props[key]!) : value;
    }
    return out;
  }

  private castOne(value: unknown, schema: JsonSchema): unknown {
    const type = pickType(schema.type);
    if (!type) return value;

    if (type === 'array' || type === 'object') {
      const parsed = maybeParseJson(type, value);
      if (type === 'array' && Array.isArray(parsed) && schema.items) {
        return parsed.map((el) => this.castOne(el, schema.items!));
      }
      if (type === 'object' && isPlainObject(parsed)) {
        return this.castFields(parsed, schema);
      }
      return parsed;
    }

    return coerceScalar(type, value);
  }

  // ── 参数校验 ──────────────────────────────────────────────────────

  validateParams(params: Record<string, unknown>): string[] {
    if (!isPlainObject(params)) {
      return [`expected an object of parameters but received ${typeof params}`];
    }
    const schema = this.parameters ?? {};
    const type = pickType(schema.type);
    if (type && type !== 'object') {
      throw new Error(`top-level parameter schema must be of type object, not ${type}`);
    }
    const issues: string[] = [];
    this.checkAgainst(params, { ...schema, type: 'object' }, '', issues);
    return issues;
  }

  private checkAgainst(value: unknown, schema: JsonSchema, path: string, out: string[]): void {
    if (isNullable(schema) && value === null) return;
    const type = pickType(schema.type);
    const where = path || 'parameter';

    if (type && !valueIsType(type, value)) {
      out.push(`${where} should be of type ${type}`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      out.push(`${where} must be one of: ${JSON.stringify(schema.enum)}`);
    }

    switch (type) {
      case 'integer':
      case 'number': {
        const n = value as number;
        if (schema.minimum !== undefined && n < schema.minimum) {
          out.push(`${where} must be no less than ${schema.minimum}`);
        }
        if (schema.maximum !== undefined && n > schema.maximum) {
          out.push(`${where} must be no greater than ${schema.maximum}`);
        }
        break;
      }
      case 'string': {
        const s = value as string;
        if (schema.minLength !== undefined && s.length < schema.minLength) {
          out.push(`${where} needs at least ${schema.minLength} character(s)`);
        }
        if (schema.maxLength !== undefined && s.length > schema.maxLength) {
          out.push(`${where} may have at most ${schema.maxLength} character(s)`);
        }
        break;
      }
      case 'object': {
        const obj = value as Record<string, unknown>;
        const props = schema.properties ?? {};
        for (const key of schema.required ?? []) {
          if (!(key in obj)) out.push(`required field missing: ${path ? `${path}.${key}` : key}`);
        }
        for (const [key, child] of Object.entries(obj)) {
          if (key in props)
            this.checkAgainst(child, props[key]!, path ? `${path}.${key}` : key, out);
        }
        break;
      }
      case 'array': {
        if (schema.items) {
          (value as unknown[]).forEach((el, i) => {
            this.checkAgainst(el, schema.items!, path ? `${path}[${i}]` : `[${i}]`, out);
          });
        }
        break;
      }
    }
  }
}

/** 工具失败时附在结果末尾的引导语，提醒模型先看错误再决定下一步。 */
export const RETRY_GUIDANCE =
  '\n\nHint: read the failure above first, then fix the arguments or switch to another route before retrying.';

export function appendErrorHint(result: string | ToolResult): string | ToolResult {
  if (isToolResult(result)) {
    if (result.content.startsWith('Error')) result.content += RETRY_GUIDANCE;
    return result;
  }
  if (typeof result === 'string' && result.startsWith('Error')) return result + RETRY_GUIDANCE;
  return result;
}
