import { LandingMark } from './LandingMark';
import { cx } from './landing-classes';

export function LumenWordmark({
  className,
  markClassName,
  markSize = 26,
  wordClassName,
}: {
  className?: string;
  markClassName?: string;
  markSize?: number;
  wordClassName?: string;
}) {
  return (
    <span className={cx('inline-flex items-center gap-3', className)}>
      <LandingMark className={markClassName} size={markSize} />
      <span className={cx('lumen-wordmark leading-none text-white', wordClassName)}>Lumen</span>
    </span>
  );
}
