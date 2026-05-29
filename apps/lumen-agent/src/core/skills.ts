/**
 * Skills 加载器。
 *
 * 扫描 ./skills 目录下每个子目录里的 SKILL.md：
 * 解析 frontmatter（只支持 flat key: value），缓存到内存。
 *
 * 支持字段（除 name 外都可选）：
 *   name / description / trigger / emoji / homepage / always
 *   requires_bins / requires_env / install_hint
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '../observability/logger.js';

export interface SkillInfo {
  name: string;
  description: string;
  trigger: string;
  emoji: string;
  homepage: string;
  always: boolean;
  requires_bins: string[];
  requires_env: string[];
  install_hint: string;
  /** 完整 SKILL.md（{skill_dir} 已替换） */
  content: string;
  /** 去掉 frontmatter 的 body */
  body: string;
  path: string;
  skillDir: string;
  available: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/lumen-agent/src/core/skills.ts → apps/lumen-agent/skills
export const BUILTIN_SKILLS_DIR = resolve(__dirname, '..', '..', 'skills');

function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  let text = raw.startsWith('﻿') ? raw.slice(1) : raw;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (!text.startsWith('---\n') && text !== '---') {
    return { fields: {}, body: text };
  }
  const close = text.indexOf('\n---', 3);
  if (close === -1) {
    logger.warn('Frontmatter has no closing "---", treating entire file as body');
    return { fields: {}, body: text };
  }
  const fmBlock = text.slice(4, close);
  const body = text.slice(close + 4).replace(/^\n+/, '');

  const fields: Record<string, string> = {};
  for (const rawLine of fmBlock.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value && (value[0] === '{' || value[0] === '[')) {
      logger.warn(`Frontmatter '${key}' looks like JSON; only flat scalars supported. Skipped.`);
      continue;
    }
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return { fields, body };
}

function parseCsv(value: string): string[] {
  return value
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
}

function checkRequirements(bins: string[], envs: string[]): boolean {
  for (const env of envs) {
    if (!process.env[env]) return false;
  }
  // bins 检查在 Node 里没有现成的 which；前期把 bins 视为软约束
  for (const _bin of bins) {
    void _bin;
  }
  return true;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class SkillsLoader {
  private skills = new Map<string, SkillInfo>();

  constructor(public readonly builtinSkillsDir: string = BUILTIN_SKILLS_DIR) {
    this.loadAll();
  }

  private loadAll(): void {
    this.skills.clear();
    if (!existsSync(this.builtinSkillsDir)) return;

    const entries = readdirSync(this.builtinSkillsDir).sort();
    for (const entry of entries) {
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
      const { fields, body } = parseFrontmatter(raw);
      let name = fields.name ?? '';
      if (name && name !== entry) {
        logger.warn(`Skill skipped: dir '${entry}' but name '${name}'; must match`);
        continue;
      }
      if (!name) name = entry;
      if (!fields.description) {
        logger.warn(`Skill '${name}' has no description in frontmatter`);
      }

      const requires_bins = parseCsv(fields.requires_bins ?? '');
      const requires_env = parseCsv(fields.requires_env ?? '');
      const resolvedContent = raw.replaceAll('{skill_dir}', entryPath);
      const resolvedBody = body.replaceAll('{skill_dir}', entryPath);

      this.skills.set(name, {
        name,
        description: fields.description ?? '',
        trigger: fields.trigger ?? '',
        emoji: fields.emoji ?? '',
        homepage: fields.homepage ?? '',
        always: (fields.always ?? '').trim().toLowerCase() === 'true',
        requires_bins,
        requires_env,
        install_hint: fields.install_hint ?? '',
        content: resolvedContent,
        body: resolvedBody,
        path: skillFile,
        skillDir: entryPath,
        available: checkRequirements(requires_bins, requires_env),
      });
    }
    logger.debug({ count: this.skills.size, names: [...this.skills.keys()] }, 'Skills loaded');
  }

  reload(): void {
    this.loadAll();
  }

  filtered(allowedNames: readonly string[]): SkillsLoader {
    const clone: SkillsLoader = Object.create(SkillsLoader.prototype);
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
      lines.push(`    <name>${escapeXml(s.name)}</name>`);
      lines.push(`    <description>${escapeXml(s.description || s.name)}</description>`);
      if (s.trigger) lines.push(`    <trigger>${escapeXml(s.trigger)}</trigger>`);
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
