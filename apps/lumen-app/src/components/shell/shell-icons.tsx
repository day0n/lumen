import type { ReactNode } from 'react';

type ShellIconProps = {
  className?: string;
  size?: number;
  stroke?: number;
};

function ShellIcon({
  children,
  className,
  size = 24,
  stroke = 2,
}: ShellIconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      focusable="false"
      height={size}
      role="presentation"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={stroke}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: ShellIconProps) {
  return (
    <ShellIcon {...props}>
      <path d="M5 12H3l9-9 9 9h-2" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      <path d="M9 21v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6" />
    </ShellIcon>
  );
}

export function FolderIcon(props: ShellIconProps) {
  return (
    <ShellIcon {...props}>
      <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" />
    </ShellIcon>
  );
}

export function PhotoIcon(props: ShellIconProps) {
  return (
    <ShellIcon {...props}>
      <path d="M15 8h.01" />
      <path d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6" />
      <path d="m3 16 5-5c.928-.893 2.072-.893 3 0l5 5" />
      <path d="m14 14 1-1c.928-.893 2.072-.893 3 0l3 3" />
    </ShellIcon>
  );
}

export function DeviceTvIcon(props: ShellIconProps) {
  return (
    <ShellIcon {...props}>
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9" />
      <path d="m16 3-4 4-4-4" />
    </ShellIcon>
  );
}

export function WorldIcon(props: ShellIconProps) {
  return (
    <ShellIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18" />
    </ShellIcon>
  );
}

export function ChevronDownIcon(props: ShellIconProps) {
  return (
    <ShellIcon {...props}>
      <path d="m6 9 6 6 6-6" />
    </ShellIcon>
  );
}
