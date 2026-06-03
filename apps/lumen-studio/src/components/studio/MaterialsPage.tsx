'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { useI18n } from '@/i18n/provider';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { cn } from '@/lib/cn';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type {
  Group as ThreeGroup,
  Mesh as ThreeMesh,
  MeshBasicMaterial as ThreeMeshBasicMaterial,
  PlaneGeometry as ThreePlaneGeometry,
  Texture as ThreeTexture,
  WebGLRenderer as ThreeWebGLRenderer,
} from 'three';

type MaterialAssetCategory = 'character' | 'scene' | 'item';
type MaterialAssetKind = 'image' | 'video' | 'audio';

type MaterialAssetRecord = {
  id: string;
  category: MaterialAssetCategory | 'my_assets';
  kind: MaterialAssetKind;
  title: string;
  url: string;
  thumbnailUrl?: string;
  source: 'workflow_result' | 'user_upload' | 'manual';
  contentType?: string;
  size?: number;
  metadata?: {
    subcategory?: string;
    originalName?: string;
    sellingPoints?: string[];
    batchId?: string;
    position?: number;
  };
  createdAt: string;
  updatedAt: string;
};

type LibraryMaterialAsset = MaterialAssetRecord & {
  category: MaterialAssetCategory;
};

type MaterialAssetsApiResponse =
  | {
      ok: true;
      data: {
        assets: MaterialAssetRecord[];
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type SellingPointsApiResponse =
  | {
      ok: true;
      data: {
        points: string[];
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type UploadPreview = {
  id: string;
  file: File;
  previewUrl: string;
};

const MAX_UPLOAD_IMAGES = 9;
type MaterialCategoryConfig = {
  id: MaterialAssetCategory;
  accent: string;
  showcaseImages: readonly string[];
};

type ShowcaseImageSet = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

type ShowcaseMotionState = {
  pointerX: number;
  pointerY: number;
  wheelRotation: number;
};

type MaterialSpiralPanel = {
  mesh: ThreeMesh<ThreePlaneGeometry, ThreeMeshBasicMaterial>;
  material: ThreeMeshBasicMaterial;
  texture: ThreeTexture;
  baseAngle: number;
  baseY: number;
  waveOffset: number;
};

function buildShowcaseImages(images: ShowcaseImageSet) {
  return images.map((image) => `/material-showcase/${image}.webp`);
}

const materialCategories = [
  {
    id: 'item',
    accent: '#79e4ff',
    showcaseImages: buildShowcaseImages([
      'character-01',
      'character-03',
      'character-05',
      'character-07',
      'character-09',
      'character-15',
      'character-19',
      'item-09',
      'scene-02',
      'scene-03',
    ]),
  },
  {
    id: 'character',
    accent: '#ff5fbf',
    showcaseImages: buildShowcaseImages([
      'ai-model-01',
      'ai-model-02',
      'ai-model-03',
      'ai-model-04',
      'ai-model-05',
      'ai-model-06',
      'character-02',
      'item-06',
      'scene-11',
      'scene-18',
    ]),
  },
  {
    id: 'scene',
    accent: '#f5c76a',
    showcaseImages: buildShowcaseImages([
      'character-10',
      'character-11',
      'character-12',
      'character-13',
      'item-02',
      'item-08',
      'item-14',
      'scene-12',
      'scene-14',
      'scene-16',
    ]),
  },
] satisfies MaterialCategoryConfig[];

const accentByCategory: Record<MaterialAssetCategory, string> = {
  item: '#79e4ff',
  character: '#ff5fbf',
  scene: '#f5c76a',
};

const subcategoryOptions: Record<MaterialAssetCategory, string[]> = {
  item: ['美妆护肤', '家居清洁', '数码配件', '服饰鞋包', '食品饮品', '宠物用品', '运动户外'],
  character: ['口播讲解', '开箱体验', '试用演示', '测评对比', '剧情出镜'],
  scene: ['白底主图', '细节特写', '平铺组合', '生活方式', '使用前后'],
};

export function MaterialsPage() {
  const { locale, t } = useI18n();
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const [activeCategory, setActiveCategory] = useState<MaterialAssetCategory>('item');
  const [assetsByCategory, setAssetsByCategory] = useState<
    Partial<Record<MaterialAssetCategory, LibraryMaterialAsset[]>>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const showcaseRef = useRef<HTMLDivElement | null>(null);
  const [showcaseMotion, setShowcaseMotion] = useState<ShowcaseMotionState>({
    pointerX: 0,
    pointerY: 0,
    wheelRotation: 0,
  });

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      requireLogin('/materials');
      return;
    }

    const controller = new AbortController();
    async function loadAssets() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          category: activeCategory,
          limit: '80',
        });
        const response = await fetch(`/api/material-assets?${params.toString()}`, {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as MaterialAssetsApiResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('materials.readFailed') : payload.error.message);
        }
        const libraryAssets = payload.data.assets
          .filter(isLibraryAsset)
          .filter((asset) => asset.category === activeCategory);
        setAssetsByCategory((current) => ({ ...current, [activeCategory]: libraryAssets }));
        setLoadError(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : t('materials.readFailed'));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadAssets();
    return () => controller.abort();
  }, [activeCategory, authLoaded, isSignedIn, locale, requireLogin, t]);

  const visibleAssets = useMemo(
    () => assetsByCategory[activeCategory] ?? [],
    [activeCategory, assetsByCategory],
  );

  const handleShowcasePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = showcaseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    setShowcaseMotion((current) => ({
      ...current,
      pointerX: Math.max(-1, Math.min(1, pointerX)),
      pointerY: Math.max(-1, Math.min(1, pointerY)),
    }));
  }, []);

  const handleShowcasePointerLeave = useCallback(() => {
    setShowcaseMotion((current) => ({ ...current, pointerX: 0, pointerY: 0 }));
  }, []);

  const handleShowcaseWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    setShowcaseMotion((current) => ({
      ...current,
      wheelRotation: current.wheelRotation + event.deltaY * 0.18,
    }));
  }, []);

  const handleDelete = useCallback(
    async (asset: LibraryMaterialAsset) => {
      const response = await fetch(`/api/material-assets/${encodeURIComponent(asset.id)}`, {
        method: 'DELETE',
        headers: { 'x-lumen-locale': locale },
      });
      const payload = (await response.json()) as
        | { ok: true; data: { deleted: true } }
        | { ok: false; error: { message: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? t('materials.deleteFailed') : payload.error.message);
      }
      setAssetsByCategory((current) => ({
        ...current,
        [asset.category]: (current[asset.category] ?? []).filter((item) => item.id !== asset.id),
      }));
    },
    [locale, t],
  );

  const activeAccent = accentByCategory[activeCategory];

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1200px] px-6 pb-24 pt-28">
        <div
          ref={showcaseRef}
          onPointerMove={handleShowcasePointerMove}
          onPointerLeave={handleShowcasePointerLeave}
          onWheel={handleShowcaseWheel}
          className="relative grid min-h-[560px] grid-cols-1 gap-5 overflow-visible md:grid-cols-3"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-[-10vw] top-[-46px] z-0 hidden select-none font-display text-[clamp(6.5rem,15vw,13rem)] font-black uppercase leading-[0.78] tracking-normal text-white/[0.075] md:block"
          >
            MATERIAL
            <br />
            LIBRARY
          </span>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-[-84px_-9vw] z-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-45"
          />
          {materialCategories.map((category, index) => (
            <CategoryCard
              key={category.id}
              category={category}
              index={index}
              active={activeCategory === category.id}
              motionState={showcaseMotion}
              title={t(`materials.categories.${category.id}.title`)}
              onSelect={() => setActiveCategory(category.id)}
            />
          ))}
        </div>

        {loadError ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#2a171a]/72 px-4 py-3 text-[13px] text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
            <IconAlertTriangle size={16} stroke={2.2} />
            {loadError}
          </div>
        ) : null}

        <section className="mt-8">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: activeAccent }}
              />
              <h2 className="text-[18px] font-bold text-white">
                {t(`materials.categories.${activeCategory}.title`)}
              </h2>
              <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-white/[0.05] px-2 text-[12px] font-bold text-white/52 ring-1 ring-white/[0.07]">
                {visibleAssets.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-bold text-[#111315] shadow-[0_14px_34px_-22px_rgba(255,255,255,0.9)] transition-transform active:scale-[0.97]"
            >
              <IconUpload size={16} stroke={2.3} />
              {t('materials.upload')}
            </button>
          </div>

          {loading ? (
            <div className="flex h-[280px] items-center justify-center rounded-[18px] bg-[#1c1e20] text-[13px] text-white/48 ring-1 ring-white/[0.07]">
              <IconLoader2 size={18} className="mr-2 animate-spin" stroke={2.2} />
              {t('common.loading')}
            </div>
          ) : visibleAssets.length === 0 ? (
            <div className="flex h-[300px] flex-col items-center justify-center rounded-[18px] bg-[#1c1e20] text-center ring-1 ring-white/[0.07]">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04] text-white/30 ring-1 ring-white/[0.06]">
                <IconPhoto size={30} stroke={1.6} />
              </span>
              <div className="mt-4 text-[14px] font-semibold text-white/56">
                {t('materials.empty')}
              </div>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/[0.06] px-3.5 text-[12px] font-semibold text-white/78 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white"
              >
                <IconUpload size={15} stroke={2.3} />
                {t('materials.upload')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {visibleAssets.map((asset, index) => (
                <MaterialCard
                  key={asset.id}
                  asset={asset}
                  index={index}
                  onDelete={() => handleDelete(asset)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {uploadOpen ? (
        <UploadMaterialDialog
          activeCategory={activeCategory}
          onClose={() => setUploadOpen(false)}
          onUploaded={(uploaded) => {
            setAssetsByCategory((current) => {
              const next = { ...current };
              for (const asset of uploaded.filter(isLibraryAsset)) {
                next[asset.category] = [asset, ...(next[asset.category] ?? [])];
              }
              return next;
            });
            if (uploaded[0] && isLibraryAsset(uploaded[0])) {
              setActiveCategory(uploaded[0].category);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryCard({
  category,
  index,
  active,
  motionState,
  title,
  onSelect,
}: {
  category: MaterialCategoryConfig;
  index: number;
  active: boolean;
  motionState: ShowcaseMotionState;
  title: string;
  onSelect: () => void;
}) {
  const accent = category.accent;
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);

  const handleMove = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSpot({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, []);

  return (
    <motion.button
      ref={cardRef}
      type="button"
      onClick={onSelect}
      onMouseMove={handleMove}
      onMouseLeave={() => setSpot(null)}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.32, 0.72, 0, 1] }}
      data-testid={`material-category-${category.id}`}
      className={cn(
        'group relative z-10 min-h-[560px] overflow-visible border-0 bg-transparent p-0 text-left transition-transform duration-300 will-change-transform hover:-translate-y-1 focus:outline-none',
        !active && 'opacity-[0.72] hover:opacity-100',
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[-40px] top-[40px] h-[430px] opacity-80 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: `radial-gradient(circle at 50% 46%, ${accent}3d, transparent 64%)` }}
      />
      <MaterialSpiralScene
        images={category.showcaseImages}
        accent={accent}
        index={index}
        active={active}
        motionState={motionState}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-px transition-opacity duration-300"
        style={{
          opacity: spot ? 1 : 0,
          background: spot
            ? `radial-gradient(220px circle at ${spot.x}px ${spot.y}px, ${accent}1f, transparent 70%)`
            : undefined,
        }}
      />

      <span className="pointer-events-none relative z-10 flex h-full min-h-[560px] flex-col justify-end px-4 pb-6">
        <span
          className="block text-center font-display text-[22px] font-extrabold leading-none text-white drop-shadow-[0_1px_18px_rgba(0,0,0,0.66)] transition-opacity duration-300"
          style={{ opacity: active ? 1 : 0.82 }}
        >
          {title}
        </span>
      </span>
    </motion.button>
  );
}

function MaterialSpiralScene({
  images,
  accent,
  index,
  active,
  motionState,
}: {
  images: readonly string[];
  accent: string;
  index: number;
  active: boolean;
  motionState: ShowcaseMotionState;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  const motionRef = useRef(motionState);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    motionRef.current = motionState;
  }, [motionState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || images.length === 0) return;

    let disposed = false;
    let frameId = 0;
    let renderer: ThreeWebGLRenderer | null = null;
    let root: ThreeGroup | null = null;
    let geometry: ThreePlaneGeometry | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const panels: MaterialSpiralPanel[] = [];
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const initialize = async () => {
      const THREE = await import('three');
      if (disposed) return;

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x050708, 3.2, 6.8);

      const localCamera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
      localCamera.position.set(0, 0.02, 4.72);

      const localRenderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      localRenderer.setClearColor(0x000000, 0);
      localRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
      localRenderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer = localRenderer;

      const localRoot = new THREE.Group();
      localRoot.rotation.set(-0.06, index * 0.52, -0.07);
      localRoot.scale.setScalar(activeRef.current ? 1.02 : 0.94);
      root = localRoot;
      scene.add(localRoot);

      geometry = new THREE.PlaneGeometry(0.68, 0.92, 1, 1);
      const loader = new THREE.TextureLoader();
      const anisotropy = Math.min(8, localRenderer.capabilities.getMaxAnisotropy());
      const panelsPerTurn = 8;
      const rowCount = 2;
      const panelCount = panelsPerTurn * rowCount;

      for (let panelIndex = 0; panelIndex < panelCount; panelIndex += 1) {
        const image = images[panelIndex % images.length];
        if (!image) continue;

        const row = Math.floor(panelIndex / panelsPerTurn);
        const slot = panelIndex % panelsPerTurn;
        const baseAngle = (slot / panelsPerTurn) * Math.PI * 2 + row * 0.42 + index * 0.18;
        const radius = 1.02 + row * 0.04;
        const baseY = (1 - row) * 0.76;
        const texture = loader.load(image);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;

        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.92,
          side: THREE.DoubleSide,
          fog: true,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(Math.sin(baseAngle) * radius, baseY, Math.cos(baseAngle) * radius);
        mesh.rotation.y = baseAngle;
        mesh.rotation.z = -0.035 + row * 0.025;
        mesh.renderOrder = panelIndex;
        localRoot.add(mesh);

        panels.push({
          mesh,
          material,
          texture,
          baseAngle,
          baseY,
          waveOffset: panelIndex * 0.48 + index,
        });
      }

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        localRenderer.setSize(width, height, false);
        localCamera.aspect = width / height;
        localCamera.updateProjectionMatrix();
      };

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      resize();

      let autoRotation = index * 0.52;
      let easedRotation = autoRotation;

      const render = (time: number) => {
        if (disposed) return;

        const motion = motionRef.current;
        if (!prefersReducedMotion) {
          autoRotation += activeRef.current ? 0.0048 : 0.0026;
        }
        const targetRotation = autoRotation + motion.wheelRotation * 0.012 + motion.pointerX * 0.46;
        easedRotation += (targetRotation - easedRotation) * 0.075;

        localRoot.rotation.y = easedRotation;
        localRoot.rotation.x += (-motion.pointerY * 0.18 - localRoot.rotation.x) * 0.08;
        localRoot.rotation.z += (-0.07 + motion.pointerX * 0.045 - localRoot.rotation.z) * 0.08;

        const targetScale = activeRef.current ? 1.04 : 0.94;
        const nextScale = localRoot.scale.x + (targetScale - localRoot.scale.x) * 0.08;
        localRoot.scale.setScalar(nextScale);

        const baseOpacity = activeRef.current ? 0.98 : 0.68;
        const waveTime = time * 0.001;
        for (const panel of panels) {
          const facing = (Math.cos(panel.baseAngle + easedRotation) + 1) / 2;
          const panelScale = 0.88 + facing * 0.13;
          panel.mesh.scale.set(panelScale, panelScale, 1);
          panel.mesh.position.y = panel.baseY + Math.sin(waveTime * 0.7 + panel.waveOffset) * 0.025;
          panel.material.opacity = baseOpacity * (0.28 + facing * 0.78);
        }

        localRenderer.render(scene, localCamera);
        frameId = window.requestAnimationFrame(render);
      };

      frameId = window.requestAnimationFrame(render);
    };

    void initialize();

    return () => {
      disposed = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      for (const panel of panels) {
        panel.material.dispose();
        panel.texture.dispose();
      }
      geometry?.dispose();
      if (root) root.clear();
      renderer?.dispose();
    };
  }, [images, index]);

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-[-14px] top-[18px] z-0 h-[500px] overflow-visible"
    >
      <span
        className="absolute inset-x-8 top-[64px] h-[360px] rounded-full opacity-70 blur-3xl"
        style={{ background: `radial-gradient(circle at 50% 48%, ${accent}35, transparent 68%)` }}
      />
      <span className="absolute inset-x-10 top-[46%] h-px bg-gradient-to-r from-transparent via-white/18 to-transparent opacity-70" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        data-testid={`material-spiral-${index}`}
      />
    </span>
  );
}

function MaterialCard({
  asset,
  index,
  onDelete,
}: {
  asset: LibraryMaterialAsset;
  index: number;
  onDelete: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const points = asset.metadata?.sellingPoints ?? [];
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: index * 0.03, ease: [0.32, 0.72, 0, 1] }}
      className="group overflow-hidden rounded-[18px] bg-[#1c1e20] ring-1 ring-white/[0.07] transition-colors hover:bg-[#222528] hover:ring-white/[0.12]"
    >
      <button
        type="button"
        onClick={() => window.open(asset.url, '_blank', 'noopener,noreferrer')}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-black"
      >
        {asset.thumbnailUrl || asset.url ? (
          <img
            src={asset.thumbnailUrl ?? asset.url}
            alt={asset.title}
            decoding="async"
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-white/26">
            <IconPhoto size={34} stroke={1.8} />
          </span>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white/82 backdrop-blur">
          {asset.metadata?.subcategory ?? t(`materials.categories.${asset.category}.title`)}
        </span>
      </button>

      <div className="space-y-3 p-3.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold text-white">{asset.title}</div>
            <div className="mt-1 truncate text-[11px] text-white/38">
              {formatMaterialDate(asset.updatedAt, locale)} · {formatBytes(asset.size)}
            </div>
          </div>
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await onDelete();
              } finally {
                setDeleting(false);
              }
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/32 transition-colors hover:bg-[#ff5d73]/14 hover:text-[#ff9caa] disabled:opacity-45"
            aria-label={t('materials.delete')}
          >
            {deleting ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconTrash size={15} />
            )}
          </button>
        </div>
        {points.length ? (
          <div className="flex flex-wrap gap-1.5">
            {points.slice(0, 3).map((point) => (
              <span
                key={point}
                className="max-w-full truncate rounded-lg bg-white/[0.045] px-2 py-1 text-[10.5px] font-medium text-white/52 ring-1 ring-white/[0.06]"
                title={point}
              >
                {point}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}

function UploadMaterialDialog({
  activeCategory,
  onClose,
  onUploaded,
}: {
  activeCategory: MaterialAssetCategory;
  onClose: () => void;
  onUploaded: (assets: MaterialAssetRecord[]) => void;
}) {
  const { locale, t } = useI18n();
  const category = activeCategory;
  const accent = accentByCategory[category];
  const [title, setTitle] = useState('');
  const [subcategory, setSubcategory] = useState(subcategoryOptions[activeCategory][0] ?? '');
  const [sellingPointsText, setSellingPointsText] = useState('');
  const [files, setFiles] = useState<UploadPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generatingPoints, setGeneratingPoints] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<UploadPreview[]>([]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, uploading]);

  useEffect(() => {
    return () => {
      for (const file of filesRef.current) URL.revokeObjectURL(file.previewUrl);
    };
  }, []);

  const handleAddFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (selected.length === 0) return;

      setFiles((current) => {
        const slots = MAX_UPLOAD_IMAGES - current.length;
        if (slots <= 0) {
          setError(t('materials.maxImages', { count: MAX_UPLOAD_IMAGES }));
          return current;
        }
        const accepted = selected.slice(0, slots).filter((file) => file.type.startsWith('image/'));
        if (accepted.length !== selected.length) {
          setError(t('materials.imageOnly'));
        } else {
          setError(null);
        }
        return [
          ...current,
          ...accepted.map((file) => ({
            id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
            file,
            previewUrl: URL.createObjectURL(file),
          })),
        ];
      });
    },
    [t],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((current) => {
      const target = current.find((file) => file.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((file) => file.id !== id);
    });
  }, []);

  const handleGeneratePoints = useCallback(async () => {
    if (!title.trim()) {
      setError(t('materials.nameRequired'));
      return;
    }
    setGeneratingPoints(true);
    setError(null);
    try {
      const response = await fetch('/api/material-assets/selling-points', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lumen-locale': locale,
        },
        body: JSON.stringify({ title, category, subcategory }),
      });
      const payload = (await response.json()) as SellingPointsApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? t('materials.pointsFailed') : payload.error.message);
      }
      setSellingPointsText(payload.data.points.filter(Boolean).join('\n'));
    } catch (pointError) {
      setError(pointError instanceof Error ? pointError.message : t('materials.pointsFailed'));
    } finally {
      setGeneratingPoints(false);
    }
  }, [category, locale, subcategory, t, title]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!title.trim()) {
        setError(t('materials.nameRequired'));
        return;
      }
      if (files.length === 0) {
        setError(t('materials.fileRequired'));
        return;
      }

      const form = new FormData();
      form.append('title', title.trim());
      form.append('category', category);
      form.append('subcategory', subcategory);
      const sellingPoints = sellingPointsText
        .split(/\r?\n/)
        .map((point) => point.trim())
        .filter(Boolean);
      for (const point of sellingPoints) {
        if (point.trim()) form.append('sellingPoints', point.trim());
      }
      for (const preview of files) form.append('files', preview.file);

      setUploading(true);
      setUploadProgress(0);
      setError(null);
      try {
        const uploaded = await uploadMaterialAssets(form, locale, setUploadProgress);
        onUploaded(uploaded);
        onClose();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : t('materials.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [category, files, locale, onClose, onUploaded, sellingPointsText, subcategory, t, title],
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 px-4 py-8 backdrop-blur-xl">
      <motion.form
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
        onSubmit={handleSubmit}
        className="max-h-[92vh] w-full max-w-[580px] overflow-y-auto rounded-[22px] bg-[#17191c] p-6 text-white shadow-[0_40px_120px_-50px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.09]"
      >
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${accent}1a`, color: accent }}
            >
              <IconUpload size={20} stroke={2.1} />
            </span>
            <div>
              <h2 className="text-[19px] font-bold text-white">{t('materials.dialogTitle')}</h2>
              <p
                className="mt-1.5 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{ backgroundColor: `${accent}1a`, color: accent }}
              >
                {t(`materials.categories.${category}.title`)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-white/44 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
            aria-label={t('common.close')}
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-white/52">
            <span>{t('materials.images')}</span>
            <span>
              {t('materials.uploadedCount', { count: files.length, max: MAX_UPLOAD_IMAGES })}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <button
              type="button"
              disabled={uploading || files.length >= MAX_UPLOAD_IMAGES}
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl bg-white/[0.03] text-white/42 ring-1 ring-dashed ring-white/16 transition-colors hover:bg-white/[0.06] hover:text-white/75 hover:ring-white/30 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <IconPlus size={20} stroke={2.2} />
              <span className="text-[11px] font-semibold">{t('materials.pickImages')}</span>
            </button>
            {files.map((file) => (
              <div
                key={file.id}
                className="group relative aspect-square overflow-hidden rounded-xl bg-black ring-1 ring-white/[0.08]"
              >
                <img src={file.previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => removeFile(file.id)}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-black/60 text-white/78 opacity-0 ring-1 ring-white/[0.14] transition-opacity group-hover:opacity-100 disabled:opacity-0"
                  aria-label={t('common.remove')}
                >
                  <IconX size={13} />
                </button>
              </div>
            ))}
          </div>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            multiple
            onChange={handleAddFiles}
          />
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-[12px] font-semibold text-white/52">
            {t('materials.name')}
          </span>
          <input
            value={title}
            disabled={uploading}
            onChange={(event) => setTitle(event.target.value)}
            className="h-11 w-full rounded-xl bg-[#111315] px-3.5 text-[13px] text-white outline-none ring-1 ring-white/[0.08] transition-colors placeholder:text-white/26 focus:ring-white/24"
            placeholder={t('materials.namePlaceholder')}
          />
        </label>

        <label className="mt-4 block">
          <span className="mb-2 block text-[12px] font-semibold text-white/52">
            {t('materials.subcategory')}
          </span>
          <span className="relative block">
            <select
              value={subcategory}
              disabled={uploading}
              onChange={(event) => setSubcategory(event.target.value)}
              className="h-11 w-full appearance-none rounded-xl bg-[#111315] px-3.5 pr-10 text-[13px] text-white outline-none ring-1 ring-white/[0.08] transition-colors focus:ring-white/24"
            >
              {subcategoryOptions[category].map((option) => (
                <option key={option} value={option} className="bg-[#17191c] text-white">
                  {option}
                </option>
              ))}
            </select>
            <IconChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/36"
            />
          </span>
        </label>

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[12px] font-semibold text-white/52">
              {t('materials.sellingPoints')}
            </span>
            <button
              type="button"
              disabled={uploading || generatingPoints}
              onClick={handleGeneratePoints}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 text-[11px] font-semibold text-white/72 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.09] hover:text-white disabled:opacity-50"
            >
              {generatingPoints ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconSparkles size={14} stroke={2.2} />
              )}
              {t('materials.generatePoints')}
            </button>
          </div>
          <textarea
            value={sellingPointsText}
            disabled={uploading}
            onChange={(event) => setSellingPointsText(event.target.value)}
            className="min-h-[108px] w-full resize-none rounded-xl bg-[#111315] px-3.5 py-3 text-[13px] leading-5 text-white outline-none ring-1 ring-white/[0.08] transition-colors placeholder:text-white/26 focus:ring-white/24"
            placeholder={t('materials.sellingPointPlaceholder')}
          />
        </div>

        {uploading ? (
          <div className="mt-5 rounded-xl bg-white/[0.035] p-3 ring-1 ring-white/[0.07]">
            <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-white/58">
              <span>{t('materials.uploading')}</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${uploadProgress}%`, backgroundColor: accent }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl bg-[#2a171a]/72 px-3 py-2 text-[12px] font-medium text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={onClose}
            className="h-10 flex-1 rounded-xl bg-white/[0.05] text-[13px] font-semibold text-white/72 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.09] hover:text-white disabled:opacity-50"
          >
            {t('common.close')}
          </button>
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-white text-[13px] font-bold text-[#111315] transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            {uploading ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconCheck size={15} stroke={2.4} />
            )}
            {t('materials.confirmUpload')}
          </button>
        </div>
      </motion.form>
    </div>
  );
}

function uploadMaterialAssets(
  form: FormData,
  locale: string,
  onProgress: (progress: number) => void,
): Promise<MaterialAssetRecord[]> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/material-assets');
    request.setRequestHeader('x-lumen-locale', locale);
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        onProgress(35);
        return;
      }
      onProgress(Math.min(96, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      try {
        const payload = JSON.parse(request.responseText) as MaterialAssetsApiResponse;
        if (request.status < 200 || request.status >= 300 || !payload.ok) {
          reject(new Error(payload.ok ? `HTTP ${request.status}` : payload.error.message));
          return;
        }
        onProgress(100);
        resolve(payload.data.assets);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Upload failed'));
      }
    };
    request.onerror = () => reject(new Error('Upload failed'));
    request.send(form);
  });
}

function isLibraryAsset(asset: MaterialAssetRecord): asset is LibraryMaterialAsset {
  return asset.category === 'item' || asset.category === 'character' || asset.category === 'scene';
}

function formatBytes(value?: number) {
  if (!value) return '0 KB';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatMaterialDate(value: string, locale: 'en' | 'zh') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}
