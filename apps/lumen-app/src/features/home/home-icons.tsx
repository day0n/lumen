import type { ReactNode } from 'react';

type HomeIconProps = {
  className?: string;
  size?: number;
  stroke?: number;
};

function HomeIcon({
  children,
  className,
  size = 24,
  stroke = 2,
}: HomeIconProps & { children: ReactNode }) {
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

export function ArrowUpRightIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M17 7 7 17" />
      <path d="M8 7h9v9" />
    </HomeIcon>
  );
}

export function ChevronLeftIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="m15 6-6 6 6 6" />
    </HomeIcon>
  );
}

export function ChevronRightIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="m9 6 6 6-6 6" />
    </HomeIcon>
  );
}

export function ArrowUpIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M12 19V5" />
      <path d="m18 11-6-6-6 6" />
    </HomeIcon>
  );
}

export function PhotoIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M15 8h.01" />
      <path d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6" />
      <path d="m3 16 5-5c.928-.893 2.072-.893 3 0l5 5" />
      <path d="m14 14 1-1c.928-.893 2.072-.893 3 0l3 3" />
    </HomeIcon>
  );
}

export function PhotoPlusIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M15 8h.01" />
      <path d="M12.5 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6.5" />
      <path d="m3 16 5-5c.928-.893 2.072-.893 3 0l4 4" />
      <path d="m14 14 1-1c.67-.644 1.45-.824 2.182-.54" />
      <path d="M16 19h6M19 16v6" />
    </HomeIcon>
  );
}

export function PlusIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M12 5v14M5 12h14" />
    </HomeIcon>
  );
}

export function SparklesIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M16 18a2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1-2-2 2 2 0 0 1-2 2m0-12a2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1-2-2 2 2 0 0 1-2 2M9 18a6 6 0 0 1 6-6 6 6 0 0 1-6-6 6 6 0 0 1-6 6 6 6 0 0 1 6 6" />
    </HomeIcon>
  );
}

export function XIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </HomeIcon>
  );
}

export function ArrowRightIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M5 12h14" />
      <path d="m13 18 6-6-6-6" />
    </HomeIcon>
  );
}

export function LoaderIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </HomeIcon>
  );
}

export function PlayerPlayIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M7 4v16l13-8z" />
    </HomeIcon>
  );
}

export function SearchIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6" />
    </HomeIcon>
  );
}

export function MicrophoneIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V5" />
      <path d="M5 10a7 7 0 0 0 14 0M8 21h8M12 17v4" />
    </HomeIcon>
  );
}

export function MicrophoneOffIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="m3 3 18 18" />
      <path d="M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1-.13.874m-2 2A3 3 0 0 1 9 10.002V9" />
      <path d="M5 10a7 7 0 0 0 10.846 5.85m2-2A6.967 6.967 0 0 0 19.998 10M8 21h8M12 17v4" />
    </HomeIcon>
  );
}

export function TrashIcon(props: HomeIconProps) {
  return (
    <HomeIcon {...props}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="m5 7 1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </HomeIcon>
  );
}
