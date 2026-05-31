'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type SceneKey = 'creator' | 'platform' | 'generate' | 'finish';

interface StoryScene {
  key: SceneKey;
  kicker: string;
  side: 'left' | 'right';
  text: string;
}

interface Particle {
  phase: number;
  seed: number;
  shade: number;
  size: number;
}

interface Point {
  motion: number;
  sparkle: number;
  weight: number;
  x: number;
  y: number;
  z: number;
}

interface MaskSample {
  darkness: number;
  x: number;
  y: number;
}

type ShapeSpec =
  | {
      cx: number;
      cy: number;
      density?: number;
      depth: number;
      kind: 'ellipse';
      rx: number;
      ry: number;
      seed: number;
      weight: number;
    }
  | {
      angle?: number;
      cx: number;
      cy: number;
      depth: number;
      height: number;
      kind: 'rect';
      seed: number;
      weight: number;
      width: number;
    }
  | {
      depth: number;
      kind: 'capsule';
      seed: number;
      thickness: number;
      weight: number;
      x1: number;
      x2: number;
      y1: number;
      y2: number;
    }
  | {
      cx: number;
      cy: number;
      depth: number;
      height: number;
      kind: 'dust';
      seed: number;
      weight: number;
      width: number;
    };

const CREATOR_MASK_SRC = '/particle-masks/creator-typing-mask.jpg';

const STORY_SCENES: StoryScene[] = [
  {
    key: 'creator',
    kicker: '在 Lumen 平台创作',
    side: 'right',
    text: '一个人坐在电脑前，把商品素材整理成可以生成的视频。',
  },
  {
    key: 'platform',
    kicker: '交给平台',
    side: 'left',
    text: '脚本、镜头、素材和节奏，被放进同一个创作工作台。',
  },
  {
    key: 'generate',
    kicker: '一键生成',
    side: 'right',
    text: '图文和视频画面开始成形，流程继续留给你编辑。',
  },
  {
    key: 'finish',
    kicker: '轻松创作',
    side: 'left',
    text: '重复的制作被平台接住，人只需要判断和调整。',
  },
];

export function HomeParticleStory() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [phase, setPhase] = useState({ local: 0, scene: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    if (!canvas || !section) return;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let raf = 0;
    let lastStateUpdate = 0;
    let particles: Particle[] = [];
    let targets: Point[][] = [];
    let maskSamples: MaskSample[] = [];
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let disposed = false;

    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const image = new Image();

    const updateReducedMotion = () => {
      reducedMotion = reduceQuery.matches;
    };

    const rebuild = () => {
      const count = particleTarget(width);
      particles = Array.from({ length: count }, (_, index) => ({
        phase: seeded(index + 19) * Math.PI * 2,
        seed: seeded(index + 29),
        shade: seeded(index + 37),
        size: width < 640 ? 0.58 + seeded(index + 41) * 0.64 : 0.64 + seeded(index + 41) * 0.92,
      }));

      targets = [
        maskSamples.length
          ? buildMaskTarget(count, maskSamples, 1000)
          : buildShapeTarget(count, creatorFallbackShapes, 1000),
        buildShapeTarget(count, platformShapes, 2000),
        buildShapeTarget(count, generateShapes, 3000),
        buildShapeTarget(count, finishShapes, 4000),
      ];
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuild();
    };

    const updateProgress = () => {
      const rect = section.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      progressRef.current = clamp(-rect.top / total, 0, 1);
    };

    const updatePointer = (event: globalThis.MouseEvent) => {
      pointerRef.current = {
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2,
      };
    };

    const draw = (time: number) => {
      updateProgress();

      const progress = progressRef.current;
      const scaled = progress * (STORY_SCENES.length - 1);
      const scene = Math.min(STORY_SCENES.length - 1, Math.floor(scaled));
      const nextScene = Math.min(STORY_SCENES.length - 1, scene + 1);
      const local = scaled - scene;
      const morph = smoothstep(0.62, 1, local);
      const now = performance.now();

      if (now - lastStateUpdate > 70) {
        lastStateUpdate = now;
        setPhase({ local, scene });
      }

      context.clearRect(0, 0, width, height);

      const scale = width < 700 ? Math.min(width, height) * 1.08 : Math.min(width, height) * 1.12;
      const sceneShift = scene === 0 ? -0.08 : 0;
      const offsetX =
        width * (width < 700 ? 0.5 : 0.43 + sceneShift * (1 - morph)) +
        pointerRef.current.x * (width < 700 ? 4 : 10);
      const offsetY =
        height * (width < 700 ? 0.56 : 0.54) + pointerRef.current.y * (width < 700 ? 3 : 8);
      const from = targets[scene] ?? targets[0] ?? [];
      const to = targets[nextScene] ?? from;

      context.save();
      context.translate(offsetX, offsetY);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const a = from[index];
        const b = to[index] ?? a;
        if (!particle || !a || !b) continue;

        let x = a.x + (b.x - a.x) * morph;
        let y = a.y + (b.y - a.y) * morph;
        const z = a.z + (b.z - a.z) * morph;
        const weight = a.weight + (b.weight - a.weight) * morph;

        if (!reducedMotion) {
          const slowDrift = Math.sin(time * 0.00034 + particle.phase) * 0.004;
          const sideDrift = Math.cos(time * 0.00027 + particle.phase * 1.37) * 0.003;
          x += sideDrift * (0.4 + z);
          y += slowDrift * (0.35 + z);

          if (scene === 0 && a.motion > 0.02) {
            const tap = Math.sin(time * 0.013 + particle.phase * 2.2);
            const rebound = Math.max(0, tap);
            x += a.motion * tap * 0.021;
            y -= a.motion * rebound * 0.018;
          }
        }

        const sparkle =
          !reducedMotion && scene === 0 && a.sparkle > 0.02
            ? smoothstep(0.72, 1, Math.sin(time * 0.007 + particle.phase) * 0.5 + 0.5) * a.sparkle
            : 0;
        const dotSize = particle.size * (0.54 + z * 0.88 + sparkle * 0.52);
        const alpha = clamp(0.16 + weight * 0.66 + z * 0.18 + sparkle * 0.2, 0.08, 0.9);
        const shade = Math.round(10 + particle.shade * 42 + sparkle * 18);

        context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${alpha})`;
        context.fillRect(x * scale, y * scale, dotSize, dotSize);
      }

      context.restore();
      raf = window.requestAnimationFrame(draw);
    };

    image.onload = () => {
      if (disposed) return;
      maskSamples = buildMaskSamples(image);
      resize();
    };
    image.onerror = () => {
      if (disposed) return;
      resize();
    };
    image.src = CREATOR_MASK_SRC;

    resize();
    updateProgress();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('mousemove', updatePointer, { passive: true });
    reduceQuery.addEventListener('change', updateReducedMotion);
    raf = window.requestAnimationFrame(draw);

    return () => {
      disposed = true;
      image.onload = null;
      image.onerror = null;
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('mousemove', updatePointer);
      reduceQuery.removeEventListener('change', updateReducedMotion);
    };
  }, []);

  const activeScene = STORY_SCENES[phase.scene] ?? STORY_SCENES[0]!;

  return (
    <section
      ref={sectionRef}
      aria-label="Lumen 平台创作粒子演示"
      className="relative left-1/2 mt-20 ml-[-50vw] h-[620svh] w-screen bg-[#f7f4ef] text-[#111315]"
    >
      <div className="sticky top-20 isolate h-[calc(100svh-5rem)] overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[#f7f4ef]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-28 bg-[linear-gradient(180deg,#f7f4ef_0%,rgba(247,244,239,0)_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-28 bg-[linear-gradient(180deg,rgba(247,244,239,0)_0%,#f7f4ef_100%)]"
        />

        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        />

        <div className="absolute inset-x-0 top-[12%] z-20 px-6 md:top-1/2 md:-translate-y-1/2 md:px-16 lg:px-[120px]">
          <div
            className={
              activeScene.side === 'left'
                ? 'mx-auto max-w-[390px] text-center md:mx-0 md:mr-auto md:text-left'
                : 'mx-auto max-w-[390px] text-center md:ml-auto md:mr-0 md:text-left'
            }
          >
            <div className="mb-3 text-[11px] font-semibold tracking-[0.22em] text-black/45">
              {activeScene.kicker}
            </div>
            <p className="lumen-serif-display text-[24px] font-black leading-[1.15] tracking-normal text-[#191919] md:text-[35px] lg:text-[42px]">
              <RevealText text={activeScene.text} reveal={clamp(phase.local * 1.18 + 0.24, 0, 1)} />
            </p>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 gap-2">
          {STORY_SCENES.map((scene, index) => (
            <span
              key={scene.key}
              className={
                index === phase.scene
                  ? 'h-1.5 w-10 rounded-full bg-black/58'
                  : 'h-1.5 w-4 rounded-full bg-black/14'
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function RevealText({ reveal, text }: { reveal: number; text: string }) {
  const chars = useMemo(() => Array.from(text), [text]);

  return (
    <>
      {chars.map((char, index) => {
        const start = index / Math.max(1, chars.length - 1);
        const opacity = 0.12 + smoothstep(start - 0.08, start + 0.18, reveal) * 0.88;
        return (
          <span key={`${char}-${start}`} style={{ opacity }}>
            {char}
          </span>
        );
      })}
    </>
  );
}

function particleTarget(width: number) {
  if (width < 640) return 14000;
  if (width < 1024) return 24000;
  return 42000;
}

function buildMaskSamples(image: HTMLImageElement): MaskSample[] {
  const canvas = document.createElement('canvas');
  const width = 1280;
  const height = 720;
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return [];

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  const imageAspect = image.naturalWidth / Math.max(1, image.naturalHeight);
  const canvasAspect = width / height;
  const drawHeight = imageAspect > canvasAspect ? height : width / imageAspect;
  const drawWidth = imageAspect > canvasAspect ? height * imageAspect : width;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  const data = context.getImageData(0, 0, width, height).data;
  const raw: Array<{ darkness: number; px: number; py: number }> = [];
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let py = 0; py < height; py += 2) {
    for (let px = 0; px < width; px += 2) {
      const offset = (py * width + px) * 4;
      const alpha = (data[offset + 3] ?? 255) / 255;
      const luminance =
        ((data[offset] ?? 255) + (data[offset + 1] ?? 255) + (data[offset + 2] ?? 255)) / 3;
      const darkness = clamp((255 - luminance) / 255, 0, 1) * alpha;

      if (darkness > 0.09) {
        raw.push({ darkness, px, py });
        if (darkness > 0.16) {
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }
      }
    }
  }

  if (!raw.length || minX >= maxX || minY >= maxY) return [];

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, (maxY - minY) * 1.58);

  return raw.map((sample) => ({
    darkness: sample.darkness,
    x: ((sample.px - midX) / span) * 1.95,
    y: ((sample.py - midY) / span) * 1.58 + 0.035,
  }));
}

function buildMaskTarget(count: number, samples: MaskSample[], seedBase: number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const sample = pickMaskSample(index, samples, seedBase);
    const handMotion =
      smoothstep(0.16, 0.46, sample.x) *
      (1 - smoothstep(0.52, 0.76, sample.x)) *
      smoothstep(0.04, 0.22, sample.y) *
      (1 - smoothstep(0.32, 0.52, sample.y));
    const laptopSparkle =
      smoothstep(0.2, 0.62, sample.x) *
      (1 - smoothstep(0.7, 0.9, sample.x)) *
      smoothstep(-0.22, 0.02, sample.y) *
      (1 - smoothstep(0.14, 0.28, sample.y));

    return {
      motion: handMotion,
      sparkle: laptopSparkle * 0.55,
      weight: 0.24 + sample.darkness * 0.76,
      x: sample.x + (seeded(index + seedBase + 31) - 0.5) * 0.004,
      y: sample.y + (seeded(index + seedBase + 37) - 0.5) * 0.004,
      z: 0.34 + sample.darkness * 0.58 + seeded(index + seedBase + 43) * 0.12,
    };
  });
}

function pickMaskSample(index: number, samples: MaskSample[], seedBase: number): MaskSample {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const sample =
      samples[Math.floor(seeded(index * 13 + seedBase + attempt * 17) * samples.length)];
    if (!sample) continue;
    const roll = seeded(index * 23 + seedBase + attempt * 29);
    if (sample.darkness > roll * 0.86) return sample;
  }

  return (
    samples[Math.floor(seeded(index + seedBase) * samples.length)] ?? { darkness: 0.3, x: 0, y: 0 }
  );
}

function buildShapeTarget(count: number, shapes: ShapeSpec[], seedBase: number): Point[] {
  const totalWeight = shapes.reduce((sum, shape) => sum + shape.weight, 0);
  return Array.from({ length: count }, (_, index) => {
    const roll = seeded(index * 5 + seedBase) * totalWeight;
    let cursor = 0;
    let shape = shapes[0]!;

    for (const item of shapes) {
      cursor += item.weight;
      if (roll <= cursor) {
        shape = item;
        break;
      }
    }

    return sampleShapePoint(index, shape, seedBase + shape.seed);
  });
}

function sampleShapePoint(index: number, shape: ShapeSpec, seedBase: number): Point {
  if (shape.kind === 'dust') {
    return {
      motion: 0,
      sparkle: 0.2,
      weight: 0.16 + seeded(index + seedBase + 1) * 0.26,
      x: shape.cx + (seeded(index + seedBase + 3) - 0.5) * shape.width,
      y: shape.cy + (seeded(index + seedBase + 5) - 0.5) * shape.height,
      z: shape.depth + seeded(index + seedBase + 7) * 0.18,
    };
  }

  if (shape.kind === 'rect') {
    const x = (seeded(index + seedBase + 11) - 0.5) * shape.width;
    const y = (seeded(index + seedBase + 13) - 0.5) * shape.height;
    const angle = shape.angle ?? 0;
    const rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
    const rotatedY = x * Math.sin(angle) + y * Math.cos(angle);
    return {
      motion: 0,
      sparkle: 0.16,
      weight: 0.34 + seeded(index + seedBase + 17) * 0.44,
      x: shape.cx + rotatedX,
      y: shape.cy + rotatedY,
      z: shape.depth + seeded(index + seedBase + 19) * 0.12,
    };
  }

  if (shape.kind === 'capsule') {
    const t = seeded(index + seedBase + 23);
    const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1) + Math.PI / 2;
    const spread = (seeded(index + seedBase + 29) - 0.5) * shape.thickness;
    return {
      motion: 0,
      sparkle: 0.08,
      weight: 0.34 + seeded(index + seedBase + 31) * 0.36,
      x: shape.x1 + (shape.x2 - shape.x1) * t + Math.cos(angle) * spread,
      y: shape.y1 + (shape.y2 - shape.y1) * t + Math.sin(angle) * spread,
      z: shape.depth + seeded(index + seedBase + 37) * 0.12,
    };
  }

  const radius = Math.sqrt(seeded(index + seedBase + 41));
  const theta = seeded(index + seedBase + 43) * Math.PI * 2;
  const density = shape.density ?? 1;
  const edge = density < 1 ? radius ** (1 + (1 - density) * 3) : radius;

  return {
    motion: 0,
    sparkle: 0.1,
    weight: 0.26 + seeded(index + seedBase + 47) * 0.52,
    x: shape.cx + Math.cos(theta) * shape.rx * edge,
    y: shape.cy + Math.sin(theta) * shape.ry * edge,
    z: shape.depth + seeded(index + seedBase + 53) * 0.14,
  };
}

const creatorFallbackShapes: ShapeSpec[] = [
  {
    kind: 'ellipse',
    cx: -0.35,
    cy: -0.22,
    rx: 0.18,
    ry: 0.24,
    density: 0.6,
    depth: 0.8,
    seed: 11,
    weight: 16,
  },
  {
    kind: 'ellipse',
    cx: -0.3,
    cy: 0.08,
    rx: 0.28,
    ry: 0.36,
    density: 0.72,
    depth: 0.78,
    seed: 13,
    weight: 28,
  },
  {
    kind: 'capsule',
    x1: -0.16,
    y1: 0.08,
    x2: 0.36,
    y2: 0.18,
    thickness: 0.09,
    depth: 0.86,
    seed: 17,
    weight: 14,
  },
  {
    kind: 'rect',
    cx: 0.4,
    cy: 0.0,
    width: 0.18,
    height: 0.38,
    angle: -0.12,
    depth: 0.78,
    seed: 19,
    weight: 10,
  },
  {
    kind: 'rect',
    cx: 0.36,
    cy: 0.22,
    width: 0.72,
    height: 0.08,
    depth: 0.64,
    seed: 23,
    weight: 12,
  },
  { kind: 'dust', cx: 0.06, cy: 0.33, width: 1.28, height: 0.08, depth: 0.34, seed: 29, weight: 8 },
];

const platformShapes: ShapeSpec[] = [
  { kind: 'rect', cx: 0, cy: -0.03, width: 1.1, height: 0.62, depth: 0.78, seed: 101, weight: 40 },
  {
    kind: 'rect',
    cx: -0.28,
    cy: -0.02,
    width: 0.28,
    height: 0.42,
    depth: 0.92,
    seed: 103,
    weight: 16,
  },
  {
    kind: 'rect',
    cx: 0.16,
    cy: -0.08,
    width: 0.46,
    height: 0.28,
    depth: 0.9,
    seed: 107,
    weight: 18,
  },
  { kind: 'rect', cx: 0.2, cy: 0.23, width: 0.62, height: 0.08, depth: 0.72, seed: 109, weight: 8 },
  { kind: 'dust', cx: 0, cy: 0.36, width: 1.34, height: 0.1, depth: 0.3, seed: 113, weight: 8 },
];

const generateShapes: ShapeSpec[] = [
  {
    kind: 'rect',
    cx: -0.36,
    cy: -0.1,
    width: 0.44,
    height: 0.58,
    depth: 0.86,
    seed: 201,
    weight: 20,
  },
  {
    kind: 'rect',
    cx: 0.11,
    cy: -0.08,
    width: 0.44,
    height: 0.58,
    depth: 0.88,
    seed: 203,
    weight: 20,
  },
  {
    kind: 'rect',
    cx: 0.58,
    cy: -0.1,
    width: 0.28,
    height: 0.42,
    depth: 0.72,
    seed: 207,
    weight: 12,
  },
  {
    kind: 'ellipse',
    cx: 0.52,
    cy: 0.24,
    rx: 0.18,
    ry: 0.1,
    density: 0.6,
    depth: 0.92,
    seed: 211,
    weight: 10,
  },
  {
    kind: 'dust',
    cx: 0.05,
    cy: 0.42,
    width: 1.6,
    height: 0.16,
    depth: 0.22,
    seed: 223,
    weight: 16,
  },
];

const finishShapes: ShapeSpec[] = [
  {
    kind: 'ellipse',
    cx: -0.24,
    cy: -0.06,
    rx: 0.34,
    ry: 0.42,
    density: 0.52,
    depth: 0.82,
    seed: 301,
    weight: 26,
  },
  {
    kind: 'ellipse',
    cx: 0.24,
    cy: -0.06,
    rx: 0.34,
    ry: 0.42,
    density: 0.52,
    depth: 0.84,
    seed: 303,
    weight: 26,
  },
  {
    kind: 'capsule',
    x1: -0.34,
    y1: 0.34,
    x2: 0.34,
    y2: 0.34,
    thickness: 0.08,
    depth: 0.66,
    seed: 307,
    weight: 10,
  },
  { kind: 'dust', cx: 0, cy: 0.0, width: 1.4, height: 0.9, depth: 0.2, seed: 311, weight: 14 },
];

function seeded(value: number) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
