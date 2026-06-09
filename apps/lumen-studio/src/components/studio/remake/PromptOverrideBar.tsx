'use client';

import { IconCheck, IconLoader2, IconPencil, IconRotate, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * Prompt 覆盖编辑入口。
 *
 * 设计目标：
 * - 只渲染一个 24x24 的小铅笔按钮，挂在产物卡片 subtitle 区域右下角（外部用 slot 安排位置）。
 * - 用户已自定义过 prompt 时，铅笔右上角浮一个青色小圆点指示；未自定义时纯灰色铅笔。
 * - 点击展开为右侧 Drawer，里面是完整 textarea + 保存/取消/恢复自动。
 * - 一个组件覆盖所有 6 类 prompt 入口（creator/product/env-N/scene-image-N/scene-video-N/bgm）。
 *
 * 显式区分两个 prompt 概念：
 *  - `effectivePrompt` —— 当前真正会喂给模型的 prompt（生效值），打开 Drawer 时作为 textarea
 *      默认值，让用户基于此修改而不是从空白开始。
 *      lock/bgm：=override ?? task 上次实际用过的 inputPrompt ?? null
 *      scene-image/scene-video：=override ?? task.inputPrompt ?? null
 *  - `overrideValue` —— 用户在 plan 上显式写过的覆盖；undefined 表示从未覆盖。
 *      只有 overrideValue 才是这个组件保存/重置的对象。
 */

export interface PromptOverrideCopy {
  /** Drawer 内 textarea 上方的小标签，例如 "Prompt"。 */
  label: string;
  /** Drawer 标题。 */
  title: string;
  /** Drawer 副标题 / 用途说明。 */
  subtitle?: string;
  /** textarea placeholder。 */
  placeholder: string;
  /** Drawer 底部提示。 */
  hint: string;
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
  /** 正常情况下铅笔按钮的 hover tooltip / aria-label。 */
  editTooltip: string;
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
  const { overrideValue, disabled, copy, className, onSave } = props;
  const [open, setOpen] = useState(false);

  const hasOverride = typeof overrideValue === 'string' && overrideValue.trim().length > 0;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? copy.disabledTooltip : copy.editTooltip}
        aria-label={copy.editTooltip}
        className={cn(
          'relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/[0.08] transition-colors',
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'hover:bg-white/[0.12] hover:ring-white/[0.18]',
          className,
        )}
      >
        <IconPencil
          size={13}
          stroke={2.2}
          className={hasOverride ? 'text-[#79e4ff]' : 'text-white/64'}
        />
        {hasOverride ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#79e4ff] ring-2 ring-[#15171a]"
            aria-hidden
          />
        ) : null}
      </button>

      {open ? (
        <PromptOverrideDrawer
          {...props}
          hasOverride={hasOverride}
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
  onClose: () => void;
}

function PromptOverrideDrawer(props: DrawerProps) {
  const { copy, effectivePrompt, overrideValue, hasOverride, onClose, onSave } = props;

  // textarea 默认值 = 真实生效 prompt（如果存在）。优先级：
  //   1. 用户已经写过的 override（hasOverride）
  //   2. 上一次实际跑该 task 时用的 prompt（effectivePrompt 由父组件解析）
  //   3. 都没有时才空着，但会被下面的 effect 在拿到真值后自动回填
  // 这样用户打开 Drawer 就能看到完整 prompt，基于它改而不是从空白开始写。
  const initialValue = hasOverride ? (overrideValue ?? '') : (effectivePrompt ?? '');
  const [value, setValue] = useState<string>(initialValue);
  const [saving, setSaving] = useState(false);

  // 打开 Drawer 后如果 task 还在 queued/running，effectivePrompt 可能为 null；等任务
  // 进入 running 后 inputPrompt 才会被 fetch 拉回来。用 ref 标记用户是否亲手改过 textarea；
  // 没改过且新数据到达时自动覆盖，让用户不必关掉重开。
  const userTouchedRef = useRef(false);
  useEffect(() => {
    if (userTouchedRef.current) return;
    const next = hasOverride ? (overrideValue ?? '') : (effectivePrompt ?? '');
    setValue((current) => (current === next ? current : next));
  }, [hasOverride, overrideValue, effectivePrompt]);

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
  // 用户改动 vs 当时打开 Drawer 的初始值
  const hasUnsaved = value.trim() !== initialValue.trim();

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
          <label className="flex min-h-0 flex-1 flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-white/40">
              {copy.label}
            </span>
            <textarea
              value={value}
              onChange={(event) => {
                userTouchedRef.current = true;
                setValue(event.target.value);
              }}
              placeholder={copy.placeholder}
              disabled={saving}
              className="min-h-[320px] w-full flex-1 resize-vertical rounded-[14px] bg-white/[0.045] px-4 py-3 font-mono text-[12px] leading-5 text-white outline-none ring-1 ring-white/[0.08] transition-colors focus:ring-[#79e4ff]/35 disabled:opacity-50"
            />
          </label>

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
