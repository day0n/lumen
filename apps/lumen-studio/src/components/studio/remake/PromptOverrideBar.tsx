'use client';

import { IconCheck, IconLoader2, IconPencil, IconRotate, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * Prompt 覆盖编辑入口。
 *
 * 设计目标：
 * - 折叠态是一行紧凑的"prompt 第一行"，挂在每个产物卡片下方，不抢视觉重点。
 * - 点击展开为右侧 Drawer，里面是完整 textarea + 自动生成预览 + 保存/重置。
 * - 一个组件覆盖所有 6 类 prompt 入口（creator/product/env-N/scene-image-N/scene-video-N/bgm）。
 *
 * 显式区分两个 prompt 概念：
 *  - `effectivePrompt` —— 当前真正会喂给模型的 prompt（生效值），用于折叠态预览。
 *      lock/bgm：=override ?? plan 里 LLM 生成的字段 ?? fallback
 *      scene-image：lock 跑前未知（=null），跑后才能由 promptGenerators 算出
 *      scene-video：storyboard 跑前未知（=null），跑后才能算
 *  - `overrideValue` —— 用户在 plan 上显式写过的覆盖；undefined 表示从未覆盖（"Auto"）。
 *      只有 overrideValue 才是这个组件保存/重置的对象，effectivePrompt 只是用于预览。
 */

export interface PromptOverrideCopy {
  /** 折叠条 label，例如 "Prompt"。 */
  label: string;
  /** 折叠条上的"自定义已生效"小标签。 */
  overrideBadge: string;
  /** 折叠条上的"自动生成"小标签。 */
  autoBadge: string;
  /** 折叠条上没有可预览 prompt 时的占位文字。 */
  emptyHint: string;
  /** Drawer 标题。 */
  title: string;
  /** Drawer 副标题 / 用途说明。 */
  subtitle?: string;
  /** textarea placeholder。 */
  placeholder: string;
  /** Drawer 底部提示。 */
  hint: string;
  /** 折叠区标题："当前自动生成内容预览"。 */
  effectiveLabel: string;
  /** effectivePrompt 为 null 时折叠区文案。 */
  effectivePlaceholder: string;
  /** 保存按钮。 */
  save: string;
  /** 取消按钮。 */
  cancel: string;
  /** 重置为自动按钮。 */
  reset: string;
  /** 保存时的 loading 文案。 */
  saving: string;
  /** 当组件被禁用（stage running）时的 hover tooltip。 */
  disabledTooltip: string;
}

export interface PromptOverrideBarProps {
  /** 当前真实生效 prompt（用于折叠态预览 + Drawer 内"自动版预览"）。 */
  effectivePrompt: string | null;
  /** 用户在 plan 上已经设置的覆盖。undefined = 未覆盖。 */
  overrideValue: string | undefined;
  /** stage running / locked 时禁用编辑。 */
  disabled?: boolean;
  /**
   * 保存。传 null = 用户点了"重置为自动"；传字符串 = 写入覆盖。
   * 返回 Promise，组件在 Promise 解决前显示 loading。
   */
  onSave: (value: string | null) => Promise<void>;
  copy: PromptOverrideCopy;
  className?: string;
}

export function PromptOverrideBar(props: PromptOverrideBarProps) {
  const { effectivePrompt, overrideValue, disabled, copy, className, onSave } = props;
  const [open, setOpen] = useState(false);

  const hasOverride = typeof overrideValue === 'string' && overrideValue.trim().length > 0;
  const firstLine = pickFirstLine(hasOverride ? overrideValue : effectivePrompt) || copy.emptyHint;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? copy.disabledTooltip : undefined}
        className={cn(
          'group/prompt-bar mt-2 flex h-8 w-full items-center gap-2 rounded-[12px] bg-white/[0.045] px-2.5 text-left ring-1 ring-white/[0.06] transition-colors',
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'hover:bg-white/[0.08] hover:ring-white/[0.12]',
          className,
        )}
      >
        <IconPencil
          size={12}
          stroke={2.2}
          className={cn(
            'shrink-0',
            hasOverride ? 'text-[#79e4ff]' : 'text-white/40',
            !disabled && 'group-hover/prompt-bar:text-white/72',
          )}
        />
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 text-[10px] font-bold uppercase tracking-wide',
            hasOverride
              ? 'bg-[#79e4ff]/14 text-[#79e4ff] ring-1 ring-[#79e4ff]/22'
              : 'bg-white/[0.06] text-white/40 ring-1 ring-white/[0.06]',
          )}
        >
          {hasOverride ? copy.overrideBadge : copy.autoBadge}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-white/68">
          {firstLine}
        </span>
        <span
          aria-hidden
          className={cn(
            'shrink-0 text-[11px] font-bold',
            disabled ? 'text-white/24' : 'text-white/40 group-hover/prompt-bar:text-white/72',
          )}
        >
          ›
        </span>
      </button>

      {open ? (
        <PromptOverrideDrawer
          {...props}
          hasOverride={hasOverride}
          firstLine={firstLine}
          onClose={() => setOpen(false)}
          onSave={async (value) => {
            await onSave(value);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

interface DrawerProps extends PromptOverrideBarProps {
  hasOverride: boolean;
  firstLine: string;
  onClose: () => void;
}

function PromptOverrideDrawer(props: DrawerProps) {
  const { copy, effectivePrompt, overrideValue, hasOverride, onClose, onSave } = props;

  const [value, setValue] = useState<string>(
    overrideValue !== undefined ? overrideValue : (effectivePrompt ?? ''),
  );
  const [saving, setSaving] = useState(false);
  const [effectiveExpanded, setEffectiveExpanded] = useState(false);

  // ESC 关闭
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose, saving]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const trimmed = value.trim();
    setSaving(true);
    try {
      // 用户清空 textarea 视作"重置为自动"
      await onSave(trimmed.length === 0 ? null : trimmed);
    } finally {
      setSaving(false);
    }
  }, [onSave, saving, value]);

  const handleReset = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(null);
    } finally {
      setSaving(false);
    }
  }, [onSave, saving]);

  const canReset = hasOverride;
  const hasUnsaved =
    value.trim() !== (overrideValue?.trim() ?? '') && !(value.trim() === '' && !hasOverride);

  return (
    <dialog
      open
      aria-modal="true"
      aria-label={copy.title}
      className="fixed inset-0 z-[60] m-0 flex h-full max-h-none w-full max-w-none border-0 bg-transparent p-0"
    >
      <button
        type="button"
        className="flex-1 cursor-default bg-black/56 backdrop-blur-sm"
        onClick={() => {
          if (!saving) onClose();
        }}
        aria-label={copy.cancel}
      />
      <aside className="flex h-full w-[clamp(360px,38vw,520px)] flex-col bg-[#15171a] shadow-[0_0_60px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08]">
        <header className="flex items-start gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-white">{copy.title}</div>
            {copy.subtitle ? (
              <div className="mt-0.5 truncate text-[12px] text-white/52">{copy.subtitle}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/52 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={copy.cancel}
          >
            <IconX size={16} stroke={2.2} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-white/40">
              {copy.label}
            </span>
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={copy.placeholder}
              disabled={saving}
              className="min-h-[260px] w-full resize-vertical rounded-[14px] bg-white/[0.045] px-4 py-3 font-mono text-[12px] leading-5 text-white outline-none ring-1 ring-white/[0.08] transition-colors focus:ring-[#79e4ff]/35 disabled:opacity-50"
            />
          </label>

          <details
            className="group/effective rounded-[14px] bg-white/[0.035] ring-1 ring-white/[0.06]"
            open={effectiveExpanded}
            onToggle={(event) => setEffectiveExpanded((event.target as HTMLDetailsElement).open)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-white/52 hover:text-white/72">
              <span>{copy.effectiveLabel}</span>
              <span className="text-white/36 transition-transform group-open/effective:rotate-180">
                ▾
              </span>
            </summary>
            <div className="border-t border-white/[0.06] px-4 py-3">
              {effectivePrompt ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-white/62">
                  {effectivePrompt}
                </pre>
              ) : (
                <div className="text-[12px] leading-5 text-white/40">
                  {copy.effectivePlaceholder}
                </div>
              )}
            </div>
          </details>

          <div className="rounded-[14px] bg-[#79e4ff]/8 px-3 py-2.5 text-[11px] leading-5 text-white/64 ring-1 ring-[#79e4ff]/14">
            {copy.hint}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={!canReset || saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-transparent px-3 text-[12px] font-bold text-white/56 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <IconRotate size={13} stroke={2.4} />
            {copy.reset}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-white/[0.06] px-4 text-[12px] font-bold text-white/72 transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasUnsaved}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-[12px] font-bold text-[#111315] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-white/38"
          >
            {saving ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : (
              <IconCheck size={13} stroke={2.6} />
            )}
            {saving ? copy.saving : copy.save}
          </button>
        </footer>
      </aside>
    </dialog>
  );
}

function pickFirstLine(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  for (const line of trimmed.split(/\r?\n/)) {
    const segment = line.trim();
    if (segment) return segment;
  }
  return trimmed;
}
