'use client';

import { motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef } from 'react';

interface CanvasHydrationOverlayProps {
  /** 主提示文案，例如「正在唤醒工作流」 */
  label: string;
  /** 副标题，例如「Loading nodes onto canvas」 */
  hint?: string;
}

const UNICORN_PROJECT_ID = 'QHAXei2EHfwG5QiUIyYK';
const UNICORN_SDK_URL =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.2.1/dist/unicornStudio.umd.js';

type UnicornSceneInstance = {
  destroy?: () => void;
};

type UnicornStudioRuntime = {
  addScene?: (options: {
    elementId: string;
    projectId: string;
    scale?: number;
    dpi?: number;
    fps?: number;
    lazyLoad?: boolean;
    production?: boolean;
    altText?: string;
    ariaLabel?: string;
  }) => Promise<UnicornSceneInstance>;
  init?: () => void;
  isInitialized?: boolean;
};

declare global {
  interface Window {
    UnicornStudio?: UnicornStudioRuntime;
  }
}

let unicornRuntimePromise: Promise<UnicornStudioRuntime> | null = null;

/**
 * 画布点开后的过渡 / 等待动画。
 * 设计要点：
 *  - 整屏覆盖深色磨砂背景，避免出现"先看到空白画布、再看到节点跳出来"的割裂感。
 *  - 视觉上只保留 Unicorn Studio WebGL 场景，不再渲染任何可见文案。
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
      className="pointer-events-auto absolute inset-0 z-[60] flex flex-col items-center justify-center"
      style={{
        background:
          'radial-gradient(circle at 50% 38%, rgba(15,22,30,0.94) 0%, rgba(5,6,7,0.97) 62%)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
      // biome-ignore lint/a11y/useSemanticElements: 这是一个进度遮罩，需要 motion.div 才能驱动入退场动画。
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <div className="relative h-[260px] w-[260px] sm:h-[340px] sm:w-[340px]">
        <motion.div
          className="absolute inset-6 rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(121,228,255,0.18) 0%, rgba(255,117,68,0.14) 38%, transparent 72%)',
            filter: 'blur(38px)',
          }}
          animate={{ scale: [0.88, 1.08, 0.88], opacity: [0.45, 0.78, 0.45] }}
          transition={{ duration: 3.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        />
        <UnicornLoadingScene className="relative h-full w-full" />
      </div>
    </motion.div>
  );
}

function UnicornLoadingScene({ className }: { className?: string }) {
  const reactId = useId();
  const elementId = useMemo(
    () => `lumen-unicorn-loading-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId],
  );
  const sceneRef = useRef<UnicornSceneInstance | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function mountScene() {
      const runtime = await loadUnicornRuntime();
      if (cancelled) return;

      if (runtime.addScene) {
        const scene = await runtime.addScene({
          elementId,
          projectId: UNICORN_PROJECT_ID,
          scale: 1,
          dpi: 1.5,
          fps: 60,
          lazyLoad: false,
          production: true,
          altText: '',
          ariaLabel: '',
        });

        if (cancelled) {
          scene.destroy?.();
          return;
        }
        sceneRef.current = scene;
        return;
      }

      document.getElementById(elementId)?.setAttribute('data-us-project', UNICORN_PROJECT_ID);
      runtime.init?.();
    }

    void mountScene();

    return () => {
      cancelled = true;
      sceneRef.current?.destroy?.();
      sceneRef.current = null;
    };
  }, [elementId]);

  return (
    <div className={className}>
      <div
        id={elementId}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

function loadUnicornRuntime() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Unicorn Studio can only load in the browser'));
  }

  if (window.UnicornStudio?.addScene || window.UnicornStudio?.init) {
    return Promise.resolve(window.UnicornStudio);
  }

  unicornRuntimePromise ??= new Promise<UnicornStudioRuntime>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${UNICORN_SDK_URL}"]`,
    );

    const resolveRuntime = () => {
      const runtime = window.UnicornStudio;
      if (runtime?.addScene || runtime?.init) {
        resolve(runtime);
      } else {
        reject(new Error('Unicorn Studio SDK loaded without a runtime'));
      }
    };

    if (existingScript) {
      existingScript.addEventListener('load', resolveRuntime, { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Unicorn Studio SDK failed')), {
        once: true,
      });
      return;
    }

    window.UnicornStudio = { isInitialized: false };
    const script = document.createElement('script');
    script.src = UNICORN_SDK_URL;
    script.async = true;
    script.onload = resolveRuntime;
    script.onerror = () => reject(new Error('Unicorn Studio SDK failed'));
    document.head.appendChild(script);
  });

  return unicornRuntimePromise;
}
