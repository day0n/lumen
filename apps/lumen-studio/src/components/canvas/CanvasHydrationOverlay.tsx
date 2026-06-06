'use client';

import { motion } from 'motion/react';
import { Mesh, Program, Renderer, Triangle } from 'ogl';
import type { OGLRenderingContext } from 'ogl';
import { useEffect, useRef } from 'react';

interface CanvasHydrationOverlayProps {
  /** 主提示文案，例如「正在唤醒工作流」 */
  label: string;
  /** 副标题，例如「Loading nodes onto canvas」 */
  hint?: string;
}

interface CompactRingsProps {
  className?: string;
  paused?: boolean;
}

const ringsVertexShader = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const ringsFragmentShader = `#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uPaused;
uniform vec3 uColorA;
uniform vec3 uColorB;

const float PI = 3.14159265359;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

mat2 rotate2d(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

float arcRing(vec2 p, float radius, float thickness, float cut, float phase, float glowFalloff) {
  float d = abs(length(p) - radius);
  float line = 1.0 - smoothstep(thickness, thickness * 1.9, d);
  float glow = exp(-glowFalloff * d);
  float angle = atan(p.y, p.x);
  float sweep = 0.5 + 0.5 * cos(angle * cut - phase);
  float gate = smoothstep(0.34, 0.96, sweep);
  float edge = smoothstep(0.02, 0.52, abs(cos(angle + phase * 0.22)));
  return (line * 1.45 + glow * 0.72) * gate * edge;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
  float t = mix(uTime, 0.0, uPaused);

  p.x *= 0.9;
  p = rotate2d(-0.08 + sin(t * 0.23) * 0.04) * p;

  vec3 color = vec3(0.0);
  float maxLight = 0.0;

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float drift = fract(t * 0.17 + fi * 0.135);
    float radius = 0.2 + fi * 0.065 + drift * 0.045;
    float pulse = 0.64 + 0.36 * sin(t * 1.2 + fi * 0.8);
    float phase = t * (0.9 + fi * 0.07) + fi * 0.82;
    float ring = arcRing(p, radius, 0.0085, 2.4 + fi * 0.28, phase, 24.0) * pulse;
    vec3 ringColor = mix(uColorA, uColorB, fi / 5.0);
    color += ringColor * ring;
    maxLight = max(maxLight, ring);
  }

  float centerShade = smoothstep(0.08, 0.28, length(p));
  float vignette = 1.0 - smoothstep(0.62, 0.84, length(p));
  float grain = hash21(frag + vec2(t * 77.0, -t * 39.0)) - 0.5;

  color *= centerShade * vignette;
  color += grain * 0.028;
  color = clamp(color, 0.0, 1.0);

  float alpha = clamp(maxLight * 0.72 * centerShade * vignette, 0.0, 0.92);
  fragColor = vec4(color, alpha);
}
`;

const RING_COLOR_A = '#9645e3';
const RING_COLOR_B = '#6366f1';

let warmupPromise: Promise<void> | null = null;

export function warmCanvasHydrationOverlay() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (warmupPromise) return warmupPromise;

  warmupPromise = new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      let renderer: Renderer | null = null;
      try {
        renderer = new Renderer({ alpha: true, antialias: false, dpr: 1 });
        const gl = renderer.gl;
        renderer.setSize(2, 2);

        const program = createRingsProgram(gl);
        const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
        program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
        program.uniforms.uColorA.value = hexToRgb01(RING_COLOR_A);
        program.uniforms.uColorB.value = hexToRgb01(RING_COLOR_B);
        renderer.render({ scene: mesh });

        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // WebGL warmup is best-effort. The visible overlay has its own guarded init path.
      } finally {
        renderer = null;
        resolve();
      }
    });
  });

  return warmupPromise;
}

export function CanvasHydrationOverlay({ label, hint }: CanvasHydrationOverlayProps) {
  const ariaLabel = hint ? `${label}. ${hint}` : label;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      className="pointer-events-auto absolute inset-0 z-[60] overflow-hidden bg-[#030304]"
      // biome-ignore lint/a11y/useSemanticElements: 这是一个进度遮罩，需要 motion.div 才能驱动入退场动画。
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        className="pointer-events-none absolute left-1/2 top-1/2 h-[48px] w-[68px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full"
      >
        <CompactRingsLoadingScene className="absolute inset-[-20px]" />
      </motion.div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, transparent 0%, rgba(3,3,4,0.03) 7%, rgba(3,3,4,0.55) 42%, rgba(3,3,4,0.9) 88%)',
        }}
      />
    </motion.div>
  );
}

function CompactRingsLoadingScene({ className, paused = false }: CompactRingsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const programRef = useRef<Program | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const pausedRef = useRef(paused);
  const reducedMotionRef = useRef(false);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: Renderer;
    try {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer = new Renderer({ alpha: true, antialias: true, dpr });
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

    const program = createRingsProgram(gl);
    programRef.current = program;
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    meshRef.current = mesh;

    program.uniforms.uColorA.value = hexToRgb01(RING_COLOR_A);
    program.uniforms.uColorB.value = hexToRgb01(RING_COLOR_B);
    container.appendChild(gl.canvas);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
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

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateReducedMotion = () => {
      reducedMotionRef.current = motionQuery.matches;
      program.uniforms.uPaused.value = motionQuery.matches ? 1 : 0;
    };
    updateReducedMotion();
    motionQuery.addEventListener('change', updateReducedMotion);

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

      if (!pausedRef.current && !reducedMotionRef.current) accumulatedTime += dt;
      const visible = isVisibleRef.current && !document.hidden;
      if (visible) {
        program.uniforms.uTime.value = accumulatedTime;
        program.uniforms.uPaused.value = pausedRef.current || reducedMotionRef.current ? 1 : 0;
        renderer.render({ scene: mesh });
      }

      animationFrameId = window.requestAnimationFrame(update);
    };

    animationFrameId = window.requestAnimationFrame(update);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
      if (!resizeObserver) globalThis.removeEventListener('resize', resize);
      motionQuery.removeEventListener('change', updateReducedMotion);
      intersectionObserver?.disconnect();
      if (gl.canvas.parentElement === container) {
        container.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      meshRef.current = null;
      programRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className={className} />;
}

function createRingsProgram(gl: OGLRenderingContext) {
  return new Program(gl, {
    vertex: ringsVertexShader,
    fragment: ringsFragmentShader,
    transparent: true,
    uniforms: {
      uResolution: { value: [1, 1] as [number, number] },
      uTime: { value: 0 },
      uPaused: { value: 0 },
      uColorA: { value: hexToRgb01(RING_COLOR_A) },
      uColorB: { value: hexToRgb01(RING_COLOR_B) },
    },
  });
}

function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3)
    h = h
      .split('')
      .map((value) => `${value}${value}`)
      .join('');

  const intValue = Number.parseInt(h, 16);
  if (Number.isNaN(intValue) || (h.length !== 6 && h.length !== 8)) return [1, 1, 1];

  return [((intValue >> 16) & 255) / 255, ((intValue >> 8) & 255) / 255, (intValue & 255) / 255];
}
