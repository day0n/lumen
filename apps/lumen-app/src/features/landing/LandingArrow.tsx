export function LandingArrow({ size = 16, stroke = 2.4 }: { size?: number; stroke?: number }) {
  return (
    <svg
      aria-hidden
      fill="none"
      focusable="false"
      height={size}
      role="presentation"
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={stroke}
      />
    </svg>
  );
}
