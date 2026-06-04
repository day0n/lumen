'use client';

import { Mesh, Program, Renderer, Triangle } from 'ogl';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';

interface CanvasHydrationOverlayProps {
  /** 主提示文案，例如「正在唤醒工作流」 */
  label: string;
  /** 副标题，例如「Loading nodes onto canvas」 */
  hint?: string;
}

interface LineWavesProps {
  className?: string;
  speed?: number;
  innerLineCount?: number;
  outerLineCount?: number;
  warpIntensity?: number;
  rotation?: number;
  edgeFadeWidth?: number;
  colorCycleSpeed?: number;
  brightness?: number;
  color1?: string;
  color2?: string;
  color3?: string;
  enableMouseInteraction?: boolean;
  mouseInfluence?: number;
}

function hexToVec3(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').trim();
  const h =
    normalized.length === 3
      ? normalized
          .split('')
          .map((value) => `${value}${value}`)
          .join('')
      : normalized.padEnd(6, '0').slice(0, 6);

  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
}

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform float uSpeed;
uniform float uInnerLines;
uniform float uOuterLines;
uniform float uWarpIntensity;
uniform float uRotation;
uniform float uEdgeFadeWidth;
uniform float uColorCycleSpeed;
uniform float uBrightness;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec2 uMouse;
uniform float uMouseInfluence;
uniform bool uEnableMouse;

#define HALF_PI 1.5707963

float hashF(float n) {
  return fract(sin(n * 127.1) * 43758.5453123);
}

float smoothNoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hashF(i), hashF(i + 1.0), u);
}

float displaceA(float coord, float t) {
  float result = sin(coord * 2.123) * 0.2;
  result += sin(coord * 3.234 + t * 4.345) * 0.1;
  result += sin(coord * 0.589 + t * 0.934) * 0.5;
  return result;
}

float displaceB(float coord, float t) {
  float result = sin(coord * 1.345) * 0.3;
  result += sin(coord * 2.734 + t * 3.345) * 0.2;
  result += sin(coord * 0.189 + t * 0.934) * 0.3;
  return result;
}

vec2 rotate2D(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  vec2 coords = gl_FragCoord.xy / uResolution.xy;
  coords = coords * 2.0 - 1.0;
  coords = rotate2D(coords, uRotation);

  float halfT = uTime * uSpeed * 0.5;
  float fullT = uTime * uSpeed;

  float mouseWarp = 0.0;
  if (uEnableMouse) {
    vec2 mPos = rotate2D(uMouse * 2.0 - 1.0, uRotation);
    float mDist = length(coords - mPos);
    mouseWarp = uMouseInfluence * exp(-mDist * mDist * 4.0);
  }

  float warpAx = coords.x + displaceA(coords.y, halfT) * uWarpIntensity + mouseWarp;
  float warpAy = coords.y - displaceA(coords.x * cos(fullT) * 1.235, halfT) * uWarpIntensity;
  float warpBx = coords.x + displaceB(coords.y, halfT) * uWarpIntensity + mouseWarp;
  float warpBy = coords.y - displaceB(coords.x * sin(fullT) * 1.235, halfT) * uWarpIntensity;

  vec2 fieldA = vec2(warpAx, warpAy);
  vec2 fieldB = vec2(warpBx, warpBy);
  vec2 blended = mix(fieldA, fieldB, mix(fieldA, fieldB, 0.5));

  float fadeTop = smoothstep(uEdgeFadeWidth, uEdgeFadeWidth + 0.4, blended.y);
  float fadeBottom = smoothstep(-uEdgeFadeWidth, -(uEdgeFadeWidth + 0.4), blended.y);
  float vMask = 1.0 - max(fadeTop, fadeBottom);

  float tileCount = mix(uOuterLines, uInnerLines, vMask);
  float scaledY = blended.y * tileCount;
  float nY = smoothNoise(abs(scaledY));

  float ridge = pow(
    step(abs(nY - blended.x) * 2.0, HALF_PI) * cos(2.0 * (nY - blended.x)),
    5.0
  );

  float lines = 0.0;
  for (float i = 1.0; i < 3.0; i += 1.0) {
    lines += pow(max(fract(scaledY), fract(-scaledY)), i * 2.0);
  }

  float pattern = vMask * lines;

  float cycleT = fullT * uColorCycleSpeed;
  float rChannel = (pattern + lines * ridge) * (cos(blended.y + cycleT * 0.234) * 0.5 + 1.0);
  float gChannel = (pattern + vMask * ridge) * (sin(blended.x + cycleT * 1.745) * 0.5 + 1.0);
  float bChannel = (pattern + lines * ridge) * (cos(blended.x + cycleT * 0.534) * 0.5 + 1.0);

  vec3 col = (rChannel * uColor1 + gChannel * uColor2 + bChannel * uColor3) * uBrightness;
  float alpha = clamp(length(col), 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * 画布点开后的过渡 / 等待动画。
 * 设计要点：
 *  - 整屏覆盖深色背景，避免出现"先看到空白画布、再看到节点跳出来"的割裂感。
 *  - 只播放 React Bits Line Waves 的无水印 WebGL 动画，不渲染任何可见文案。
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
      <LineWavesLoadingScene
        className="absolute inset-0"
        speed={0.22}
        innerLineCount={24}
        outerLineCount={38}
        warpIntensity={0.9}
        rotation={-45}
        edgeFadeWidth={0.03}
        colorCycleSpeed={0.18}
        brightness={0.26}
        color1="#ffffff"
        color2="#dce9ff"
        color3="#fff5df"
        enableMouseInteraction={false}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 52% 50%, transparent 0%, rgba(5,6,7,0.08) 36%, rgba(5,6,7,0.78) 82%), linear-gradient(180deg, rgba(5,6,7,0.2), rgba(5,6,7,0.68))',
        }}
      />
    </motion.div>
  );
}

function LineWavesLoadingScene({
  className,
  speed = 0.3,
  innerLineCount = 32,
  outerLineCount = 36,
  warpIntensity = 1,
  rotation = -45,
  edgeFadeWidth = 0,
  colorCycleSpeed = 1,
  brightness = 0.2,
  color1 = '#ffffff',
  color2 = '#ffffff',
  color3 = '#ffffff',
  enableMouseInteraction = true,
  mouseInfluence = 2,
}: LineWavesProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: false });
    } catch {
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.canvas.style.display = 'block';
    gl.canvas.style.height = '100%';
    gl.canvas.style.width = '100%';

    let currentMouse: [number, number] = [0.5, 0.5];
    let targetMouse: [number, number] = [0.5, 0.5];

    const resize = () => {
      const width = Math.max(1, container.offsetWidth);
      const height = Math.max(1, container.offsetHeight);
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [
        gl.canvas.width,
        gl.canvas.height,
        gl.canvas.width / gl.canvas.height,
      ];
    };

    const handleMouseMove = (event: MouseEvent) => {
      const rect = gl.canvas.getBoundingClientRect();
      targetMouse = [
        (event.clientX - rect.left) / rect.width,
        1 - (event.clientY - rect.top) / rect.height,
      ];
    };

    const handleMouseLeave = () => {
      targetMouse = [0.5, 0.5];
    };

    const geometry = new Triangle(gl);
    const rotationRad = (rotation * Math.PI) / 180;
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1, 1] },
        uSpeed: { value: speed },
        uInnerLines: { value: innerLineCount },
        uOuterLines: { value: outerLineCount },
        uWarpIntensity: { value: warpIntensity },
        uRotation: { value: rotationRad },
        uEdgeFadeWidth: { value: edgeFadeWidth },
        uColorCycleSpeed: { value: colorCycleSpeed },
        uBrightness: { value: brightness },
        uColor1: { value: hexToVec3(color1) },
        uColor2: { value: hexToVec3(color2) },
        uColor3: { value: hexToVec3(color3) },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseInfluence: { value: mouseInfluence },
        uEnableMouse: { value: enableMouseInteraction },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    container.appendChild(gl.canvas);
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener('resize', resize);

    if (enableMouseInteraction) {
      gl.canvas.addEventListener('mousemove', handleMouseMove);
      gl.canvas.addEventListener('mouseleave', handleMouseLeave);
    }

    let animationFrameId = 0;
    const update = (time: number) => {
      animationFrameId = window.requestAnimationFrame(update);
      program.uniforms.uTime.value = time * 0.001;

      if (enableMouseInteraction) {
        currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
        currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
        program.uniforms.uMouse.value[0] = currentMouse[0];
        program.uniforms.uMouse.value[1] = currentMouse[1];
      } else {
        program.uniforms.uMouse.value[0] = 0.5;
        program.uniforms.uMouse.value[1] = 0.5;
      }

      renderer.render({ scene: mesh });
    };
    animationFrameId = window.requestAnimationFrame(update);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      if (enableMouseInteraction) {
        gl.canvas.removeEventListener('mousemove', handleMouseMove);
        gl.canvas.removeEventListener('mouseleave', handleMouseLeave);
      }
      if (gl.canvas.parentElement === container) {
        container.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [
    brightness,
    color1,
    color2,
    color3,
    colorCycleSpeed,
    edgeFadeWidth,
    enableMouseInteraction,
    innerLineCount,
    mouseInfluence,
    outerLineCount,
    rotation,
    speed,
    warpIntensity,
  ]);

  return <div ref={containerRef} className={className} />;
}
