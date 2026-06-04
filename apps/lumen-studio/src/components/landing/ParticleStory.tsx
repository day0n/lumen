'use client';

import { useI18n } from '@/i18n/provider';
import { IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

type SceneKey = 'filming' | 'night' | 'sunbath';

interface StoryScene {
  key: SceneKey;
  side: 'left' | 'right';
  startOffset: number;
  videoSrc: string;
}

interface ParticleStoryProps {
  onHomeIntent?: () => void;
}

type ThreeModule = typeof import('three');
type VideoRecord = {
  texture: import('three').VideoTexture;
  video: HTMLVideoElement;
};

const VIDEO_ASPECT = 16 / 9;

const STORY_SCENES: StoryScene[] = [
  {
    key: 'filming',
    side: 'right',
    startOffset: 0.35,
    videoSrc: '/particle-videos/creator-filming-depth.mp4',
  },
  {
    key: 'night',
    side: 'left',
    startOffset: 0.85,
    videoSrc: '/particle-videos/night-laptop-depth.mp4',
  },
  {
    key: 'sunbath',
    side: 'right',
    startOffset: 0.85,
    videoSrc: '/particle-videos/sunlit-product-depth.mp4',
  },
];

const INTRO_STRIPES = Array.from({ length: 58 }, (_, index) => {
  const x = -250 + index * 34;
  const bend = 410 + Math.sin(index * 0.48) * 54;
  return {
    d: `M ${x} -110 C ${x + bend * 0.12} 160 ${x - bend * 0.74} 430 ${x + bend * 0.34} 990`,
    opacity: 0.2 + (index % 6) * 0.018,
  };
});

const VERTEX_SHADER = `
  attribute vec2 aUv;
  attribute float aSeed;

  uniform sampler2D uTextureA;
  uniform sampler2D uTextureB;
  uniform vec2 uTexelA;
  uniform vec2 uTexelB;
  uniform vec2 uPlaneScale;
  uniform vec2 uMouse;
  uniform float uIntro;
  uniform float uMorph;
  uniform float uPixelRatio;
  uniform float uPointScale;
  uniform float uReducedMotion;
  uniform float uTime;

  varying vec3 vColor;
  varying float vAlpha;

  float luma(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  float ease(float value) {
    return value * value * (3.0 - 2.0 * value);
  }

  float hash11(float value) {
    return fract(sin(value * 127.1) * 43758.5453123);
  }

  float hash21(vec2 value) {
    return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise2(vec2 value) {
    vec2 i = floor(value);
    vec2 f = fract(value);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  vec2 fbmVec2(vec2 value) {
    float x = noise2(value) * 0.58 + noise2(value * 2.07 + 17.0) * 0.28 + noise2(value * 4.13 + 41.0) * 0.14;
    float y = noise2(value + 29.0) * 0.58 + noise2(value * 2.19 + 53.0) * 0.28 + noise2(value * 4.01 + 71.0) * 0.14;
    return vec2(x, y) * 2.0 - 1.0;
  }

  float sourceValue(vec3 color) {
    float value = 1.0 - luma(color);
    value = clamp((value - 0.075) * 1.55, 0.0, 1.0);
    return pow(value, 0.74);
  }

  float sourceEdge(sampler2D textureMap, vec2 uv, vec2 texel) {
    float center = sourceValue(texture2D(textureMap, uv).rgb);
    float left = sourceValue(texture2D(textureMap, clamp(uv + vec2(-texel.x, 0.0), vec2(0.0), vec2(1.0))).rgb);
    float right = sourceValue(texture2D(textureMap, clamp(uv + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).rgb);
    float top = sourceValue(texture2D(textureMap, clamp(uv + vec2(0.0, -texel.y), vec2(0.0), vec2(1.0))).rgb);
    float bottom = sourceValue(texture2D(textureMap, clamp(uv + vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).rgb);
    float gx = right - left;
    float gy = bottom - top;
    float lap = abs(4.0 * center - left - right - top - bottom);
    return smoothstep(0.045, 0.48, sqrt(gx * gx + gy * gy) + lap * 0.34);
  }

  void main() {
    float morphRaw = clamp(uMorph, 0.0, 1.0);
    float morph = ease(morphRaw);
    float intro = ease(clamp(uIntro, 0.0, 1.0));
    float motion = 1.0 - clamp(uReducedMotion, 0.0, 1.0);

    vec4 sampleA = texture2D(uTextureA, aUv);
    vec4 sampleB = texture2D(uTextureB, aUv);
    float valueA = sourceValue(sampleA.rgb);
    float valueB = sourceValue(sampleB.rgb);
    float value = mix(valueA, valueB, morph);
    float edge = mix(sourceEdge(uTextureA, aUv, uTexelA), sourceEdge(uTextureB, aUv, uTexelB), morph);

    float presence = max(smoothstep(0.07, 0.32, value), edge * 0.88);
    float quietPresence = smoothstep(0.035, 0.18, value);
    vec2 centered = position.xy;
    float radial = length(centered * vec2(0.92, 1.2));
    float randA = hash11(aSeed * 17.17 + aUv.x * 19.0);
    float randB = hash11(aSeed * 31.31 + aUv.y * 23.0);
    float randC = hash11(aSeed * 71.13 + 3.0);

    vec2 cloud = vec2(
      (randA - 0.5) * uPlaneScale.x * 1.72 + sin(uTime * 0.09 + aSeed * 11.0) * 0.08,
      (randB - 0.5) * uPlaneScale.y * 1.6 + cos(uTime * 0.08 + aSeed * 7.0) * 0.07
    );
    vec2 imagePosition = vec2(centered.x * uPlaneScale.x, centered.y * uPlaneScale.y);
    vec2 fineFlow = fbmVec2(aUv * 8.0 + vec2(uTime * 0.08, -uTime * 0.055) + aSeed) * (0.01 + value * 0.028);
    vec2 streamFlow = fbmVec2(aUv * 3.5 + aSeed * 2.0 + uTime * 0.06) * (0.03 + edge * 0.045);

    float imageGather = intro * (0.2 + presence * 0.8);
    vec2 xy = mix(cloud, imagePosition, imageGather);
    xy += (fineFlow + streamFlow * (1.0 - presence)) * motion * intro;

    float transition = sin(morphRaw * 3.14159265);
    vec2 transitionAxis = normalize(vec2(0.38 + randA, -0.22 + randB));
    xy += transitionAxis * transition * (0.08 + randC * 0.18) * motion * intro;

    float depth = (value - 0.38) * 0.34 + edge * 0.18 + (randC - 0.5) * 0.035;
    vec2 parallax = uMouse * (0.02 + depth * 0.055) * motion;

    vec4 modelPosition = modelViewMatrix * vec4(xy + parallax, depth, 1.0);
    gl_Position = projectionMatrix * modelPosition;

    float sparkle = smoothstep(0.97, 1.0, hash11(aSeed * 97.0 + floor(uTime * 7.0))) * presence;
    float size = uPointScale * uPixelRatio;
    size *= 0.46 + value * 1.68 + edge * 1.15 + sparkle * 1.5;
    size *= mix(0.58, 1.0, intro) * (0.66 + quietPresence * 0.42);
    gl_PointSize = max(0.35, size);

    vec3 graphite = vec3(0.045, 0.048, 0.05);
    vec3 pencil = vec3(0.2, 0.205, 0.2);
    vec3 paperDust = vec3(0.48, 0.49, 0.47);
    vec3 color = mix(paperDust, pencil, smoothstep(0.025, 0.32, value));
    color = mix(color, graphite, clamp(smoothstep(0.2, 0.88, value) + edge * 0.42, 0.0, 1.0));
    color = mix(color, vec3(0.12, 0.125, 0.12), transition * 0.08 + sparkle * 0.16);

    float fieldFade = 1.0 - smoothstep(0.82, 1.1, radial);
    vColor = color;
    vAlpha = clamp((0.08 + presence * 0.92 + edge * 0.35) * intro * fieldFade, 0.0, 0.96);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    float disc = smoothstep(0.52, 0.18, dist);
    if (disc <= 0.01) discard;
    gl_FragColor = vec4(vColor, vAlpha * disc);
  }
`;

export function ParticleStory({ onHomeIntent }: ParticleStoryProps) {
  const { t, ta, localePath } = useI18n();
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

    let disposed = false;
    let raf = 0;
    let lastDrawTime = 0;
    let lastStateUpdate = 0;
    let progressInitialized = false;
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let renderer: import('three').WebGLRenderer | null = null;
    let scene: import('three').Scene | null = null;
    let camera: import('three').PerspectiveCamera | null = null;
    let geometry: import('three').BufferGeometry | null = null;
    let material: import('three').ShaderMaterial | null = null;
    let points: import('three').Points | null = null;
    let threeModule: ThreeModule | null = null;
    let records: VideoRecord[] = [];
    let stage: HTMLDivElement | null = null;
    let width = 1;
    let height = 1;
    let lastParticleTarget = 0;

    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const setReducedMotion = () => {
      reducedMotion = reduceQuery.matches;
      if (material) material.uniforms.uReducedMotion!.value = reducedMotion ? 1 : 0;
      for (const record of records) {
        if (reducedMotion) {
          record.video.pause();
        } else {
          void record.video.play().catch(() => {});
        }
      }
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

    const init = async () => {
      const THREE = await import('three');
      if (disposed) return;
      threeModule = THREE;

      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        canvas,
        powerPreference: 'high-performance',
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10);
      camera.position.set(0, 0, 2.55);

      const emptyTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      emptyTexture.needsUpdate = true;
      emptyTexture.colorSpace = THREE.SRGBColorSpace;

      material = new THREE.ShaderMaterial({
        depthTest: true,
        depthWrite: false,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        uniforms: {
          uIntro: { value: 0 },
          uMorph: { value: 0 },
          uMouse: { value: new THREE.Vector2(0, 0) },
          uPixelRatio: { value: 1 },
          uPlaneScale: { value: new THREE.Vector2(1, 1) },
          uPointScale: { value: 1.8 },
          uReducedMotion: { value: reducedMotion ? 1 : 0 },
          uTexelA: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
          uTexelB: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
          uTextureA: { value: emptyTexture },
          uTextureB: { value: emptyTexture },
          uTime: { value: 0 },
        },
        vertexShader: VERTEX_SHADER,
      });

      stage = document.createElement('div');
      stage.setAttribute('aria-hidden', 'true');
      Object.assign(stage.style, {
        height: '1px',
        left: '-9999px',
        overflow: 'hidden',
        pointerEvents: 'none',
        position: 'fixed',
        top: '-9999px',
        width: '1px',
      });
      document.body.appendChild(stage);
      records = STORY_SCENES.map((storyScene) => createVideoRecord(THREE, storyScene, stage!));

      resize(THREE);
      updateProgress();
      raf = window.requestAnimationFrame((time) => draw(THREE, time));
    };

    const createVideoRecord = (
      THREE: ThreeModule,
      storyScene: StoryScene,
      parent: HTMLElement,
    ): VideoRecord => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = storyScene.videoSrc;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.playbackRate = 0.64;
      parent.appendChild(video);

      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;

      const tryPlay = () => {
        if (reducedMotion) {
          video.pause();
          return;
        }
        void video.play().catch(() => {
          // Muted autoplay can still be blocked in rare browser states; the first decoded frame remains usable.
        });
      };
      const seekToStartOffset = () => {
        if (!Number.isFinite(video.duration) || video.duration <= storyScene.startOffset + 0.4) {
          return;
        }
        video.currentTime = storyScene.startOffset;
      };
      const skipEmptyLoopHead = () => {
        if (!Number.isFinite(video.duration) || video.duration <= storyScene.startOffset + 0.4) {
          return;
        }
        if (video.currentTime >= video.duration - 0.12) {
          video.currentTime = storyScene.startOffset;
          tryPlay();
        }
      };

      video.addEventListener('loadedmetadata', seekToStartOffset, { once: true });
      video.addEventListener('canplay', tryPlay);
      video.addEventListener('loadeddata', tryPlay);
      video.addEventListener('timeupdate', skipEmptyLoopHead);
      video.load();

      return { texture, video };
    };

    const resize = (THREE: ThreeModule) => {
      if (!renderer || !camera || !material || !scene) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const pixelRatio = Math.min(window.devicePixelRatio || 1, width < 768 ? 1.2 : 1.6);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      material.uniforms.uPixelRatio!.value = pixelRatio;
      material.uniforms.uPointScale!.value = width < 640 ? 2.05 : width < 1024 ? 1.9 : 1.72;
      updatePlaneScale(material, camera, width, height);

      const target = particleTarget(width);
      if (!geometry || Math.abs(target - lastParticleTarget) > target * 0.22) {
        geometry?.dispose();
        if (points) scene.remove(points);
        geometry = buildGeometry(THREE, target);
        lastParticleTarget = target;
        points = new THREE.Points(geometry, material);
        scene.add(points);
      }
    };

    const draw = (THREE: ThreeModule, time: number) => {
      if (disposed) return;
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
      const heroIntro = 1 - smoothstep(0.015, 0.065, progress);
      const particleIntro = smoothstep(0.01, 0.075, progress);
      const story = smoothstep(0.08, 0.14, progress);
      const sceneProgress = clamp((progress - 0.1) / 0.84, 0, 1);
      const scaled = sceneProgress * STORY_SCENES.length;
      const sceneIndex = Math.min(STORY_SCENES.length - 1, Math.floor(scaled));
      const nextSceneIndex = Math.min(STORY_SCENES.length - 1, sceneIndex + 1);
      const local = clamp(scaled - sceneIndex, 0, 1);
      const morph = sceneIndex === nextSceneIndex ? 0 : smoothstep(0.66, 0.98, local);
      const visibleScene = morph > 0.68 ? nextSceneIndex : sceneIndex;
      const now = performance.now();

      if (now - lastStateUpdate > 55) {
        lastStateUpdate = now;
        setPhase({ intro: heroIntro, local, scene: visibleScene, story });
      }

      if (material && renderer && scene && camera) {
        const recordA = records[sceneIndex];
        const recordB = records[nextSceneIndex] ?? recordA;
        if (recordA) {
          material.uniforms.uTextureA!.value = recordA.texture;
          material.uniforms.uTexelA!.value.set(
            1 / Math.max(1, recordA.video.videoWidth || 1280),
            1 / Math.max(1, recordA.video.videoHeight || 720),
          );
        }
        if (recordB) {
          material.uniforms.uTextureB!.value = recordB.texture;
          material.uniforms.uTexelB!.value.set(
            1 / Math.max(1, recordB.video.videoWidth || 1280),
            1 / Math.max(1, recordB.video.videoHeight || 720),
          );
        }
        material.uniforms.uIntro!.value = particleIntro;
        material.uniforms.uMorph!.value = reducedMotion ? 0 : morph;
        material.uniforms.uMouse!.value.set(mouseRef.current.x, mouseRef.current.y);
        material.uniforms.uReducedMotion!.value = reducedMotion ? 1 : 0;
        material.uniforms.uTime!.value = time / 1000;
        renderer.render(scene, camera);
      }

      raf = window.requestAnimationFrame((nextTime) => draw(THREE, nextTime));
    };

    const handleResize = () => {
      if (threeModule) resize(threeModule);
    };

    init();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('mousemove', updateMouse, { passive: true });
    reduceQuery.addEventListener('change', setReducedMotion);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('mousemove', updateMouse);
      reduceQuery.removeEventListener('change', setReducedMotion);
      for (const record of records) {
        record.video.pause();
        record.video.removeAttribute('src');
        record.video.load();
        record.video.remove();
        record.texture.dispose();
      }
      geometry?.dispose();
      material?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss?.();
      stage?.remove();
    };
  }, []);

  const activeScene = STORY_SCENES[phase.scene] ?? STORY_SCENES[0]!;
  const activeSceneText = ta('landing.heroScenes')[phase.scene] ?? '';

  return (
    <section id="story" ref={sectionRef} className="relative h-[1650svh] bg-[#f7f5ef]">
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
            <h1 className="lumen-serif-display text-[38px] font-black leading-[1.02] tracking-normal text-[#111315] md:text-[66px] lg:text-[84px]">
              {t('landing.heroTitleA')}
              <br />
              {t('landing.heroTitleB')}
            </h1>
            <p className="mx-auto mt-5 max-w-[500px] text-[13px] leading-6 tracking-normal text-black/56 md:text-[14px]">
              {t('landing.particleSummary')}
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-2.5">
              <Link
                href={localePath('/home')}
                prefetch
                onFocus={() => onHomeIntent?.()}
                onPointerEnter={() => onHomeIntent?.()}
                onTouchStart={() => onHomeIntent?.()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#111315] px-4 text-[13px] font-bold tracking-normal text-white transition-transform active:scale-[0.98]"
              >
                {t('landing.cta')}
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
            <p className="lumen-serif-display text-[20px] font-black leading-[1.18] tracking-normal text-[#121313] md:text-[28px] lg:text-[34px]">
              <span
                style={{
                  textShadow:
                    '0 2px 16px rgba(255,255,255,0.98), 0 0 42px rgba(255,255,255,0.9)',
                }}
              >
                <RevealText
                  text={activeSceneText}
                  reveal={clamp(phase.local * 1.25 + 0.16, 0, 1)}
                />
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function buildGeometry(THREE: ThreeModule, target: number) {
  const columns = Math.max(128, Math.round(Math.sqrt(target * VIDEO_ASPECT)));
  const rows = Math.max(72, Math.round(columns / VIDEO_ASPECT));
  const count = columns * rows;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const seeds = new Float32Array(count);
  let positionOffset = 0;
  let uvOffset = 0;

  for (let y = 0; y < rows; y += 1) {
    const v = rows === 1 ? 0.5 : y / (rows - 1);
    for (let x = 0; x < columns; x += 1) {
      const index = y * columns + x;
      const u = columns === 1 ? 0.5 : x / (columns - 1);
      const seed = seeded(index + 17);
      const jitterX = (seeded(index + 41) - 0.5) / columns;
      const jitterY = (seeded(index + 73) - 0.5) / rows;
      positions[positionOffset] = u - 0.5 + jitterX * 0.18;
      positions[positionOffset + 1] = 0.5 - v + jitterY * 0.18;
      positions[positionOffset + 2] = 0;
      uvs[uvOffset] = u;
      uvs[uvOffset + 1] = v;
      seeds[index] = seed;
      positionOffset += 3;
      uvOffset += 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geometry;
}

function updatePlaneScale(
  material: import('three').ShaderMaterial,
  camera: import('three').PerspectiveCamera,
  width: number,
  height: number,
) {
  const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
  const visibleWidth = visibleHeight * camera.aspect;
  const viewportAspect = width / Math.max(1, height);
  let planeWidth: number;
  let planeHeight: number;

  if (viewportAspect > VIDEO_ASPECT) {
    planeHeight = visibleHeight * (width < 640 ? 0.72 : 0.84);
    planeWidth = planeHeight * VIDEO_ASPECT;
  } else {
    planeWidth = visibleWidth * (width < 640 ? 1.16 : 0.9);
    planeHeight = planeWidth / VIDEO_ASPECT;
  }

  material.uniforms.uPlaneScale!.value.set(planeWidth, planeHeight);
}

function particleTarget(width: number) {
  if (width < 640) return 18000;
  if (width < 1024) return 44000;
  return 92000;
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
            'repeating-radial-gradient(ellipse at 50% 112%, transparent 0 21px, rgba(0,0,0,0.048) 22px 23px, transparent 24px 40px)',
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
            <stop offset="0%" stopColor="rgba(0,0,0,0.12)" />
            <stop offset="52%" stopColor="rgba(0,0,0,0.06)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.025)" />
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
