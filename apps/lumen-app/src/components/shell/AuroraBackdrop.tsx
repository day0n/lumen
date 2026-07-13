'use client';

export function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#0f1012]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#141619_0%,#0f1012_42%,#090a0b_100%)]" />
      <div className="absolute inset-x-0 top-0 h-[360px] bg-[linear-gradient(180deg,rgba(218,246,255,0.08),transparent)]" />
      <div
        className="absolute inset-0 opacity-[0.055]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_52%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}
