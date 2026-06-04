'use client';

import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { LumenMark } from '@/components/ui/LumenMark';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/cn';
import {
  IconClock,
  IconFolder,
  IconHierarchy2,
  IconLayoutGrid,
  IconPlus,
  IconSelectAll,
  IconTrash,
} from '@tabler/icons-react';
import { useReactFlow } from '@xyflow/react';
import { useEffect, type ReactNode } from 'react';

interface MobileCanvasBottomToolbarProps {
  historyPanelOpen: boolean;
  materialPanelOpen: boolean;
  menuOpen: boolean;
  onToggleHistoryPanel: () => void;
  onToggleMaterialPanel: () => void;
  onToggleMenu: () => void;
  nodeMenu: ReactNode;
}

export function MobileCanvasBottomToolbar({
  historyPanelOpen,
  materialPanelOpen,
  menuOpen,
  onToggleHistoryPanel,
  onToggleMaterialPanel,
  onToggleMenu,
  nodeMenu,
}: MobileCanvasBottomToolbarProps) {
  const { t } = useI18n();

  return (
    <>
      <BottomActionBar className="!z-[35] lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label={t('canvas.toolbar.addNode')}
            onClick={onToggleMenu}
            className={cn(
              'flex min-h-11 min-w-11 items-center justify-center rounded-full shadow-[0_10px_28px_rgba(255,255,255,0.14)]',
              menuOpen ? 'bg-[#79e4ff] text-[#061016]' : 'bg-white text-[#111315]',
            )}
          >
            <IconPlus size={22} stroke={2.2} />
          </button>
          <button
            type="button"
            aria-label={t('canvas.toolbar.materials')}
            onClick={onToggleMaterialPanel}
            className={cn(
              'flex min-h-11 min-w-11 items-center justify-center rounded-2xl transition-colors',
              materialPanelOpen
                ? 'bg-white/[0.12] text-white'
                : 'text-white/64 hover:bg-white/[0.08] hover:text-white',
            )}
          >
            <IconFolder size={21} stroke={2.1} />
          </button>
          <button
            type="button"
            aria-label={t('canvas.toolbar.history')}
            onClick={onToggleHistoryPanel}
            className={cn(
              'flex min-h-11 min-w-11 items-center justify-center rounded-2xl transition-colors',
              historyPanelOpen
                ? 'bg-white/[0.12] text-white'
                : 'text-white/64 hover:bg-white/[0.08] hover:text-white',
            )}
          >
            <IconClock size={21} stroke={2.1} />
          </button>
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#24272b] ring-2 ring-white/[0.12]">
            <LumenMark size={26} />
          </div>
        </div>
      </BottomActionBar>
      {menuOpen ? <div className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[36] lg:hidden">{nodeMenu}</div> : null}
    </>
  );
}

export function MobileCanvasBottomControls({
  canArrange,
  onArrange,
  onDeleteSelected,
  onSelectAll,
  selectedElementCount,
}: {
  canArrange: boolean;
  onArrange: () => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  selectedElementCount: number;
}) {
  const { t } = useI18n();
  const reactFlow = useReactFlow();

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[32] flex justify-center px-3 lg:hidden">
      <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl bg-[#17191c]/92 p-1.5 text-white/64 ring-1 ring-white/[0.08] backdrop-blur-xl">
        <MobileControlButton
          ariaLabel={t('canvas.toolbar.fit')}
          onClick={() => reactFlow.fitView({ padding: 0.24, duration: 260 })}
          icon={<IconLayoutGrid size={17} stroke={2.1} />}
        />
        <MobileControlButton
          ariaLabel={t('canvas.toolbar.selectAll')}
          onClick={onSelectAll}
          icon={<IconSelectAll size={17} stroke={2.1} />}
        />
        <MobileControlButton
          ariaLabel={t('canvas.toolbar.arrange')}
          onClick={onArrange}
          disabled={!canArrange}
          icon={<IconHierarchy2 size={17} stroke={2.1} />}
        />
        {selectedElementCount > 0 ? (
          <MobileControlButton
            ariaLabel={t('canvas.toolbar.deleteSelected')}
            onClick={onDeleteSelected}
            icon={<IconTrash size={17} stroke={2.1} />}
            className="text-[#ff8b9b]"
          />
        ) : null}
      </div>
    </div>
  );
}

function MobileControlButton({
  ariaLabel,
  onClick,
  icon,
  disabled,
  className,
}: {
  ariaLabel: string;
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-35',
        className,
      )}
    >
      {icon}
    </button>
  );
}

/** Fit canvas viewport once when entering mobile layout. */
export function MobileCanvasFitView({ enabled }: { enabled: boolean }) {
  const reactFlow = useReactFlow();

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      reactFlow.fitView({ padding: 0.28, maxZoom: 1, duration: 0 });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [enabled, reactFlow]);

  return null;
}
