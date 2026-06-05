'use client';

import { Mesh, Program, Renderer, Texture, Triangle } from 'ogl';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { OGLRenderingContext } from 'ogl';

interface CanvasHydrationOverlayProps {
  /** 主提示文案，例如「正在唤醒工作流」 */
  label: string;
  /** 副标题，例如「Loading nodes onto canvas」 */
  hint?: string;
}

type Offset = { x?: number | string; y?: number | string };
type AnimationType = 'rotate' | 'rotate3d' | 'hover';

interface PrismaticBurstProps {
  className?: string;
  intensity?: number;
  speed?: number;
  animationType?: AnimationType;
  colors?: string[];
  distort?: number;
  paused?: boolean;
  offset?: Offset;
  hoverDampness?: number;
  rayCount?: number;
  mixBlendMode?: CSSProperties['mixBlendMode'] | 'none';
}

const prismaticVertexShader = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const prismaticFragmentShader = `#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uIntensity;
uniform float uSpeed;
uniform int uAnimType;
uniform vec2 uMouse;
uniform int uColorCount;
uniform float uDistort;
uniform vec2 uOffset;
uniform sampler2D uGradient;
uniform float uNoiseAmount;
uniform int uRayCount;

float hash21(vec2 p) {
  p = floor(p);
  float f = 52.9829189 * fract(dot(p, vec2(0.065, 0.005)));
  return fract(f);
}

mat2 rot30() {
  return mat2(0.8, -0.5, 0.5, 0.8);
}

float layeredNoise(vec2 fragPx) {
  vec2 p = mod(fragPx + vec2(uTime * 30.0, -uTime * 21.0), 1024.0);
  vec2 q = rot30() * p;
  float n = 0.0;
  n += 0.40 * hash21(q);
  n += 0.25 * hash21(q * 2.0 + 17.0);
  n += 0.20 * hash21(q * 4.0 + 47.0);
  n += 0.10 * hash21(q * 8.0 + 113.0);
  n += 0.05 * hash21(q * 16.0 + 191.0);
  return n;
}

vec3 rayDir(vec2 frag, vec2 res, vec2 offset, float dist) {
  float focal = res.y * max(dist, 1e-3);
  return normalize(vec3(2.0 * (frag - offset) - res, focal));
}

float edgeFade(vec2 frag, vec2 res, vec2 offset) {
  vec2 toC = frag - 0.5 * res - offset;
  float r = length(toC) / (0.5 * min(res.x, res.y));
  float x = clamp(r, 0.0, 1.0);
  float q = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
  float s = q * 0.5;
  s = pow(s, 1.5);
  float tail = 1.0 - pow(1.0 - s, 2.0);
  s = mix(s, tail, 0.2);
  float dn = (layeredNoise(frag * 0.15) - 0.5) * 0.0015 * s;
  return clamp(s + dn, 0.0, 1.0);
}

mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotZ(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

vec3 sampleGradient(float t) {
  t = clamp(t, 0.0, 1.0);
  return texture(uGradient, vec2(t, 0.5)).rgb;
}

vec2 rot2(vec2 v, float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c) * v;
}

float bendAngle(vec3 q, float t) {
  float a = 0.8 * sin(q.x * 0.55 + t * 0.6)
    + 0.7 * sin(q.y * 0.50 - t * 0.5)
    + 0.6 * sin(q.z * 0.60 + t * 0.7);
  return a;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float t = uTime * uSpeed;
  float jitterAmp = 0.1 * clamp(uNoiseAmount, 0.0, 1.0);
  vec3 dir = rayDir(frag, uResolution, uOffset, 1.0);
  float marchT = 0.0;
  vec3 col = vec3(0.0);
  float n = layeredNoise(frag);
  vec4 c = cos(t * 0.2 + vec4(0.0, 33.0, 11.0, 0.0));
  mat2 M2 = mat2(c.x, c.y, c.z, c.w);
  float amp = clamp(uDistort, 0.0, 50.0) * 0.15;

  mat3 rot3dMat = mat3(1.0);
  if (uAnimType == 1) {
    vec3 ang = vec3(t * 0.31, t * 0.21, t * 0.17);
    rot3dMat = rotZ(ang.z) * rotY(ang.y) * rotX(ang.x);
  }
  mat3 hoverMat = mat3(1.0);
  if (uAnimType == 2) {
    vec2 m = uMouse * 2.0 - 1.0;
    vec3 ang = vec3(m.y * 0.6, m.x * 0.6, 0.0);
    hoverMat = rotY(ang.y) * rotX(ang.x);
  }

  for (int i = 0; i < 44; ++i) {
    vec3 P = marchT * dir;
    P.z -= 2.0;
    float rad = length(P);
    vec3 Pl = P * (10.0 / max(rad, 1e-6));

    if (uAnimType == 0) {
      Pl.xz *= M2;
    } else if (uAnimType == 1) {
      Pl = rot3dMat * Pl;
    } else {
      Pl = hoverMat * Pl;
    }

    float stepLen = min(rad - 0.3, n * jitterAmp) + 0.1;
    float grow = smoothstep(0.35, 3.0, marchT);
    float a1 = amp * grow * bendAngle(Pl * 0.6, t);
    float a2 = 0.5 * amp * grow * bendAngle(Pl.zyx * 0.5 + 3.1, t * 0.9);
    vec3 Pb = Pl;
    Pb.xz = rot2(Pb.xz, a1);
    Pb.xy = rot2(Pb.xy, a2);

    float rayPattern = smoothstep(
      0.5,
      0.7,
      sin(Pb.x + cos(Pb.y) * cos(Pb.z)) *
        sin(Pb.z + sin(Pb.y) * cos(Pb.x + t))
    );

    if (uRayCount > 0) {
      float ang = atan(Pb.y, Pb.x);
      float comb = 0.5 + 0.5 * cos(float(uRayCount) * ang);
      comb = pow(comb, 3.0);
      rayPattern *= smoothstep(0.15, 0.95, comb);
    }

    vec3 spectralDefault = 1.0 + vec3(
      cos(marchT * 3.0 + 0.0),
      cos(marchT * 3.0 + 1.0),
      cos(marchT * 3.0 + 2.0)
    );

    float saw = fract(marchT * 0.25);
    float tRay = saw * saw * (3.0 - 2.0 * saw);
    vec3 userGradient = 2.0 * sampleGradient(tRay);
    vec3 spectral = (uColorCount > 0) ? userGradient : spectralDefault;
    vec3 base = (0.05 / (0.4 + stepLen))
      * smoothstep(5.0, 0.0, rad)
      * spectral;

    col += base * rayPattern;
    marchT += stepLen;
  }

  col *= edgeFade(frag, uResolution, uOffset);
  col *= uIntensity;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const PRISMATIC_COLORS = ['#A855F7', '#7C3AED', '#6366F1'];

let warmupPromise: Promise<void> | null = null;

export function warmCanvasHydrationOverlay() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (warmupPromise) return warmupPromise;

  warmupPromise = new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      let renderer: Renderer | null = null;
      try {
        renderer = new Renderer({ alpha: false, antialias: false, dpr: 1 });
        const gl = renderer.gl;
        renderer.setSize(2, 2);

        const gradientTex = createGradientTexture(gl, PRISMATIC_COLORS);
        const program = createPrismaticProgram(gl, gradientTex);
        const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
        program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
        program.uniforms.uIntensity.value = 1.6;
        program.uniforms.uSpeed.value = 0.5;
        program.uniforms.uAnimType.value = 1;
        program.uniforms.uColorCount.value = PRISMATIC_COLORS.length;
        program.uniforms.uGradient.value = gradientTex;
        renderer.render({ scene: mesh });

        if (gradientTex.texture) gl.deleteTexture(gradientTex.texture);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // WebGL warmup is best-effort. The visible overlay still has its own guarded init path.
      } finally {
        renderer = null;
        resolve();
      }
    });
  });

  return warmupPromise;
}

/**
 * 画布点开后的过渡 / 等待动画。
 * 设计要点：
 *  - 整屏覆盖深色背景，避免出现"先看到空白画布、再看到节点跳出来"的割裂感。
 *  - 只播放 React Bits Prismatic Burst 的无水印 WebGL 动画，不渲染任何可见文案。
 *  - 退场由父级 AnimatePresence 控制，整体 0.32s 淡出。
 */
export function CanvasHydrationOverlay({ label, hint }: CanvasHydrationOverlayProps) {
  const ariaLabel = hint ? `${label}. ${hint}` : label;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      className="pointer-events-auto absolute inset-0 z-[60] overflow-hidden bg-[#050607]"
      // biome-ignore lint/a11y/useSemanticElements: 这是一个进度遮罩，需要 motion.div 才能驱动入退场动画。
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <PrismaticBurstLoadingScene
        animationType="rotate3d"
        className="absolute inset-0"
        colors={PRISMATIC_COLORS}
        distort={0}
        intensity={2.05}
        mixBlendMode="lighten"
        rayCount={0}
        speed={0.46}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, transparent 0%, rgba(5,6,7,0.08) 44%, rgba(5,6,7,0.72) 88%), linear-gradient(180deg, rgba(5,6,7,0.08), rgba(5,6,7,0.44))',
        }}
      />
    </motion.div>
  );
}

function PrismaticBurstLoadingScene({
  animationType = 'rotate3d',
  className,
  colors,
  distort = 0,
  hoverDampness = 0,
  intensity = 2,
  mixBlendMode = 'lighten',
  offset = { x: 0, y: 0 },
  paused = false,
  rayCount,
  speed = 0.5,
}: PrismaticBurstProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const programRef = useRef<Program | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const gradientTextureRef = useRef<Texture | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const mouseTargetRef = useRef<[number, number]>([0.5, 0.5]);
  const mouseSmoothRef = useRef<[number, number]>([0.5, 0.5]);
  const pausedRef = useRef(paused);
  const hoverDampnessRef = useRef(hoverDampness);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    hoverDampnessRef.current = hoverDampness;
  }, [hoverDampness]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: Renderer;
    try {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer = new Renderer({ alpha: false, antialias: false, dpr });
    } catch {
      return;
    }

    rendererRef.current = renderer;
    const gl = renderer.gl;
    gl.canvas.style.position = 'absolute';
    gl.canvas.style.inset = '0';
    gl.canvas.style.display = 'block';
    gl.canvas.style.height = '100%';
    gl.canvas.style.width = '100%';
    gl.canvas.style.mixBlendMode =
      mixBlendMode && mixBlendMode !== 'none' ? String(mixBlendMode) : '';

    const gradientTexture = createGradientTexture(gl, colors);
    gradientTextureRef.current = gradientTexture;
    const program = createPrismaticProgram(gl, gradientTexture);
    programRef.current = program;

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    meshRef.current = mesh;

    container.appendChild(gl.canvas);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
      mouseTargetRef.current = [clamp01(x), clamp01(y)];
    };

    let resizeObserver: ResizeObserver | null = null;
    const ResizeObserverCtor = window.ResizeObserver;
    if (typeof ResizeObserverCtor === 'function') {
      resizeObserver = new ResizeObserverCtor(resize);
      resizeObserver.observe(container);
    } else {
      globalThis.addEventListener('resize', resize);
    }
    resize();

    container.addEventListener('pointermove', handlePointerMove, { passive: true });

    let intersectionObserver: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry) isVisibleRef.current = entry.isIntersecting;
        },
        { root: null, threshold: 0.01 },
      );
      intersectionObserver.observe(container);
    }

    let animationFrameId = 0;
    let lastTime = performance.now();
    let accumulatedTime = 0;

    const update = (now: number) => {
      const dt = Math.max(0, now - lastTime) * 0.001;
      lastTime = now;

      if (!pausedRef.current) accumulatedTime += dt;
      const visible = isVisibleRef.current && !document.hidden;
      if (visible) {
        const dampness = Math.max(0, Math.min(1, hoverDampnessRef.current));
        const tau = 0.02 + dampness * 0.5;
        const alpha = 1 - Math.exp(-dt / tau);
        const target = mouseTargetRef.current;
        const smooth = mouseSmoothRef.current;
        smooth[0] += (target[0] - smooth[0]) * alpha;
        smooth[1] += (target[1] - smooth[1]) * alpha;

        program.uniforms.uMouse.value = smooth;
        program.uniforms.uTime.value = accumulatedTime;
        renderer.render({ scene: mesh });
      }

      animationFrameId = window.requestAnimationFrame(update);
    };

    animationFrameId = window.requestAnimationFrame(update);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      container.removeEventListener('pointermove', handlePointerMove);
      resizeObserver?.disconnect();
      if (!resizeObserver) globalThis.removeEventListener('resize', resize);
      intersectionObserver?.disconnect();
      if (gl.canvas.parentElement === container) {
        container.removeChild(gl.canvas);
      }
      if (gradientTexture.texture) gl.deleteTexture(gradientTexture.texture);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      meshRef.current = null;
      programRef.current = null;
      rendererRef.current = null;
      gradientTextureRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = rendererRef.current?.gl.canvas;
    if (!canvas) return;
    canvas.style.mixBlendMode =
      mixBlendMode && mixBlendMode !== 'none' ? String(mixBlendMode) : '';
  }, [mixBlendMode]);

  useEffect(() => {
    const program = programRef.current;
    const renderer = rendererRef.current;
    const gradientTexture = gradientTextureRef.current;
    if (!program || !renderer || !gradientTexture) return;

    program.uniforms.uIntensity.value = intensity ?? 1;
    program.uniforms.uSpeed.value = speed ?? 1;
    program.uniforms.uAnimType.value = animationTypeToUniform(animationType);
    program.uniforms.uDistort.value = typeof distort === 'number' ? distort : 0;
    program.uniforms.uOffset.value = [toPx(offset?.x), toPx(offset?.y)];
    program.uniforms.uRayCount.value = Math.max(0, Math.floor(rayCount ?? 0));

    const colorCount = updateGradientTexture(renderer.gl, gradientTexture, colors);
    program.uniforms.uColorCount.value = colorCount;
  }, [animationType, colors, distort, intensity, offset, rayCount, speed]);

  return <div ref={containerRef} className={className} />;
}

function createPrismaticProgram(gl: OGLRenderingContext, gradientTexture: Texture) {
  return new Program(gl, {
    vertex: prismaticVertexShader,
    fragment: prismaticFragmentShader,
    uniforms: {
      uResolution: { value: [1, 1] as [number, number] },
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uSpeed: { value: 1 },
      uAnimType: { value: 1 },
      uMouse: { value: [0.5, 0.5] as [number, number] },
      uColorCount: { value: 0 },
      uDistort: { value: 0 },
      uOffset: { value: [0, 0] as [number, number] },
      uGradient: { value: gradientTexture },
      uNoiseAmount: { value: 0.8 },
      uRayCount: { value: 0 },
    },
  });
}

function createGradientTexture(gl: OGLRenderingContext, colors?: string[]) {
  const texture = new Texture(gl, {
    image: new Uint8Array([255, 255, 255, 255]),
    width: 1,
    height: 1,
    generateMipmaps: false,
    flipY: false,
  });
  texture.minFilter = gl.LINEAR;
  texture.magFilter = gl.LINEAR;
  texture.wrapS = gl.CLAMP_TO_EDGE;
  texture.wrapT = gl.CLAMP_TO_EDGE;
  updateGradientTexture(gl, texture, colors);
  return texture;
}

function updateGradientTexture(
  gl: OGLRenderingContext,
  texture: Texture,
  colors?: string[],
) {
  if (!Array.isArray(colors) || colors.length === 0) return 0;

  const capped = colors.slice(0, 64);
  const data = new Uint8Array(capped.length * 4);
  capped.forEach((color, index) => {
    const [r, g, b] = hexToRgb01(color);
    data[index * 4] = Math.round(r * 255);
    data[index * 4 + 1] = Math.round(g * 255);
    data[index * 4 + 2] = Math.round(b * 255);
    data[index * 4 + 3] = 255;
  });

  texture.image = data;
  texture.width = capped.length;
  texture.height = 1;
  texture.minFilter = gl.LINEAR;
  texture.magFilter = gl.LINEAR;
  texture.wrapS = gl.CLAMP_TO_EDGE;
  texture.wrapT = gl.CLAMP_TO_EDGE;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.format = gl.RGBA;
  texture.type = gl.UNSIGNED_BYTE;
  texture.needsUpdate = true;
  return capped.length;
}

function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map((value) => `${value}${value}`).join('');

  const intValue = Number.parseInt(h, 16);
  if (Number.isNaN(intValue) || (h.length !== 6 && h.length !== 8)) return [1, 1, 1];

  return [
    ((intValue >> 16) & 255) / 255,
    ((intValue >> 8) & 255) / 255,
    (intValue & 255) / 255,
  ];
}

function toPx(value: number | string | undefined) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(String(value).trim().replace('px', ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function animationTypeToUniform(animationType: AnimationType | undefined) {
  if (animationType === 'rotate') return 0;
  if (animationType === 'hover') return 2;
  return 1;
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}
