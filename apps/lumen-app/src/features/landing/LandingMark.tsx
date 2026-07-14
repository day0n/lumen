import { cx } from './landing-classes';

export function LandingMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cx(
        'relative shrink-0 transition-transform duration-200 ease-out hover:rotate-6 hover:scale-[1.06] motion-reduce:transform-none motion-reduce:transition-none',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 rounded-[28%]"
        style={{
          background: 'radial-gradient(circle at 35% 30%, #f5c76a, #79e4ff 58%, #5067ff)',
          boxShadow:
            '0 8px 24px -4px rgba(121,228,255,0.42), 0 0 0 1px rgba(255,255,255,0.12) inset',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          left: '22%',
          top: '18%',
          width: '38%',
          height: '38%',
          background:
            'radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.2) 50%, transparent 70%)',
          filter: 'blur(2px)',
        }}
      />
      <div
        className="absolute inset-x-[14%] top-[8%] h-[3px] rounded-full"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)',
        }}
      />
    </div>
  );
}
