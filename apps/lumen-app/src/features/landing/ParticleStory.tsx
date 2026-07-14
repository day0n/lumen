'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveReleaseAssetUrl } from '../../lib/release-asset-url';
import { LandingArrow } from './LandingArrow';
import { useLandingI18n } from './landing-i18n';
import { APP_HOME_ROUTE } from './useHomeRoutePreload';

type SceneKey = 'filming' | 'night' | 'sunbath';

interface StoryScene {
  key: SceneKey;
  side: 'left' | 'right';
}

interface Particle {
  homeX: number;
  homeY: number;
  lane: number;
  seed: number;
  phase: number;
  size: number;
}

interface Point {
  darkness: number;
  x: number;
  y: number;
  z: number;
}

interface MaskSample {
  darkness: number;
  x: number;
  y: number;
}

const SPRITE_FRAME_COUNT = 4;

const STORY_SCENES: StoryScene[] = [
  {
    key: 'filming',
    side: 'right',
  },
  {
    key: 'night',
    side: 'left',
  },
  {
    key: 'sunbath',
    side: 'right',
  },
];

const SPRITE_SHEETS: Record<SceneKey, string> = {
  filming: resolveReleaseAssetUrl('/particle-masks/creator-filming-sheet.png'),
  night: resolveReleaseAssetUrl('/particle-masks/creator-night-laptop-sheet.png'),
  sunbath: resolveReleaseAssetUrl('/particle-masks/creator-sunbath-sheet.png'),
};

export const INTRO_STRIPES = Array.from({ length: 58 }, (_, index) => {
  const x = -250 + index * 34;
  const bend = 410 + Math.sin(index * 0.48) * 54;
  return {
    d: `M ${x} -110 C ${formatSvgCoordinate(x + bend * 0.12)} 160 ${formatSvgCoordinate(x - bend * 0.74)} 430 ${formatSvgCoordinate(x + bend * 0.34)} 990`,
    opacity: 0.2 + (index % 6) * 0.018,
  };
});

function formatSvgCoordinate(value: number) {
  return value.toFixed(3);
}

interface ParticleStoryProps {
  onHomeIntent?: () => void;
}

export function ParticleStory({ onHomeIntent }: ParticleStoryProps) {
  const { t, ta } = useLandingI18n();
  const sectionRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(0);
  const displayedProgressRef = useRef(0);
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
    let targets: Point[][][] = [];
    let maskFrames: MaskSample[][][] = [];
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastStateUpdate = 0;
    let lastDrawTime = 0;
    let progressInitialized = false;
    let disposed = false;

    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const setReducedMotion = () => {
      reducedMotion = reduceQuery.matches;
    };

    const rebuild = () => {
      const count = particleTarget(width);
      particles = Array.from({ length: count }, (_, index) => ({
        homeX: seeded(index + 7) * 2 - 1,
        homeY: seeded(index + 13) * 2 - 1,
        lane: seeded(index + 211),
        phase: seeded(index + 19) * Math.PI * 2,
        seed: seeded(index + 3),
        size: width < 640 ? 0.6 + seeded(index + 29) * 0.72 : 0.72 + seeded(index + 29) * 1.08,
      }));
      targets = buildTargets(count, maskFrames);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, width < 768 ? 1.25 : 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuild();
    };

    const updateProgress = () => {
      const rect = section.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      const nextProgress = clamp(-rect.top / total, 0, 1);
      progressRef.current = nextProgress;
      if (!progressInitialized) {
        displayedProgressRef.current = nextProgress;
        progressInitialized = true;
      }
    };

    const updateMouse = (event: globalThis.MouseEvent) => {
      mouseRef.current = {
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2,
      };
    };

    const draw = (time: number) => {
      updateProgress();

      const delta = lastDrawTime > 0 ? Math.min(64, time - lastDrawTime) : 16;
      lastDrawTime = time;
      const targetProgress = progressRef.current;
      const renderedProgress = displayedProgressRef.current;
      const progressEase = reducedMotion ? 1 : 1 - 0.001 ** (delta / 460);
      displayedProgressRef.current =
        Math.abs(targetProgress - renderedProgress) < 0.0003
          ? targetProgress
          : lerp(renderedProgress, targetProgress, progressEase);

      const progress = displayedProgressRef.current;
      const intro = 1 - smoothstep(0.015, 0.06, progress);
      const story = smoothstep(0.08, 0.14, progress);
      const particleReveal = 0.34 + smoothstep(0.004, 0.035, progress) * 0.66;
      const particleGather = smoothstep(0.04, 0.085, progress);
      const sceneProgress = clamp((progress - 0.1) / 0.84, 0, 1);
      const scaled = sceneProgress * STORY_SCENES.length;
      const scene = Math.min(STORY_SCENES.length - 1, Math.floor(scaled));
      const nextScene = Math.min(STORY_SCENES.length - 1, scene + 1);
      const local = clamp(scaled - scene, 0, 1);
      const sceneMorph = smoothstep(0.42, 1, local);
      const sceneDisperse =
        story * smoothstep(0.22, 0.48, local) * (1 - smoothstep(0.64, 0.94, local)) * 0.66;
      const seconds = time / 1000;
      const scrollSpriteProgress = smoothstep(0.08, 0.92, local);
      const timeSpriteProgress = pingPong(seconds * 0.34 + scene * 0.31);
      const spriteProgress = reducedMotion
        ? 0
        : clamp(lerp(scrollSpriteProgress, timeSpriteProgress, 0.46), 0, 1);
      const spriteScaled = spriteProgress * (SPRITE_FRAME_COUNT - 1);
      const frameA = Math.floor(spriteScaled);
      const frameB = Math.min(SPRITE_FRAME_COUNT - 1, frameA + 1);
      const frameMorph = smoothstep(0, 1, spriteScaled - frameA);
      const now = performance.now();

      if (now - lastStateUpdate > 55) {
        lastStateUpdate = now;
        setPhase({ intro, local, scene, story });
      }

      context.clearRect(0, 0, width, height);
      paintParticleAtmosphere(context, width, height, progress, seconds);

      const scale = width < 640 ? Math.min(width, height) * 0.92 : Math.min(width, height) * 0.68;
      const offsetX = width * 0.5 + mouseRef.current.x * (width < 640 ? 5 : 18);
      const offsetY =
        height * (width < 640 ? 0.56 : 0.53) + mouseRef.current.y * (width < 640 ? 4 : 12);
      const fieldWidth = width / scale;
      const fieldHeight = height / scale;
      const currentFrames = targets[scene] ?? targets[0] ?? [];
      const nextFrames = targets[nextScene] ?? currentFrames;

      context.save();
      context.translate(offsetX, offsetY);
      context.rotate(mouseRef.current.x * 0.008);

      if (particleReveal > 0.002) {
        for (let index = 0; index < particles.length; index += 1) {
          const particle = particles[index];
          const a = currentFrames[frameA]?.[index];
          const b = currentFrames[frameB]?.[index] ?? a;
          const c = nextFrames[0]?.[index] ?? a;
          if (!particle || !a || !b || !c) continue;

          const swirl = reducedMotion
            ? { x: 0, y: 0 }
            : particleDrift(particle, progress, local, seconds);
          const cloud = reducedMotion
            ? particleCloud(particle, 0, 0, fieldWidth, fieldHeight)
            : particleCloud(particle, progress, seconds, fieldWidth, fieldHeight);
          const frameX = lerp(a.x, b.x, frameMorph);
          const frameY = lerp(a.y, b.y, frameMorph);
          const frameZ = lerp(a.z, b.z, frameMorph);
          const frameDarkness = lerp(a.darkness, b.darkness, frameMorph);
          const targetX = lerp(frameX, c.x, sceneMorph) + swirl.x;
          const targetY = lerp(frameY, c.y, sceneMorph) + swirl.y;
          const targetMix = clamp(particleGather * (1 - sceneDisperse), 0, 1);
          const x = lerp(cloud.x, targetX, targetMix) * scale;
          const y = lerp(cloud.y, targetY, targetMix) * scale;
          const depth = lerp(frameZ, c.z, sceneMorph);
          const darkness = lerp(frameDarkness, c.darkness, sceneMorph);
          const alpha =
            clamp(0.08 + depth * 0.62 + darkness * 0.34 + particle.seed * 0.18, 0.08, 0.94) *
            particleReveal *
            (0.34 + targetMix * 0.66);
          const color = particleColor(particle, alpha, depth, darkness, targetMix, cloud.fade);
          const size =
            particle.size *
            (0.46 + depth * 0.72 + darkness * 0.2 + (1 - targetMix) * particle.seed * 0.22);

          context.fillStyle = color;
          context.fillRect(x, y, size, size);
        }
      }
      context.restore();

      raf = window.requestAnimationFrame(draw);
    };

    Promise.all(STORY_SCENES.map((sceneItem) => loadMaskSheet(SPRITE_SHEETS[sceneItem.key])))
      .then((loadedFrames) => {
        if (disposed) return;
        maskFrames = loadedFrames;
        rebuild();
      })
      .catch(() => {
        if (disposed) return;
        maskFrames = [];
        rebuild();
      });

    resize();
    updateProgress();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('mousemove', updateMouse, { passive: true });
    reduceQuery.addEventListener('change', setReducedMotion);
    raf = window.requestAnimationFrame(draw);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('mousemove', updateMouse);
      reduceQuery.removeEventListener('change', setReducedMotion);
    };
  }, []);

  const activeScene = STORY_SCENES[phase.scene] ?? STORY_SCENES[0]!;
  const activeSceneText = ta('landing.heroScenes')[phase.scene] ?? '';

  return (
    <section id="story" ref={sectionRef} className="relative h-[1500svh] bg-[#0c0d0f]">
      <div className="sticky top-0 isolate h-svh overflow-hidden">
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 z-[8] h-full w-full"
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
              {t('landing.heroTitleA')}
              <br />
              {t('landing.heroTitleB')}
            </h1>
            <p className="mx-auto mt-5 max-w-[500px] text-[13px] leading-6 tracking-normal text-white/52 md:text-[14px]">
              {t('landing.particleSummary')}
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-2.5">
              <a
                href={APP_HOME_ROUTE}
                onFocus={() => onHomeIntent?.()}
                onPointerEnter={() => onHomeIntent?.()}
                onTouchStart={() => onHomeIntent?.()}
                onMouseDown={() => onHomeIntent?.()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#79e4ff] px-4 text-[13px] font-bold tracking-normal text-[#071316] transition-transform active:scale-[0.98]"
              >
                {t('landing.cta')}
                <LandingArrow size={16} stroke={2.4} />
              </a>
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
              <RevealText text={activeSceneText} reveal={clamp(phase.local * 1.25 + 0.16, 0, 1)} />
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
  if (width < 640) return 7200;
  if (width < 1024) return 14000;
  return 48000;
}

function particleColor(
  particle: Particle,
  alpha: number,
  depth: number,
  darkness: number,
  targetMix: number,
  cloudFade: number,
) {
  if (particle.lane > 0.985) {
    return `rgba(245,199,106,${clamp(alpha * (0.18 + targetMix * 0.18) * cloudFade, 0, 0.22)})`;
  }

  if (particle.lane > 0.94) {
    return `rgba(121,228,255,${clamp(alpha * (0.22 + targetMix * 0.22) * cloudFade, 0, 0.34)})`;
  }

  const tone = Math.round(188 + depth * 54 + particle.seed * 18 - darkness * 24);
  const blueLift = Math.round(5 + depth * 10);
  const cloudLift = Math.round((1 - targetMix) * 18);
  return `rgba(${tone + cloudLift},${tone + blueLift + cloudLift},${tone + blueLift * 2 + cloudLift},${clamp(alpha * (0.36 + targetMix * 0.4) * cloudFade, 0, 0.82)})`;
}

function loadMaskSheet(src: string): Promise<MaskSample[][]> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(buildMaskSheetSamples(image));
    image.onerror = () => reject(new Error(`Unable to load particle mask: ${src}`));
    image.src = src;
  });
}

function buildMaskSheetSamples(image: HTMLImageElement): MaskSample[][] {
  const canvas = document.createElement('canvas');
  const width = 1280;
  const height = 720;
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return [];

  const sourceFrameWidth = image.naturalWidth / SPRITE_FRAME_COUNT;

  return Array.from({ length: SPRITE_FRAME_COUNT }, (_, frame) => {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    const frameAspect = sourceFrameWidth / Math.max(1, image.naturalHeight);
    const canvasAspect = width / height;
    const drawWidth = frameAspect > canvasAspect ? width : height * frameAspect;
    const drawHeight = frameAspect > canvasAspect ? width / frameAspect : height;
    const drawX = (width - drawWidth) / 2;
    const drawY = (height - drawHeight) / 2;

    context.drawImage(
      image,
      sourceFrameWidth * frame,
      0,
      sourceFrameWidth,
      image.naturalHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );

    return buildMaskSamples(context, width, height);
  });
}

function buildMaskSamples(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): MaskSample[] {
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

      if (darkness > 0.08) {
        raw.push({ darkness, px, py });
        if (darkness > 0.14) {
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
  const span = Math.max(maxX - minX, (maxY - minY) * 1.18);

  return raw.map((sample) => ({
    darkness: sample.darkness,
    x: ((sample.px - midX) / span) * 1.92,
    y: ((sample.py - midY) / span) * 1.46 + 0.02,
  }));
}

function buildTargets(count: number, framesByScene: MaskSample[][][]): Point[][][] {
  if (
    framesByScene.length === STORY_SCENES.length &&
    framesByScene.every((sceneFrames) => sceneFrames.length > 0)
  ) {
    return framesByScene.map((sceneFrames, sceneIndex) =>
      sceneFrames.map((samples) => buildMaskTarget(count, samples, 1400 + sceneIndex * 1800)),
    );
  }

  return STORY_SCENES.map((_, sceneIndex) =>
    Array.from({ length: SPRITE_FRAME_COUNT }, (_, frameIndex) =>
      buildFallbackTarget(count, sceneIndex, frameIndex),
    ),
  );
}

function buildMaskTarget(count: number, samples: MaskSample[], seedBase: number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const sample = pickMaskSample(index, samples, seedBase);
    const jitter = 0.006;

    return {
      darkness: sample.darkness,
      x: sample.x + (seeded(index + seedBase + 31) - 0.5) * jitter,
      y: sample.y + (seeded(index + seedBase + 37) - 0.5) * jitter,
      z: 0.32 + sample.darkness * 0.55 + seeded(index + seedBase + 43) * 0.18,
    };
  });
}

function pickMaskSample(index: number, samples: MaskSample[], seedBase: number): MaskSample {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const sample =
      samples[Math.floor(seeded(index * 13 + seedBase + attempt * 17) * samples.length)];
    if (!sample) continue;
    const roll = seeded(index * 23 + seedBase + attempt * 29);
    if (sample.darkness > roll * 0.9) return sample;
  }

  return (
    samples[Math.floor(seeded(index + seedBase) * samples.length)] ?? { darkness: 0.35, x: 0, y: 0 }
  );
}

function buildFallbackTarget(count: number, scene: number, frame: number): Point[] {
  const cx = scene === 0 ? -0.2 : scene === 1 ? 0.06 : -0.04;
  const cy = scene === 2 ? 0.18 : 0.02;
  const rx = scene === 0 ? 0.66 : scene === 1 ? 0.72 : 0.86;
  const ry = scene === 2 ? 0.34 : 0.58;

  return Array.from({ length: count }, (_, index) => {
    const angle = seeded(index * 3 + scene * 101 + frame * 23) * Math.PI * 2;
    const radius = Math.sqrt(seeded(index * 3 + scene * 131 + frame * 29));
    const wobble = Math.sin(angle * 2.3 + frame * 0.72) * 0.08;

    return {
      darkness: 0.38 + seeded(index + frame * 37) * 0.5,
      x: cx + Math.cos(angle) * rx * radius * (1 + wobble),
      y: cy + Math.sin(angle) * ry * radius * (1 - wobble * 0.5),
      z: 0.35 + (1 - radius) * 0.45 + seeded(index + scene * 211) * 0.18,
    };
  });
}

function particleDrift(
  particle: Particle,
  progress: number,
  local: number,
  seconds: number,
): { x: number; y: number } {
  const path =
    progress * 13 + local * 2.4 + seconds * (0.18 + particle.seed * 0.18) + particle.phase;
  const ribbon = Math.sin(path * (1.15 + particle.seed * 0.42));
  const counter = Math.cos(path * 0.78 + particle.phase * 0.7);
  const strength = 0.002 + particle.lane * 0.007;

  return {
    x:
      ribbon * strength +
      Math.sin(progress * 23 + seconds * 0.3 + particle.phase) * strength * 0.34,
    y: counter * strength * 0.72,
  };
}

function particleCloud(
  particle: Particle,
  progress: number,
  seconds: number,
  fieldWidth: number,
  fieldHeight: number,
): { fade: number; x: number; y: number } {
  const sweep = progress * 1.6 + seconds * (0.035 + particle.seed * 0.022);
  const ribbon = Math.sin(particle.phase + sweep * 2.1);
  const counter = Math.cos(particle.phase * 0.7 + sweep * 1.4);
  const diagonal = (particle.homeX - particle.homeY) * 0.12;
  const lanePush = (particle.lane - 0.5) * 0.24;
  const x =
    particle.homeX * fieldWidth * 0.56 +
    diagonal +
    lanePush +
    ribbon * (0.026 + particle.seed * 0.03);
  const y =
    particle.homeY * fieldHeight * 0.5 +
    particle.homeX * 0.14 +
    counter * (0.026 + (1 - particle.seed) * 0.028);
  const centerFalloff =
    1 - clamp((Math.abs(particle.homeX) + Math.abs(particle.homeY)) * 0.24, 0, 0.42);
  const wave = 0.86 + Math.sin(seconds * 0.42 + particle.phase) * 0.14;

  return {
    fade: clamp(centerFalloff * wave, 0.36, 1),
    x,
    y,
  };
}

function paintParticleAtmosphere(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  seconds: number,
) {
  const glow = 0.28 + smoothstep(0.12, 0.42, progress) * 0.38;
  const drift = Math.sin(seconds * 0.08) * width * 0.04;
  const gradient = context.createLinearGradient(drift, 0, width - drift, height);
  gradient.addColorStop(0, `rgba(121,228,255,${0.035 * glow})`);
  gradient.addColorStop(0.5, `rgba(255,255,255,${0.018 * glow})`);
  gradient.addColorStop(1, `rgba(245,199,106,${0.026 * glow})`);

  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
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

function pingPong(value: number) {
  const folded = value % 2;
  return folded > 1 ? 2 - folded : folded;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
