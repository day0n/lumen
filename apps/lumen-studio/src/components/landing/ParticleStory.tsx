'use client';

import { IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

type SceneKey = 'signal' | 'lens' | 'workflow' | 'frame' | 'memory';

interface StoryScene {
  key: SceneKey;
  text: string;
  side: 'left' | 'right';
}

interface Particle {
  accent: number;
  homeX: number;
  homeY: number;
  lane: number;
  seed: number;
  phase: number;
  size: number;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

const STORY_SCENES: StoryScene[] = [
  {
    key: 'signal',
    side: 'right',
    text: '一个商品，先变成可被理解的信号。',
  },
  {
    key: 'lens',
    side: 'left',
    text: '卖点、钩子和节奏被看见。',
  },
  {
    key: 'workflow',
    side: 'right',
    text: '脚本、镜头和素材连成工作流。',
  },
  {
    key: 'frame',
    side: 'left',
    text: '爆款结构被重写成你的短视频。',
  },
  {
    key: 'memory',
    side: 'right',
    text: '每一次成片，都让下一次更快。',
  },
];

const INTRO_COPY =
  'Lumen 把商品、爆款结构和创作判断变成一条可编辑的视频工作流，让每一次创作都留下下一次可复用的经验。';

const INTRO_STRIPES = Array.from({ length: 58 }, (_, index) => {
  const x = -250 + index * 34;
  const bend = 410 + Math.sin(index * 0.48) * 54;
  return {
    d: `M ${x} -110 C ${x + bend * 0.12} 160 ${x - bend * 0.74} 430 ${x + bend * 0.34} 990`,
    opacity: 0.2 + (index % 6) * 0.018,
  };
});

export function ParticleStory() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const [phase, setPhase] = useState({ intro: 1, local: 0, scene: 0, story: 0 });

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
    let particles: Particle[] = [];
    let targets: Point[][] = [];
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastStateUpdate = 0;

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
      particles = Array.from({ length: count }, (_, index) => {
        const accentSeed = seeded(index + 149);
        return {
          accent: accentSeed > 0.965 ? 2 : accentSeed > 0.88 ? 1 : 0,
          homeX: seeded(index + 7) * 2 - 1,
          homeY: seeded(index + 13) * 2 - 1,
          lane: seeded(index + 211),
          phase: seeded(index + 19) * Math.PI * 2,
          seed: seeded(index + 3),
          size: width < 640 ? 0.6 + seeded(index + 29) * 0.72 : 0.72 + seeded(index + 29) * 1.08,
        };
      });
      targets = buildTargets(count);
    };

    const updateProgress = () => {
      const rect = section.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      progressRef.current = clamp(-rect.top / total, 0, 1);
    };

    const updateMouse = (event: globalThis.MouseEvent) => {
      mouseRef.current = {
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2,
      };
    };

    const draw = (time: number) => {
      updateProgress();

      const progress = progressRef.current;
      const intro = 1 - smoothstep(0.045, 0.18, progress);
      const story = smoothstep(0.24, 0.32, progress);
      const particleReveal = smoothstep(0.022, 0.085, progress);
      const particleSpread = smoothstep(0.022, 0.105, progress);
      const sceneProgress = clamp((progress - 0.22) / 0.74, 0, 1);
      const scaled = sceneProgress * (STORY_SCENES.length - 1);
      const scene = Math.min(STORY_SCENES.length - 1, Math.floor(scaled));
      const nextScene = Math.min(STORY_SCENES.length - 1, scene + 1);
      const local = scaled - scene;
      const eased = smoothstep(0, 1, local);
      const now = performance.now();

      if (now - lastStateUpdate > 55) {
        lastStateUpdate = now;
        setPhase({ intro, local, scene, story });
      }

      context.clearRect(0, 0, width, height);

      const scale = width < 640 ? Math.min(width, height) * 1.08 : Math.min(width, height) * 0.92;
      const offsetX = width * 0.5 + mouseRef.current.x * (width < 640 ? 5 : 18);
      const offsetY =
        height * (width < 640 ? 0.56 : 0.53) + mouseRef.current.y * (width < 640 ? 4 : 12);
      const pulse = reducedMotion ? 0 : time * 0.00034;
      const from = targets[scene] ?? targets[0]!;
      const to = targets[nextScene] ?? from;

      context.save();
      context.translate(offsetX, offsetY);
      context.rotate(mouseRef.current.x * 0.008);

      if (particleReveal > 0.002) {
        for (let index = 0; index < particles.length; index += 1) {
          const particle = particles[index];
          const a = from[index];
          const b = to[index];
          if (!particle || !a || !b) continue;

          const swirl = reducedMotion ? { x: 0, y: 0 } : particleDrift(particle, pulse, progress);
          const targetX = lerp(a.x, b.x, eased) + swirl.x;
          const targetY = lerp(a.y, b.y, eased) + swirl.y;
          const birthX = particle.homeX * 0.16 + Math.sin(particle.phase) * 0.025;
          const birthY = particle.homeY * 0.1 + Math.cos(particle.phase) * 0.018;
          const x = lerp(birthX, targetX, particleSpread) * scale;
          const y = lerp(birthY, targetY, particleSpread) * scale;
          const depth = lerp(a.z, b.z, eased);
          const alpha =
            clamp(0.08 + depth * 0.86 + particle.seed * 0.2, 0.08, 0.94) * particleReveal;
          const color = particleColor(particle, alpha, depth);
          const size = particle.size * (0.54 + depth * 0.86);

          context.fillStyle = color;
          context.fillRect(x, y, size, size);
        }
      }
      context.restore();

      raf = window.requestAnimationFrame(draw);
    };

    resize();
    updateProgress();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('mousemove', updateMouse, { passive: true });
    reduceQuery.addEventListener('change', setReducedMotion);
    raf = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('mousemove', updateMouse);
      reduceQuery.removeEventListener('change', setReducedMotion);
    };
  }, []);

  const activeScene = STORY_SCENES[phase.scene] ?? STORY_SCENES[0]!;

  return (
    <section id="story" ref={sectionRef} className="relative h-[1500svh] bg-[#0c0d0f]">
      <div className="sticky top-0 isolate h-svh overflow-hidden">
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 z-[12] h-full w-full"
          aria-hidden
        />
        <IntroStripes opacity={phase.intro} />

        <div
          className="absolute inset-0 z-10 flex items-center justify-center px-6 pt-20 text-center"
          style={{
            opacity: phase.intro,
            pointerEvents: phase.intro > 0.25 ? 'auto' : 'none',
            transform: `translateY(${(1 - phase.intro) * -18}px)`,
          }}
        >
          <div className="max-w-[1040px]">
            <h1 className="lumen-serif-display text-[38px] font-black leading-[1.02] tracking-normal text-[#f4f6f8] md:text-[66px] lg:text-[84px]">
              把商品变成
              <br />
              会卖货的视频
            </h1>
            <p className="mx-auto mt-5 max-w-[500px] text-[13px] leading-6 tracking-normal text-white/52 md:text-[14px]">
              {INTRO_COPY}
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-2.5">
              <Link
                href="/home"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#79e4ff] px-4 text-[13px] font-bold tracking-normal text-[#071316] transition-transform active:scale-[0.98]"
              >
                开始创作
                <IconArrowRight size={16} stroke={2.4} />
              </Link>
            </div>
          </div>
        </div>

        <div
          className="absolute inset-x-0 top-[24%] z-20 px-6 md:top-[48%] md:px-16 lg:px-[120px]"
          style={{
            opacity: phase.story,
            pointerEvents: 'none',
          }}
        >
          <div
            className={
              activeScene.side === 'left' ? 'mr-auto max-w-[360px]' : 'ml-auto max-w-[360px]'
            }
          >
            <p className="lumen-serif-display text-[20px] font-black leading-[1.18] tracking-normal text-[#f4f6f8] md:text-[28px] lg:text-[34px]">
              <RevealText text={activeScene.text} reveal={clamp(phase.local * 1.25 + 0.16, 0, 1)} />
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function IntroStripes({ opacity }: { opacity: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
      style={{
        opacity: opacity * 0.92,
      }}
    >
      <div
        className="absolute inset-[-18%]"
        style={{
          backgroundImage:
            'repeating-radial-gradient(ellipse at 50% 112%, transparent 0 21px, rgba(255,255,255,0.066) 22px 23px, transparent 24px 40px)',
          maskImage: 'linear-gradient(180deg, black 0%, black 76%, transparent 100%)',
          opacity: 0.62,
          transform: 'rotate(-6deg) scale(1.18, 1.08)',
          WebkitMaskImage: 'linear-gradient(180deg, black 0%, black 76%, transparent 100%)',
        }}
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        role="presentation"
      >
        <defs>
          <linearGradient id="lumen-intro-stripe" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
            <stop offset="52%" stopColor="rgba(121,228,255,0.085)" />
            <stop offset="100%" stopColor="rgba(245,199,106,0.04)" />
          </linearGradient>
          <linearGradient id="lumen-intro-fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="white" />
            <stop offset="72%" stopColor="white" />
            <stop offset="100%" stopColor="black" />
          </linearGradient>
          <mask id="lumen-intro-mask">
            <rect width="1440" height="900" fill="url(#lumen-intro-fade)" />
          </mask>
        </defs>
        <g
          fill="none"
          mask="url(#lumen-intro-mask)"
          stroke="url(#lumen-intro-stripe)"
          strokeWidth="1"
        >
          {INTRO_STRIPES.map((stripe) => (
            <path key={stripe.d} d={stripe.d} opacity={stripe.opacity} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function RevealText({ text, reveal }: { text: string; reveal: number }) {
  const chars = useMemo(() => Array.from(text), [text]);
  return (
    <>
      {chars.map((char, index) => {
        const start = index / Math.max(1, chars.length - 1);
        const opacity = 0.08 + smoothstep(start - 0.08, start + 0.2, reveal) * 0.92;
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
  if (width < 640) return 15000;
  if (width < 1024) return 28000;
  return 48000;
}

function particleColor(particle: Particle, alpha: number, depth: number) {
  if (particle.accent === 2) {
    return `rgba(245,199,106,${clamp(alpha * 0.24, 0, 0.22)})`;
  }

  if (particle.accent === 1) {
    return `rgba(121,228,255,${clamp(alpha * 0.34, 0, 0.34)})`;
  }

  const tone = Math.round(150 + depth * 82 + particle.seed * 26);
  const blueLift = Math.round(4 + depth * 10);
  return `rgba(${tone},${tone + blueLift},${tone + blueLift * 2},${clamp(alpha * 0.72, 0, 0.78)})`;
}

function buildTargets(count: number): Point[][] {
  return Array.from({ length: STORY_SCENES.length }, (_, scene) =>
    Array.from({ length: count }, (_, index) => pointForScene(scene, index)),
  );
}

function pointForScene(scene: number, index: number): Point {
  if (scene === 0) return datacurveHeroPoint(index);
  if (scene === 1) return datacurveScatterPoint(index);
  if (scene === 2) return datacurveRibbonPoint(index);
  if (scene === 3) return datacurveCurtainPoint(index);
  return datacurveHorizonPoint(index);
}

function datacurveHeroPoint(index: number): Point {
  const picker = seeded(index + 101);

  if (picker < 0.25) {
    return dustCurtainPoint(index, -0.82, -0.2, 0.22, 1.5, 0.82);
  }

  if (picker < 0.46) {
    return dustCurtainPoint(index, 0.82, -0.12, 0.27, 1.5, 0.76);
  }

  if (picker < 0.73) {
    return organicCloudPoint(index, 0.2, 0.02, 0.58, 0.28, 0.9, 0.43);
  }

  if (picker < 0.9) {
    return organicCloudPoint(index, -0.38, 0.12, 0.7, 0.26, 0.68, 0.55);
  }

  return dustSheetPoint(index, -0.02, 0.46, 1.86, 0.24, 0.5);
}

function datacurveScatterPoint(index: number): Point {
  const picker = seeded(index + 307);

  if (picker < 0.24) {
    return dustCurtainPoint(index, -0.9, -0.03, 0.18, 1.72, 0.8);
  }

  if (picker < 0.43) {
    return dustCurtainPoint(index, 0.96, -0.02, 0.2, 1.7, 0.62);
  }

  if (picker < 0.72) {
    return organicCloudPoint(index, 0.34, 0.08, 0.78, 0.34, 0.88, 0.5);
  }

  return dustSheetPoint(index, -0.18, 0.42, 2.05, 0.34, 0.58);
}

function datacurveRibbonPoint(index: number): Point {
  const picker = seeded(index + 509);

  if (picker < 0.18) {
    return dustCurtainPoint(index, -0.96, -0.06, 0.16, 1.8, 0.66);
  }

  if (picker < 0.32) {
    return dustCurtainPoint(index, 0.98, 0.0, 0.18, 1.78, 0.56);
  }

  if (picker < 0.78) {
    const t = seeded(index + 521);
    const waveX = lerp(-0.74, 0.78, t);
    const waveY = Math.sin(t * Math.PI * 2.2 - 0.42) * 0.28 + 0.06;
    const thickness = (seeded(index + 523) - 0.5) * (0.1 + seeded(index + 527) * 0.18);
    return {
      x: waveX + (seeded(index + 529) - 0.5) * 0.12,
      y: waveY + thickness,
      z: 0.52 + seeded(index + 531) * 0.38,
    };
  }

  return organicCloudPoint(index, 0.1, -0.12, 0.96, 0.34, 0.6, 0.48);
}

function datacurveCurtainPoint(index: number): Point {
  const picker = seeded(index + 701);

  if (picker < 0.34) {
    return dustCurtainPoint(index, -0.74, 0.0, 0.3, 1.82, 0.72);
  }

  if (picker < 0.66) {
    return dustCurtainPoint(index, 0.76, 0.02, 0.32, 1.82, 0.72);
  }

  if (picker < 0.88) {
    return organicCloudPoint(index, 0.0, 0.06, 0.88, 0.5, 0.62, 0.46);
  }

  return dustSheetPoint(index, 0.0, -0.52, 1.9, 0.18, 0.38);
}

function datacurveHorizonPoint(index: number): Point {
  const picker = seeded(index + 907);

  if (picker < 0.44) {
    return dustSheetPoint(index, -0.04, 0.22, 2.12, 0.34, 0.56);
  }

  if (picker < 0.76) {
    const side = seeded(index + 911) < 0.5 ? -1 : 1;
    return dustCurtainPoint(index, side * 0.88, -0.08, 0.24, 1.74, 0.58);
  }

  return organicCloudPoint(index, -0.04, -0.22, 1.06, 0.28, 0.5, 0.42);
}

function dustCurtainPoint(
  index: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  depth: number,
): Point {
  const ySeed = seeded(index * 2 + 11);
  const xSeed = seeded(index * 2 + 13);
  const y = cy + (ySeed - 0.5) * height;
  const edgeSoftness = 1 - Math.abs(ySeed - 0.5) * 0.64;
  const x =
    cx + (xSeed - 0.5) * width * edgeSoftness + Math.sin(y * 7.5 + seeded(index + 17) * 6) * 0.035;

  return {
    x,
    y: y + (seeded(index + 19) - 0.5) * 0.04,
    z: depth * (0.38 + edgeSoftness * 0.48 + seeded(index + 23) * 0.16),
  };
}

function dustSheetPoint(
  index: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  depth: number,
): Point {
  const x = cx + (seeded(index * 2 + 31) - 0.5) * width;
  const y =
    cy +
    (seeded(index * 2 + 37) - 0.5) * height +
    Math.sin(x * 5.2 + seeded(index + 41) * 4) * 0.08;
  const fade = 1 - Math.abs(x - cx) / Math.max(width * 0.5, 0.001);

  return {
    x,
    y,
    z: depth * (0.34 + fade * 0.5 + seeded(index + 43) * 0.18),
  };
}

function organicCloudPoint(
  index: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  depth: number,
  density: number,
): Point {
  const angle = seeded(index * 3 + 51) * Math.PI * 2;
  const radius = seeded(index * 3 + 53) ** density;
  const lobe =
    1 +
    Math.sin(angle * 2.2 + seeded(index + 57) * 5) * 0.16 +
    Math.cos(angle * 5.4 + seeded(index + 59) * 3) * 0.08;
  const x = cx + Math.cos(angle) * rx * radius * lobe + (seeded(index + 61) - 0.5) * 0.08;
  const y = cy + Math.sin(angle) * ry * radius * lobe + (seeded(index + 67) - 0.5) * 0.06;
  const core = 1 - radius;

  return {
    x,
    y,
    z: depth * (0.35 + core * 0.44 + seeded(index + 71) * 0.24),
  };
}

function particleDrift(
  particle: Particle,
  pulse: number,
  progress: number,
): { x: number; y: number } {
  const tempo = pulse * (1.6 + particle.seed * 1.8);
  const ribbon = Math.sin(tempo + particle.phase + progress * 9);
  const counter = Math.cos(tempo * 0.86 + particle.phase * 0.7);
  const strength = 0.004 + particle.lane * 0.014;

  return {
    x: ribbon * strength + Math.sin(tempo * 0.4 + particle.phase) * 0.004,
    y: counter * strength * 0.72,
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
