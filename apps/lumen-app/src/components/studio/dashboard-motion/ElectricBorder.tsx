'use client';

import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef } from 'react';

function hexToRgba(hex: string, alpha = 1): string {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const int = Number.parseInt(h, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface ElectricBorderProps {
  children?: ReactNode;
  color?: string;
  speed?: number;
  chaos?: number;
  borderRadius?: number;
  className?: string;
  style?: CSSProperties;
}

export function ElectricBorder({
  children,
  color = '#79e4ff',
  speed = 0.9,
  chaos = 0.1,
  borderRadius = 16,
  className,
  style,
}: ElectricBorderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  const random = useCallback((x: number): number => (Math.sin(x * 12.9898) * 43758.5453) % 1, []);

  const noise2D = useCallback(
    (x: number, y: number): number => {
      const i = Math.floor(x);
      const j = Math.floor(y);
      const fx = x - i;
      const fy = y - j;
      const a = random(i + j * 57);
      const b = random(i + 1 + j * 57);
      const c = random(i + (j + 1) * 57);
      const d = random(i + 1 + (j + 1) * 57);
      const ux = fx * fx * (3.0 - 2.0 * fx);
      const uy = fy * fy * (3.0 - 2.0 * fy);
      return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
    },
    [random],
  );

  const octavedNoise = useCallback(
    (
      x: number,
      octaves: number,
      lacunarity: number,
      gain: number,
      baseAmplitude: number,
      baseFrequency: number,
      time: number,
      seed: number,
      baseFlatness: number,
    ): number => {
      let y = 0;
      let amplitude = baseAmplitude;
      let frequency = baseFrequency;
      for (let i = 0; i < octaves; i++) {
        let octaveAmplitude = amplitude;
        if (i === 0) octaveAmplitude *= baseFlatness;
        y += octaveAmplitude * noise2D(frequency * x + seed * 100, time * frequency * 0.3);
        frequency *= lacunarity;
        amplitude *= gain;
      }
      return y;
    },
    [noise2D],
  );

  const getCornerPoint = useCallback(
    (
      centerX: number,
      centerY: number,
      radius: number,
      startAngle: number,
      arcLength: number,
      progress: number,
    ) => {
      const angle = startAngle + progress * arcLength;
      return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
    },
    [],
  );

  const getRoundedRectPoint = useCallback(
    (t: number, left: number, top: number, width: number, height: number, radius: number) => {
      const straightWidth = width - 2 * radius;
      const straightHeight = height - 2 * radius;
      const cornerArc = (Math.PI * radius) / 2;
      const totalPerimeter = 2 * straightWidth + 2 * straightHeight + 4 * cornerArc;
      const distance = t * totalPerimeter;
      let accumulated = 0;

      const segment = (
        segWidth: number,
        pointAt: (progress: number) => { x: number; y: number },
      ) => {
        if (distance <= accumulated + segWidth) {
          return pointAt((distance - accumulated) / segWidth);
        }
        accumulated += segWidth;
        return null;
      };

      return (
        segment(straightWidth, (p) => ({ x: left + radius + p * straightWidth, y: top })) ??
        segment(cornerArc, (p) =>
          getCornerPoint(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2, p),
        ) ??
        segment(straightHeight, (p) => ({
          x: left + width,
          y: top + radius + p * straightHeight,
        })) ??
        segment(cornerArc, (p) =>
          getCornerPoint(left + width - radius, top + height - radius, radius, 0, Math.PI / 2, p),
        ) ??
        segment(straightWidth, (p) => ({
          x: left + width - radius - p * straightWidth,
          y: top + height,
        })) ??
        segment(cornerArc, (p) =>
          getCornerPoint(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI / 2, p),
        ) ??
        segment(straightHeight, (p) => ({
          x: left,
          y: top + height - radius - p * straightHeight,
        })) ??
        getCornerPoint(
          left + radius,
          top + radius,
          radius,
          Math.PI,
          Math.PI / 2,
          (distance - accumulated) / cornerArc,
        )
      );
    },
    [getCornerPoint],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const borderOffset = 48;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = rect.width + borderOffset * 2;
      const height = rect.height + borderOffset * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width, height };
    };

    let { width, height } = updateSize();
    lastFrameTimeRef.current = performance.now();

    const draw = (currentTime: number) => {
      if (!canvas || !ctx) return;
      const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000;
      timeRef.current += deltaTime * speed;
      lastFrameTimeRef.current = currentTime;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const left = borderOffset;
      const top = borderOffset;
      const borderWidth = width - 2 * borderOffset;
      const borderHeight = height - 2 * borderOffset;
      const maxRadius = Math.min(borderWidth, borderHeight) / 2;
      const radius = Math.min(borderRadius, maxRadius);
      const sampleCount = Math.floor((2 * (borderWidth + borderHeight) + 2 * Math.PI * radius) / 2);

      ctx.beginPath();
      for (let i = 0; i <= sampleCount; i++) {
        const progress = i / sampleCount;
        const point = getRoundedRectPoint(progress, left, top, borderWidth, borderHeight, radius);
        const xNoise = octavedNoise(progress * 8, 10, 1.6, 0.7, chaos, 10, timeRef.current, 0, 0);
        const yNoise = octavedNoise(progress * 8, 10, 1.6, 0.7, chaos, 10, timeRef.current, 1, 0);
        const x = point.x + xNoise * 42;
        const y = point.y + yNoise * 42;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      animationRef.current = requestAnimationFrame(draw);
    };

    const resizeObserver = new ResizeObserver(() => {
      ({ width, height } = updateSize());
    });
    resizeObserver.observe(container);
    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      resizeObserver.disconnect();
    };
  }, [borderRadius, chaos, color, getRoundedRectPoint, octavedNoise, speed]);

  return (
    <div
      ref={containerRef}
      className={`relative isolate overflow-visible ${className ?? ''}`}
      style={{ borderRadius, ...style }}
    >
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2">
        <canvas ref={canvasRef} className="block" />
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]">
        <div
          className="absolute inset-0 rounded-[inherit]"
          style={{ border: `1px solid ${hexToRgba(color, 0.55)}`, filter: 'blur(1px)' }}
        />
        <div
          className="absolute inset-0 -z-[1] scale-110 rounded-[inherit] opacity-25"
          style={{
            filter: 'blur(28px)',
            background: `linear-gradient(-30deg, ${color}, transparent, ${color})`,
          }}
        />
      </div>
      <div className="relative z-[1] rounded-[inherit]">{children}</div>
    </div>
  );
}
