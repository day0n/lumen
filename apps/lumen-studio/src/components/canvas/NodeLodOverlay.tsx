'use client';

import type { NodeKind } from '@/lib/canvas/types';

export const nodeKindAccent: Record<NodeKind, string> = {
  text: '#d6ff9c',
  image: '#9beaff',
  video: '#e1c3ff',
  audio: '#ffd88a',
  composition: '#9beaff',
};

/**
 * 概览态（低缩放）下的节点简化视图：类型色点 + 大号标题。
 * 节点细节为 80–100% 缩放设计，整图概览时会缩得很小、标题读不清；
 * 这一层用 34px 粗体标题覆盖细节，缩到很小也能一眼看清每个节点是什么。
 */
export function NodeLodOverlay({ kind, title }: { kind: NodeKind; title: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[60] flex items-center gap-3 rounded-[13px] bg-[#1c1d1f]/96 px-5 ring-1 ring-white/[0.16]"
    >
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full"
        style={{ backgroundColor: nodeKindAccent[kind] }}
      />
      <span className="min-w-0 flex-1 truncate text-[34px] font-black leading-none text-white">
        {title}
      </span>
    </div>
  );
}
