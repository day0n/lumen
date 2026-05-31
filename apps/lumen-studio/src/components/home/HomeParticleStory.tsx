'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type SceneKey = 'creator' | 'signals' | 'workflow' | 'frames' | 'memory';

interface StoryScene {
  key: SceneKey;
  kicker: string;
  text: string;
  side: 'left' | 'right';
}

interface Particle {
  shade: number;
  drift: number;
  phase: number;
  seed: number;
  size: number;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

type ShapeSpec =
  | {
      kind: 'ellipse';
      angle?: number;
      cx: number;
      cy: number;
      density?: number;
      depth: number;
      rx: number;
      ry: number;
      seed: number;
      weight: number;
    }
  | {
      kind: 'rect';
      angle?: number;
      cx: number;
      cy: number;
      depth: number;
      height: number;
      seed: number;
      weight: number;
      width: number;
    }
  | {
      kind: 'capsule';
      depth: number;
      seed: number;
      thickness: number;
      weight: number;
      x1: number;
      x2: number;
      y1: number;
      y2: number;
    }
  | {
      kind: 'arc';
      cx: number;
      cy: number;
      depth: number;
      end: number;
      rx: number;
      ry: number;
      seed: number;
      start: number;
      thickness: number;
      weight: number;
    }
  | {
      kind: 'dust';
      cx: number;
      cy: number;
      depth: number;
      height: number;
      seed: number;
      weight: number;
      width: number;
    };

const STORY_SCENES: StoryScene[] = [
  {
    key: 'creator',
    kicker: '在 Lumen 平台创作',
    side: 'right',
    text: '创作者坐在工作台前，把商品、素材和灵感整理成可以运行的画面。',
  },
  {
    key: 'signals',
    kicker: '理解商品',
    side: 'left',
    text: '商品、卖点和爆款结构，先变成可编辑的创作信号。',
  },
  {
    key: 'workflow',
    kicker: '连接流程',
    side: 'right',
    text: '脚本、镜头、素材和画布，被串成一条可继续调整的工作流。',
  },
  {
    key: 'frames',
    kicker: '生成画面',
    side: 'left',
    text: '图文和视频画面从节点里生成，创作节奏留在同一个工作台里。',
  },
  {
    key: 'memory',
    kicker: '复用经验',
    side: 'right',
    text: '每一次成片，都沉淀为下一次可以复用的判断。',
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
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let particles: Particle[] = [];
    let targets: Point[][] = [];
    let typingTargets: Point[] = [];

    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const setReducedMotion = () => {
      reducedMotion = reduceQuery.matches;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = particleTarget(width);
      particles = Array.from({ length: count }, (_, index) => ({
        drift: seeded(index + 17),
        phase: seeded(index + 23) * Math.PI * 2,
        seed: seeded(index + 29),
        shade: seeded(index + 31),
        size: width < 640 ? 0.62 + seeded(index + 37) * 0.68 : 0.72 + seeded(index + 37) * 1.02,
      }));
      targets = buildTargets(count, 0);
      typingTargets = buildCreatorMaskTarget(count, true, 1600);
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
      const morph = smoothstep(0.68, 1, local);
      const typing = reducedMotion ? 0.25 : (Math.sin(time * 0.0062) + 1) * 0.5;
      const now = performance.now();

      if (now - lastStateUpdate > 60) {
        lastStateUpdate = now;
        setPhase({ local, scene });
      }

      context.clearRect(0, 0, width, height);

      const scale = width < 640 ? Math.min(width, height) * 0.82 : Math.min(width, height) * 0.94;
      const offsetX =
        width * (width < 640 ? 0.48 : 0.45) + pointerRef.current.x * (width < 640 ? 4 : 12);
      const offsetY =
        height * (width < 640 ? 0.6 : 0.56) + pointerRef.current.y * (width < 640 ? 3 : 9);
      const pulse = reducedMotion ? 0 : time * 0.00028;
      const from = targets[scene] ?? targets[0]!;
      const to = targets[nextScene] ?? from;

      context.save();
      context.translate(offsetX, offsetY);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const a = from[index];
        const b = to[index];
        if (!particle || !a || !b) continue;

        const firstSceneTarget =
          scene === 0 && typingTargets[index] ? lerpPoint(a, typingTargets[index]!, typing) : a;
        const target = lerpPoint(firstSceneTarget, b, morph);
        const drift = reducedMotion
          ? { x: 0, y: 0 }
          : particleDrift(particle, pulse, progress, scene);
        const x = (target.x + drift.x) * scale;
        const y = (target.y + drift.y) * scale;
        const size = particle.size * (0.48 + target.z * 0.94);

        context.fillStyle = particleColor(particle, target.z, scene);
        context.fillRect(x, y, size, size);
      }

      context.restore();
      raf = window.requestAnimationFrame(draw);
    };

    resize();
    updateProgress();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('mousemove', updatePointer, { passive: true });
    reduceQuery.addEventListener('change', setReducedMotion);
    raf = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('mousemove', updatePointer);
      reduceQuery.removeEventListener('change', setReducedMotion);
    };
  }, []);

  const activeScene = STORY_SCENES[phase.scene] ?? STORY_SCENES[0]!;

  return (
    <section
      ref={sectionRef}
      aria-label="Lumen 平台创作粒子演示"
      className="relative left-1/2 mt-20 ml-[-50vw] h-[620svh] w-screen bg-[#f5f2ed] text-[#111315]"
    >
      <div className="sticky top-20 isolate h-[calc(100svh-5rem)] overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[#f5f2ed]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-28 bg-[linear-gradient(180deg,#f5f2ed_0%,rgba(245,242,237,0)_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-28 bg-[linear-gradient(180deg,rgba(245,242,237,0)_0%,#f5f2ed_100%)]"
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

function RevealText({ text, reveal }: { text: string; reveal: number }) {
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
  if (width < 640) return 18000;
  if (width < 1024) return 32000;
  return 56000;
}

function buildTargets(count: number, seedOffset: number): Point[][] {
  return [
    buildCreatorMaskTarget(count, false, seedOffset + 1000),
    buildSceneTarget(count, signalShapes, seedOffset + 2000),
    buildSceneTarget(count, workflowShapes, seedOffset + 3000),
    buildSceneTarget(count, frameShapes, seedOffset + 4000),
    buildSceneTarget(count, memoryShapes, seedOffset + 5000),
  ];
}

function buildSceneTarget(count: number, shapes: ShapeSpec[], seedBase: number): Point[] {
  return Array.from({ length: count }, (_, index) => pickShapePoint(index, shapes, seedBase));
}

function buildCreatorMaskTarget(count: number, typing: boolean, seedBase: number): Point[] {
  const mask = createCreatorMask(typing);
  return Array.from({ length: count }, (_, index) => sampleMaskPoint(index, mask, seedBase));
}

function createCreatorMask(typing: boolean) {
  const mask = document.createElement('canvas');
  const width = 1040;
  const height = 720;
  mask.width = width;
  mask.height = height;

  const context = mask.getContext('2d');
  if (!context) {
    return { data: new Uint8ClampedArray(width * height * 4), height, width };
  }

  context.clearRect(0, 0, width, height);
  context.fillStyle = 'black';
  context.strokeStyle = 'black';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  drawCreatorSilhouette(context, typing);

  return {
    data: context.getImageData(0, 0, width, height).data,
    height,
    width,
  };
}

function drawCreatorSilhouette(context: CanvasRenderingContext2D, typing: boolean) {
  const handLift = typing ? -22 : 14;
  const wristLift = typing ? -18 : 8;
  const headLift = typing ? -5 : 2;

  context.save();
  context.translate(-8, -2);

  context.beginPath();
  context.ellipse(312, 196 + headLift, 75, 96, -0.25, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.ellipse(365, 244 + headLift, 42, 58, -0.2, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.moveTo(244, 268);
  context.bezierCurveTo(276, 198, 408, 204, 506, 282);
  context.bezierCurveTo(604, 360, 548, 446, 414, 432);
  context.bezierCurveTo(306, 422, 216, 350, 244, 268);
  context.fill();

  context.beginPath();
  context.ellipse(382, 445, 168, 78, 0.08, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.ellipse(250, 390, 78, 148, -0.28, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = 66;
  context.beginPath();
  context.moveTo(440, 342);
  context.bezierCurveTo(488, 398 + wristLift * 0.3, 520, 462 + wristLift, 618, 486 + handLift);
  context.stroke();

  context.lineWidth = 50;
  context.beginPath();
  context.moveTo(326, 348);
  context.bezierCurveTo(
    394,
    438 + wristLift * 0.2,
    472,
    496 + wristLift,
    574,
    522 - handLift * 0.5,
  );
  context.stroke();

  context.beginPath();
  context.ellipse(642, 490 + handLift, 50, 22, 0.12, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.ellipse(592, 524 - handLift * 0.42, 48, 20, 0.18, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.translate(610, 324);
  context.rotate(-0.07);
  context.lineWidth = 24;
  context.strokeRect(-82, -58, 164, 116);
  context.fillRect(-16, 62, 32, 74);
  context.restore();

  context.save();
  context.translate(608, 491);
  context.rotate(0.04);
  context.fillRect(-145, -18, 290, 36);
  context.restore();

  context.lineWidth = 38;
  context.beginPath();
  context.moveTo(128, 548);
  context.lineTo(760, 548);
  context.stroke();

  context.restore();
}

function sampleMaskPoint(
  index: number,
  mask: { data: Uint8ClampedArray; height: number; width: number },
  seedBase: number,
): Point {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const xSeed = seeded(index * 7 + seedBase + attempt * 19);
    const ySeed = seeded(index * 11 + seedBase + attempt * 23);
    const px = Math.floor(xSeed * mask.width);
    const py = Math.floor(ySeed * mask.height);
    const alpha = mask.data[(py * mask.width + px) * 4 + 3] ?? 0;

    if (alpha > 14) {
      const jitterX = (seeded(index + attempt * 31 + seedBase) - 0.5) * 0.004;
      const jitterY = (seeded(index + attempt * 37 + seedBase) - 0.5) * 0.004;
      return {
        x: (px / mask.width - 0.5) * 1.68 + jitterX,
        y: (py / mask.height - 0.52) * 1.24 + jitterY,
        z: 0.42 + (alpha / 255) * 0.42 + seeded(index + seedBase + 5) * 0.14,
      };
    }
  }

  return sampleDustPoint(index, {
    kind: 'dust',
    cx: -0.1,
    cy: 0.48,
    width: 1.7,
    height: 0.12,
    depth: 0.22,
    seed: seedBase,
    weight: 1,
  });
}

const signalShapes: ShapeSpec[] = [
  {
    kind: 'ellipse',
    cx: -0.28,
    cy: -0.1,
    rx: 0.55,
    ry: 0.34,
    angle: 0.12,
    density: 0.52,
    depth: 0.72,
    seed: 101,
    weight: 32,
  },
  {
    kind: 'ellipse',
    cx: 0.2,
    cy: 0.04,
    rx: 0.42,
    ry: 0.22,
    angle: -0.26,
    density: 0.64,
    depth: 0.86,
    seed: 103,
    weight: 20,
  },
  {
    kind: 'dust',
    cx: -0.08,
    cy: 0.42,
    width: 1.8,
    height: 0.16,
    depth: 0.3,
    seed: 107,
    weight: 13,
  },
  {
    kind: 'arc',
    cx: 0.1,
    cy: -0.02,
    rx: 0.58,
    ry: 0.34,
    start: -0.25,
    end: Math.PI * 1.35,
    thickness: 0.05,
    depth: 0.78,
    seed: 109,
    weight: 10,
  },
  {
    kind: 'dust',
    cx: 0.72,
    cy: -0.1,
    width: 0.24,
    height: 1.08,
    depth: 0.18,
    seed: 113,
    weight: 4,
  },
];

const workflowShapes: ShapeSpec[] = [
  {
    kind: 'ellipse',
    cx: -0.52,
    cy: -0.12,
    rx: 0.12,
    ry: 0.12,
    density: 0.48,
    depth: 0.88,
    seed: 201,
    weight: 8,
  },
  {
    kind: 'ellipse',
    cx: -0.18,
    cy: 0.06,
    rx: 0.12,
    ry: 0.12,
    density: 0.48,
    depth: 0.9,
    seed: 203,
    weight: 8,
  },
  {
    kind: 'ellipse',
    cx: 0.18,
    cy: -0.08,
    rx: 0.12,
    ry: 0.12,
    density: 0.48,
    depth: 0.9,
    seed: 207,
    weight: 8,
  },
  {
    kind: 'ellipse',
    cx: 0.52,
    cy: 0.08,
    rx: 0.12,
    ry: 0.12,
    density: 0.48,
    depth: 0.86,
    seed: 211,
    weight: 8,
  },
  {
    kind: 'capsule',
    x1: -0.42,
    y1: -0.08,
    x2: -0.28,
    y2: 0.02,
    thickness: 0.035,
    depth: 0.74,
    seed: 223,
    weight: 4,
  },
  {
    kind: 'capsule',
    x1: -0.07,
    y1: 0.02,
    x2: 0.07,
    y2: -0.04,
    thickness: 0.035,
    depth: 0.74,
    seed: 227,
    weight: 4,
  },
  {
    kind: 'capsule',
    x1: 0.29,
    y1: -0.04,
    x2: 0.42,
    y2: 0.04,
    thickness: 0.035,
    depth: 0.74,
    seed: 229,
    weight: 4,
  },
  {
    kind: 'ellipse',
    cx: 0.0,
    cy: 0.22,
    rx: 0.58,
    ry: 0.18,
    angle: -0.04,
    density: 0.62,
    depth: 0.5,
    seed: 233,
    weight: 20,
  },
  {
    kind: 'dust',
    cx: 0.0,
    cy: 0.49,
    width: 1.92,
    height: 0.12,
    depth: 0.28,
    seed: 239,
    weight: 12,
  },
];

const frameShapes: ShapeSpec[] = [
  {
    kind: 'rect',
    cx: -0.33,
    cy: -0.08,
    width: 0.45,
    height: 0.32,
    angle: -0.08,
    depth: 0.78,
    seed: 301,
    weight: 16,
  },
  {
    kind: 'rect',
    cx: 0.24,
    cy: 0.02,
    width: 0.48,
    height: 0.34,
    angle: 0.06,
    depth: 0.82,
    seed: 307,
    weight: 18,
  },
  {
    kind: 'capsule',
    x1: -0.58,
    y1: 0.28,
    x2: 0.56,
    y2: 0.33,
    thickness: 0.06,
    depth: 0.62,
    seed: 311,
    weight: 10,
  },
  {
    kind: 'ellipse',
    cx: -0.01,
    cy: 0.31,
    rx: 0.16,
    ry: 0.08,
    density: 0.46,
    depth: 0.96,
    seed: 313,
    weight: 7,
  },
  {
    kind: 'capsule',
    x1: -0.07,
    y1: 0.31,
    x2: 0.06,
    y2: 0.31,
    thickness: 0.018,
    depth: 1,
    seed: 317,
    weight: 2,
  },
  {
    kind: 'capsule',
    x1: 0.0,
    y1: 0.24,
    x2: 0.0,
    y2: 0.38,
    thickness: 0.018,
    depth: 1,
    seed: 331,
    weight: 2,
  },
  {
    kind: 'dust',
    cx: 0.08,
    cy: -0.34,
    width: 1.58,
    height: 0.18,
    depth: 0.28,
    seed: 337,
    weight: 8,
  },
  { kind: 'dust', cx: 0.0, cy: 0.52, width: 1.84, height: 0.12, depth: 0.24, seed: 347, weight: 9 },
];

const memoryShapes: ShapeSpec[] = [
  {
    kind: 'arc',
    cx: -0.02,
    cy: -0.02,
    rx: 0.52,
    ry: 0.38,
    start: -0.2,
    end: Math.PI * 1.72,
    thickness: 0.1,
    depth: 0.72,
    seed: 401,
    weight: 22,
  },
  {
    kind: 'ellipse',
    cx: -0.3,
    cy: -0.12,
    rx: 0.1,
    ry: 0.1,
    density: 0.48,
    depth: 0.9,
    seed: 409,
    weight: 7,
  },
  {
    kind: 'ellipse',
    cx: 0.04,
    cy: 0.07,
    rx: 0.12,
    ry: 0.12,
    density: 0.48,
    depth: 0.94,
    seed: 419,
    weight: 9,
  },
  {
    kind: 'ellipse',
    cx: 0.4,
    cy: -0.14,
    rx: 0.09,
    ry: 0.09,
    density: 0.48,
    depth: 0.84,
    seed: 421,
    weight: 6,
  },
  {
    kind: 'capsule',
    x1: -0.2,
    y1: -0.08,
    x2: -0.05,
    y2: 0.02,
    thickness: 0.035,
    depth: 0.72,
    seed: 431,
    weight: 3,
  },
  {
    kind: 'capsule',
    x1: 0.14,
    y1: 0.03,
    x2: 0.32,
    y2: -0.08,
    thickness: 0.035,
    depth: 0.72,
    seed: 433,
    weight: 3,
  },
  {
    kind: 'dust',
    cx: 0.0,
    cy: 0.46,
    width: 1.78,
    height: 0.16,
    depth: 0.26,
    seed: 439,
    weight: 12,
  },
  {
    kind: 'dust',
    cx: -0.72,
    cy: -0.08,
    width: 0.24,
    height: 1.14,
    depth: 0.16,
    seed: 443,
    weight: 4,
  },
  {
    kind: 'dust',
    cx: 0.74,
    cy: -0.06,
    width: 0.24,
    height: 1.14,
    depth: 0.16,
    seed: 449,
    weight: 4,
  },
];

function pickShapePoint(index: number, specs: ShapeSpec[], seedBase: number): Point {
  const total = specs.reduce((sum, spec) => sum + spec.weight, 0);
  let cursor = seeded(index + seedBase) * total;

  for (const spec of specs) {
    cursor -= spec.weight;
    if (cursor <= 0) return sampleShapePoint(spec, index + seedBase);
  }

  return sampleShapePoint(specs[specs.length - 1]!, index + seedBase);
}

function sampleShapePoint(spec: ShapeSpec, index: number): Point {
  if (spec.kind === 'ellipse') {
    const angle = seeded(index * 3 + spec.seed) * Math.PI * 2;
    const radius = seeded(index * 3 + spec.seed + 1) ** (spec.density ?? 0.52);
    const x = Math.cos(angle) * spec.rx * radius;
    const y = Math.sin(angle) * spec.ry * radius;
    const rotated = rotatePoint(x, y, spec.angle ?? 0);
    return {
      x: spec.cx + rotated.x,
      y: spec.cy + rotated.y,
      z: spec.depth * (0.46 + (1 - radius) * 0.38 + seeded(index + spec.seed + 7) * 0.18),
    };
  }

  if (spec.kind === 'rect') {
    const localX = (seeded(index * 2 + spec.seed) - 0.5) * spec.width;
    const localY = (seeded(index * 2 + spec.seed + 1) - 0.5) * spec.height;
    const rotated = rotatePoint(localX, localY, spec.angle ?? 0);
    const edge =
      1 -
      Math.max(
        Math.abs(localX) / Math.max(spec.width * 0.5, 0.001),
        Math.abs(localY) / Math.max(spec.height * 0.5, 0.001),
      );

    return {
      x: spec.cx + rotated.x,
      y: spec.cy + rotated.y,
      z: spec.depth * (0.42 + edge * 0.34 + seeded(index + spec.seed + 5) * 0.18),
    };
  }

  if (spec.kind === 'capsule') {
    return sampleCapsulePoint(index, spec);
  }

  if (spec.kind === 'arc') {
    const t = seeded(index * 2 + spec.seed);
    const angle = lerp(spec.start, spec.end, t);
    const offset = (seeded(index * 2 + spec.seed + 1) - 0.5) * spec.thickness;
    return {
      x: spec.cx + Math.cos(angle) * (spec.rx + offset),
      y: spec.cy + Math.sin(angle) * (spec.ry + offset),
      z: spec.depth * (0.48 + seeded(index + spec.seed + 7) * 0.34),
    };
  }

  return sampleDustPoint(index, spec);
}

function sampleCapsulePoint(index: number, spec: Extract<ShapeSpec, { kind: 'capsule' }>): Point {
  const t = seeded(index * 2 + spec.seed);
  const dx = spec.x2 - spec.x1;
  const dy = spec.y2 - spec.y1;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  const offset = (seeded(index * 2 + spec.seed + 1) - 0.5) * spec.thickness;
  const taper = 0.74 + Math.sin(t * Math.PI) * 0.36;

  return {
    x: lerp(spec.x1, spec.x2, t) + (-dy / length) * offset * taper,
    y: lerp(spec.y1, spec.y2, t) + (dx / length) * offset * taper,
    z: spec.depth * (0.42 + Math.sin(t * Math.PI) * 0.34 + seeded(index + spec.seed + 5) * 0.18),
  };
}

function sampleDustPoint(index: number, spec: Extract<ShapeSpec, { kind: 'dust' }>): Point {
  const x = spec.cx + (seeded(index * 2 + spec.seed) - 0.5) * spec.width;
  const y =
    spec.cy +
    (seeded(index * 2 + spec.seed + 1) - 0.5) * spec.height +
    Math.sin(x * 5.4 + seeded(index + spec.seed + 7) * 4) * spec.height * 0.18;
  const fade = 1 - Math.abs(x - spec.cx) / Math.max(spec.width * 0.5, 0.001);

  return {
    x,
    y,
    z: spec.depth * (0.34 + fade * 0.42 + seeded(index + spec.seed + 3) * 0.2),
  };
}

function particleColor(particle: Particle, depth: number, scene: number) {
  const ink = scene === 0 ? 28 : 38;
  const tone = Math.round(ink + particle.shade * 34 + depth * 18);
  const alpha = clamp(0.16 + depth * 0.72 + particle.seed * 0.14, 0.16, scene === 0 ? 0.88 : 0.76);
  return `rgba(${tone},${tone},${tone},${alpha})`;
}

function particleDrift(
  particle: Particle,
  pulse: number,
  progress: number,
  scene: number,
): { x: number; y: number } {
  const tempo = pulse * (1.3 + particle.seed * 1.6);
  const strength = scene === 0 ? 0.0018 + particle.drift * 0.004 : 0.003 + particle.drift * 0.01;

  return {
    x: Math.sin(tempo + particle.phase + progress * 6) * strength,
    y: Math.cos(tempo * 0.9 + particle.phase * 0.7) * strength * 0.72,
  };
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

function rotatePoint(x: number, y: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

function seeded(value: number) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
