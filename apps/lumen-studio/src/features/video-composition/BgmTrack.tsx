'use client';

export function BgmTrack({ bgmUrl, volume }: { bgmUrl: string | null; volume: number }) {
  if (!bgmUrl) {
    return (
      <div className="mx-3 mb-2 rounded-[8px] border border-dashed border-white/[0.1] px-3 py-2 text-[11px] text-white/34">
        No BGM — connect an audio node
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 flex h-10 items-center gap-2 rounded-[8px] bg-[#2a2418] px-3 ring-1 ring-[#f5c76a]/18">
      <span className="text-[11px] font-bold text-[#ffd88a]">BGM</span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-white/48">{bgmUrl}</span>
      <span className="text-[10px] text-white/42">{Math.round(volume * 100)}%</span>
    </div>
  );
}
