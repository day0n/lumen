'use client';

import { cn } from '@/lib/cn';
import {
  IconBolt,
  IconChartBar,
  IconSearch,
  IconSparkles,
  IconTargetArrow,
} from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardSectionTarget } from './constants';

export interface DashboardCommand {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: 'campaign' | 'factor' | 'action' | 'nav';
  run: () => void;
}

export function useDashboardCommandPalette(openInitially = false) {
  const [open, setOpen] = useState(openInitially);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { open, setOpen };
}

function CommandIcon({ type }: { type: DashboardCommand['icon'] }) {
  if (type === 'campaign') return <IconTargetArrow size={15} stroke={2.2} />;
  if (type === 'factor') return <IconSparkles size={15} stroke={2.2} />;
  if (type === 'nav') return <IconChartBar size={15} stroke={2.2} />;
  return <IconBolt size={15} stroke={2.2} />;
}

export function DashboardCommandPalette({
  open,
  onClose,
  commands,
  title,
  placeholder,
}: {
  open: boolean;
  onClose: () => void;
  commands: DashboardCommand[];
  title: string;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    searchInputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands.slice(0, 12);
    return commands
      .filter(
        (command) =>
          command.label.toLowerCase().includes(normalized) ||
          command.hint?.toLowerCase().includes(normalized) ||
          command.group.toLowerCase().includes(normalized),
      )
      .slice(0, 12);
  }, [commands, query]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.dialog
            open
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="m-0 w-full max-w-xl overflow-hidden rounded-2xl border-0 bg-[#121416]/96 p-0 text-left ring-1 ring-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
              <IconSearch size={16} className="text-white/38" stroke={2.2} />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/32"
              />
              <kbd className="hidden rounded-md bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/38 sm:inline">
                Esc
              </kbd>
            </div>
            <div className="max-h-[min(420px,50vh)] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="px-3 py-8 text-center text-[13px] text-white/36">{placeholder}</div>
              ) : (
                filtered.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    onClick={() => {
                      command.run();
                      onClose();
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]',
                    )}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05] text-[#79e4ff] ring-1 ring-white/[0.06]">
                      <CommandIcon type={command.icon} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-white/86">
                        {command.label}
                      </span>
                      {command.hint ? (
                        <span className="mt-0.5 block truncate text-[11px] text-white/36">
                          {command.hint}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-white/24">
                      {command.group}
                    </span>
                  </button>
                ))
              )}
            </div>
          </motion.dialog>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export type { DashboardSectionTarget };
