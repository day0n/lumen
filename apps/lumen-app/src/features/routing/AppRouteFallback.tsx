import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { useAppShellChrome } from '@/lib/app-shell-chrome';
import { useLocation } from '@tanstack/react-router';

const gridCounts = {
  home: 4,
  projects: 8,
  materials: 8,
  dashboard: 6,
  hotVideos: 8,
} as const;

export function AppRouteFallback() {
  const location = useLocation();
  const appShellChrome = useAppShellChrome();
  const pathname = location.pathname;
  const kind = pathname.includes('materials')
    ? 'materials'
    : pathname.includes('dashboard')
      ? 'dashboard'
      : pathname.includes('hot-videos')
        ? 'hotVideos'
        : pathname.includes('home')
          ? 'home'
          : 'projects';
  const count = gridCounts[kind];

  const content = (
    <main className="relative z-10 mx-auto max-w-[1320px] px-4 pb-nav-mobile pt-24 sm:px-6 sm:pt-28">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <div className="lumen-skeleton h-6 w-36 rounded" />
          <div className="lumen-skeleton h-3 w-64 max-w-[70vw] rounded" />
        </div>
        <div className="lumen-skeleton h-10 w-full rounded-xl sm:ml-auto sm:w-48" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: count }).map((_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fallback placeholders are static.
            key={index}
            className="overflow-hidden rounded-xl bg-[#1a1c1d] p-2.5 ring-1 ring-white/[0.05]"
          >
            <div className="lumen-skeleton h-[116px] rounded-lg" />
            <div className="mt-2.5 space-y-2 px-0.5 pb-0.5">
              <div className="lumen-skeleton h-3 w-[62%] rounded" />
              <div className="lumen-skeleton h-2.5 w-[36%] rounded" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );

  if (appShellChrome) return content;

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />
      {content}
    </div>
  );
}
