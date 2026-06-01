/**
 * Skills 加载器。
 *
 * 扫描 ./skills 下每个子目录里的 SKILL.md，解析其 YAML frontmatter 后缓存到内存。
 * 约定目录名即技能名；frontmatter 除 name 外字段均可选。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';

import { logger } from '../platform/logger.js';

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
  /** 完整 SKILL.md 原文 */
  content: string;
  /** 去掉 frontmatter 的正文 */
  body: string;
  path: string;
  skillDir: string;
  available: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/lumen-agent/src/application/skills.ts → apps/lumen-agent/skills
export const BUILTIN_SKILLS_DIR = resolve(__dirname, '..', '..', 'skills');

/** frontmatter 字段可能写成 YAML 数组或逗号串，统一收敛为去空字符串数组。 */
function asList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw.map((v) => String(v).trim()).filter(Boolean);
}

function asBool(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 解析单个 SKILL.md，返回 SkillInfo；目录名与声明名不一致或解析失败则返回 null。 */
function parseSkill(
  raw: string,
  dirName: string,
  dirPath: string,
  filePath: string,
): SkillInfo | null {
  let data: Record<string, unknown>;
  let body: string;
  try {
    const fm = matter(raw);
    data = fm.data as Record<string, unknown>;
    body = fm.content;
  } catch (err) {
    logger.warn({ err, file: filePath }, 'SKILL.md frontmatter 解析失败');
    return null;
  }

  const str = (key: string): string => (data[key] == null ? '' : String(data[key]));

  const declared = str('name').trim();
  if (declared && declared !== dirName) {
    logger.warn({ dir: dirName, declared }, '技能名与目录名不符，已忽略');
    return null;
  }
  const name = declared || dirName;
  const description = str('description');
  if (!description) logger.warn({ skill: name }, '技能缺少 description');

  const requiresEnv = asList(data.requiresEnv);
  // 环境变量视为硬前置；二进制依赖在 Node 侧难以可靠探测，仅记录不拦截。
  const available = requiresEnv.every((env) => Boolean(process.env[env]));

  return {
    name,
    description,
    trigger: str('trigger'),
    emoji: str('emoji'),
    homepage: str('homepage'),
    always: asBool(data.always),
    requiresBins: asList(data.requiresBins),
    requiresEnv,
    installHint: str('installHint'),
    content: raw,
    body: body.replace(/^\n+/, ''),
    path: filePath,
    skillDir: dirPath,
    available,
  };
}

export class SkillLibrary {
  private skills: Map<string, SkillInfo>;

  /** seed 仅供 filtered() 内部传入，外部调用只需给目录路径。 */
  constructor(
    public readonly builtinSkillsDir: string = BUILTIN_SKILLS_DIR,
    seed?: Map<string, SkillInfo>,
  ) {
    this.skills = seed ?? new Map();
    if (!seed) this.scan();
  }

  private scan(): void {
    this.skills.clear();
    if (!existsSync(this.builtinSkillsDir)) return;

    for (const dirName of readdirSync(this.builtinSkillsDir).sort()) {
      const dirPath = join(this.builtinSkillsDir, dirName);
      let isDir = false;
      try {
        isDir = statSync(dirPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;

      const filePath = join(dirPath, 'SKILL.md');
      if (!existsSync(filePath)) continue;

      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch (err) {
        logger.warn({ err, file: filePath }, '读取 SKILL.md 失败');
        continue;
      }

      const info = parseSkill(raw, dirName, dirPath, filePath);
      if (info) this.skills.set(info.name, info);
    }

    logger.debug({ count: this.skills.size, names: [...this.skills.keys()] }, 'Skills loaded');
  }

  reload(): void {
    this.scan();
  }

  /** 返回只含指定技能的新库（共享已解析的 SkillInfo，不重新扫盘）。 */
  filtered(allowedNames: readonly string[]): SkillLibrary {
    const allowed = new Set(allowedNames);
    const subset = new Map<string, SkillInfo>();
    for (const [key, info] of this.skills) {
      if (allowed.has(key)) subset.set(key, info);
    }
    return new SkillLibrary(this.builtinSkillsDir, subset);
  }

  listSkills(onlyAvailable = true): Array<{ name: string; path: string; source: 'builtin' }> {
    return [...this.skills.values()]
      .filter((s) => !onlyAvailable || s.available)
      .map((s) => ({ name: s.name, path: s.path, source: 'builtin' as const }));
  }

  loadSkill(name: string): string | null {
    return this.skills.get(name)?.content ?? null;
  }

  getSkillInfo(name: string): SkillInfo | null {
    return this.skills.get(name) ?? null;
  }

  getAlwaysSkills(): string[] {
    return [...this.skills.values()].filter((s) => s.always && s.available).map((s) => s.name);
  }

  /** 拼接若干技能正文，供需要时直接注入上下文。 */
  loadSkillsForContext(skillNames: readonly string[]): string {
    return skillNames
      .map((name) => this.skills.get(name))
      .filter((s): s is SkillInfo => Boolean(s))
      .map((s) => `## ${s.name}\n${s.body}`)
      .join('\n\n---\n\n');
  }

  /** 生成技能清单摘要（XML 片段），让模型知道有哪些可按需加载的技能。 */
  buildSkillsSummary(): string {
    if (this.skills.size === 0) return '';
    const entries = [...this.skills.values()].map((s) => {
      const fields = [
        `    <name>${escapeXml(s.name)}</name>`,
        `    <summary>${escapeXml(s.description || s.name)}</summary>`,
      ];
      if (s.trigger) fields.push(`    <when>${escapeXml(s.trigger)}</when>`);
      return `  <entry ready="${s.available}">\n${fields.join('\n')}\n  </entry>`;
    });
    return `<available-skills>\n${entries.join('\n')}\n</available-skills>`;
  }
}
