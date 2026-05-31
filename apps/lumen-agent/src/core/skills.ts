/**
 * Skills 加载器。
 *
 * 遍历 ./skills 下的每个子目录，读取其中的 SKILL.md，用 gray-matter 解析
 * YAML frontmatter，并把结果缓存在内存里供后续按需取用。
 *
 * frontmatter 约定（除 name 外均可选）：
 *   name / description / trigger / emoji / homepage / always
 *   requiresBins / requiresEnv / installHint
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';

import { logger } from '../observability/logger.js';

export interface SkillInfo {
  name: string;
  description: string;
  trigger: string;
  emoji: string;
  homepage: string;
  always: boolean;
  requiresBins: string[];
  requiresEnv: string[];
  installHint: string;
  /** 完整 SKILL.md（{skill_dir} 已替换） */
  content: string;
  /** 去掉 frontmatter 的正文 */
  body: string;
  path: string;
  skillDir: string;
  available: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/lumen-agent/src/core/skills.ts → apps/lumen-agent/skills
export const BUILTIN_SKILLS_DIR = resolve(__dirname, '..', '..', 'skills');

const SKILL_DIR_PLACEHOLDER = '{skill_dir}';

/** frontmatter 里的值可能是 YAML 数组，也可能是逗号分隔字符串，统一归一成字符串数组。 */
function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/** YAML 会把 `always: true` 解析成布尔；同时兼容字符串写法。 */
function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

function meetsRequirements(requiredEnv: string[]): boolean {
  // 环境变量是硬性前置条件；二进制依赖（bins）在 Node 运行时缺乏可靠探测手段，
  // 暂按软约束处理，不在此拦截。
  return requiredEnv.every((env) => Boolean(process.env[env]));
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class SkillLibrary {
  private skills = new Map<string, SkillInfo>();

  constructor(public readonly builtinSkillsDir: string = BUILTIN_SKILLS_DIR) {
    this.loadAll();
  }

  private loadAll(): void {
    this.skills.clear();
    if (!existsSync(this.builtinSkillsDir)) return;

    for (const entry of readdirSync(this.builtinSkillsDir).sort()) {
      const entryPath = join(this.builtinSkillsDir, entry);
      try {
        if (!statSync(entryPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const skillFile = join(entryPath, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      let raw: string;
      try {
        raw = readFileSync(skillFile, 'utf-8');
      } catch (err) {
        logger.warn({ err, file: skillFile }, 'Failed to read SKILL.md');
        continue;
      }

      const parsed = this.toSkillInfo(raw, entry, entryPath, skillFile);
      if (parsed) this.skills.set(parsed.name, parsed);
    }

    logger.debug({ count: this.skills.size, names: [...this.skills.keys()] }, 'Skills loaded');
  }

  private toSkillInfo(
    raw: string,
    entry: string,
    entryPath: string,
    skillFile: string,
  ): SkillInfo | null {
    let data: Record<string, unknown>;
    let body: string;
    try {
      const fm = matter(raw);
      data = fm.data as Record<string, unknown>;
      body = fm.content;
    } catch (err) {
      logger.warn({ err, file: skillFile }, 'SKILL.md frontmatter 解析失败，跳过');
      return null;
    }

    const declaredName = data.name == null ? '' : String(data.name).trim();
    if (declaredName && declaredName !== entry) {
      logger.warn(`Skill skipped: dir '${entry}' but name '${declaredName}'; must match`);
      return null;
    }
    const name = declaredName || entry;

    const description = data.description == null ? '' : String(data.description);
    if (!description) logger.warn(`Skill '${name}' has no description in frontmatter`);

    const requiresBins = toStringList(data.requiresBins);
    const requiresEnv = toStringList(data.requiresEnv);

    const fillDir = (s: string) => s.split(SKILL_DIR_PLACEHOLDER).join(entryPath);

    return {
      name,
      description,
      trigger: data.trigger == null ? '' : String(data.trigger),
      emoji: data.emoji == null ? '' : String(data.emoji),
      homepage: data.homepage == null ? '' : String(data.homepage),
      always: toBool(data.always),
      requiresBins,
      requiresEnv,
      installHint: data.installHint == null ? '' : String(data.installHint),
      content: fillDir(raw),
      body: fillDir(body.replace(/^\n+/, '')),
      path: skillFile,
      skillDir: entryPath,
      available: meetsRequirements(requiresEnv),
    };
  }

  reload(): void {
    this.loadAll();
  }

  filtered(allowedNames: readonly string[]): SkillLibrary {
    const clone: SkillLibrary = Object.create(SkillLibrary.prototype);
    Object.assign(clone, { builtinSkillsDir: this.builtinSkillsDir });
    const allowed = new Set(allowedNames);
    const subset = new Map<string, SkillInfo>();
    for (const [k, v] of this.skills) {
      if (allowed.has(k)) subset.set(k, v);
    }
    (clone as unknown as { skills: Map<string, SkillInfo> }).skills = subset;
    return clone;
  }

  listSkills(filterUnavailable = true): Array<{ name: string; path: string; source: 'builtin' }> {
    const out: Array<{ name: string; path: string; source: 'builtin' }> = [];
    for (const s of this.skills.values()) {
      if (filterUnavailable && !s.available) continue;
      out.push({ name: s.name, path: s.path, source: 'builtin' });
    }
    return out;
  }

  loadSkill(name: string): string | null {
    return this.skills.get(name)?.content ?? null;
  }

  loadSkillsForContext(skillNames: readonly string[]): string {
    const parts: string[] = [];
    for (const name of skillNames) {
      const s = this.skills.get(name);
      if (s) parts.push(`### Skill: ${name}\n\n${s.body}`);
    }
    return parts.join('\n\n---\n\n');
  }

  buildSkillsSummary(): string {
    if (this.skills.size === 0) return '';
    const lines: string[] = ['<skills>'];
    for (const s of this.skills.values()) {
      lines.push(`  <skill available="${s.available}">`);
      lines.push(`    <name>${xmlEscape(s.name)}</name>`);
      lines.push(`    <description>${xmlEscape(s.description || s.name)}</description>`);
      if (s.trigger) lines.push(`    <trigger>${xmlEscape(s.trigger)}</trigger>`);
      lines.push('  </skill>');
    }
    lines.push('</skills>');
    return lines.join('\n');
  }

  getAlwaysSkills(): string[] {
    return [...this.skills.values()].filter((s) => s.always && s.available).map((s) => s.name);
  }

  getSkillInfo(name: string): SkillInfo | null {
    return this.skills.get(name) ?? null;
  }
}
