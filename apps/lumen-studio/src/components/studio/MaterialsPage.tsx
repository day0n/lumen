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
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

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
const SELLING_POINT_KEYS = ['point-1', 'point-2', 'point-3'] as const;

const materialCategories = [
  { id: 'item', icon: IconPhoto, tone: 'from-[#18332d] via-[#234b43] to-[#101616]' },
  { id: 'character', icon: IconUser, tone: 'from-[#31283a] via-[#3f3a55] to-[#15151b]' },
  { id: 'scene', icon: IconPhoto, tone: 'from-[#333018] via-[#4c4720] to-[#17150e]' },
] satisfies Array<{
  id: MaterialAssetCategory;
  icon: typeof IconPhoto;
  tone: string;
}>;

const subcategoryOptions: Record<MaterialAssetCategory, string[]> = {
  item: ['美妆护肤', '家居清洁', '数码配件', '服饰鞋包', '食品饮品', '宠物用品', '运动户外'],
  character: ['口播讲解', '开箱体验', '试用演示', '测评对比', '剧情出镜'],
  scene: ['白底主图', '细节特写', '平铺组合', '生活方式', '使用前后'],
};

export function MaterialsPage() {
  const { locale, t } = useI18n();
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const [activeCategory, setActiveCategory] = useState<MaterialAssetCategory>('item');
  const [assets, setAssets] = useState<MaterialAssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

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
        const response = await fetch('/api/material-assets?limit=300', {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as MaterialAssetsApiResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('materials.readFailed') : payload.error.message);
        }
        setAssets(payload.data.assets.filter(isLibraryAsset));
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
  }, [authLoaded, isSignedIn, locale, requireLogin, t]);

  const visibleAssets = useMemo(
    () => assets.filter((asset) => asset.category === activeCategory),
    [activeCategory, assets],
  );

  const counts = useMemo(() => {
    return materialCategories.reduce(
      (result, category) => {
        result[category.id] = assets.filter((asset) => asset.category === category.id).length;
        return result;
      },
      {} as Record<MaterialAssetCategory, number>,
    );
  }, [assets]);

  const handleDelete = useCallback(
    async (asset: MaterialAssetRecord) => {
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
      setAssets((current) => current.filter((item) => item.id !== asset.id));
    },
    [locale, t],
  );

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1180px] px-6 pb-24 pt-28">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-tight text-white">
              {t('materials.title')}
            </h1>
            <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-white/38">
              {t('materials.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-bold text-[#111315] shadow-[0_16px_34px_rgba(0,0,0,0.28)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
          >
            <IconUpload size={16} stroke={2.3} />
            {t('materials.upload')}
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {materialCategories.map((category) => {
            const Icon = category.icon;
            const active = activeCategory === category.id;
            return (
              <button
                type="button"
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={cn(
                  'group relative min-h-[112px] overflow-hidden rounded-xl p-4 text-left ring-1 transition-colors',
                  active
                    ? 'bg-[#202328] ring-white/18'
                    : 'bg-[#17191b]/88 ring-white/[0.08] hover:bg-[#1d2023]',
                )}
              >
                <span
                  className={cn(
                    'absolute inset-0 bg-gradient-to-br opacity-70 transition-opacity group-hover:opacity-90',
                    category.tone,
                  )}
                />
                <span className="relative flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.12] text-white/80 ring-1 ring-white/[0.08]">
                    <Icon size={19} stroke={2.1} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-white">
                      {t(`materials.categories.${category.id}.title`)}
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 text-white/50">
                      {t(`materials.categories.${category.id}.desc`)}
                    </span>
                  </span>
                  <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] font-bold text-white/62">
                    {counts[category.id] ?? 0}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {loadError ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#2a171a]/72 px-4 py-3 text-[13px] text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
            <IconAlertTriangle size={16} stroke={2.2} />
            {loadError}
          </div>
        ) : null}

        <section className="mt-6">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-[16px] font-bold text-white">
              {t(`materials.categories.${activeCategory}.title`)}
            </h2>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-white/42">
              {visibleAssets.length}
            </span>
          </div>

          {loading ? (
            <div className="flex h-[220px] items-center justify-center rounded-xl bg-white/[0.035] text-[13px] text-white/42 ring-1 ring-white/[0.07]">
              <IconLoader2 size={16} className="mr-2 animate-spin" />
              {t('common.loading')}
            </div>
          ) : visibleAssets.length === 0 ? (
            <div className="flex h-[220px] flex-col items-center justify-center rounded-xl bg-white/[0.035] text-center ring-1 ring-white/[0.07]">
              <IconPhoto size={30} className="text-white/28" stroke={1.8} />
              <div className="mt-3 text-[13px] font-bold text-white/56">{t('materials.empty')}</div>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.08] px-3 text-[12px] font-bold text-white/76 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.13] hover:text-white"
              >
                <IconPlus size={15} stroke={2.4} />
                {t('materials.upload')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {visibleAssets.map((asset) => (
                <MaterialCard key={asset.id} asset={asset} onDelete={() => handleDelete(asset)} />
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
            setAssets((current) => [...uploaded.filter(isLibraryAsset), ...current]);
            if (uploaded[0] && isLibraryAsset(uploaded[0])) {
              setActiveCategory(uploaded[0].category);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function MaterialCard({
  asset,
  onDelete,
}: {
  asset: MaterialAssetRecord;
  onDelete: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const points = asset.metadata?.sellingPoints ?? [];
  return (
    <article className="group overflow-hidden rounded-xl bg-[#17191b] ring-1 ring-white/[0.08] transition-colors hover:bg-[#1d2023]">
      <button
        type="button"
        onClick={() => window.open(asset.url, '_blank', 'noopener,noreferrer')}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-[#24272a]"
      >
        {asset.thumbnailUrl || asset.url ? (
          <img
            src={asset.thumbnailUrl ?? asset.url}
            alt={asset.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-white/26">
            <IconPhoto size={34} stroke={1.8} />
          </span>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/48 px-2 py-1 text-[10px] font-bold text-white/72 backdrop-blur">
          {asset.metadata?.subcategory ?? t(`materials.categories.${asset.category}.title`)}
        </span>
      </button>

      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-white/88">{asset.title}</div>
            <div className="mt-1 truncate text-[11px] text-white/36">
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/34 transition-colors hover:bg-[#ff5d73]/12 hover:text-[#ff9caa] disabled:opacity-45"
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
          <div className="mt-3 flex flex-wrap gap-1.5">
            {points.slice(0, 3).map((point) => (
              <span
                key={point}
                className="max-w-full truncate rounded-lg bg-white/[0.055] px-2 py-1 text-[10.5px] font-medium text-white/48 ring-1 ring-white/[0.06]"
                title={point}
              >
                {point}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
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
  const [category, setCategory] = useState<MaterialAssetCategory>(activeCategory);
  const [title, setTitle] = useState('');
  const [subcategory, setSubcategory] = useState(subcategoryOptions[activeCategory][0] ?? '');
  const [sellingPoints, setSellingPoints] = useState(['', '', '']);
  const [files, setFiles] = useState<UploadPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generatingPoints, setGeneratingPoints] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<UploadPreview[]>([]);

  useEffect(() => {
    setSubcategory(subcategoryOptions[category][0] ?? '');
  }, [category]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

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

  const updatePoint = useCallback((index: number, value: string) => {
    setSellingPoints((current) =>
      current.map((point, pointIndex) => (pointIndex === index ? value : point)),
    );
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
      setSellingPoints([
        payload.data.points[0] ?? '',
        payload.data.points[1] ?? '',
        payload.data.points[2] ?? '',
      ]);
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
    [category, files, locale, onClose, onUploaded, sellingPoints, subcategory, t, title],
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/62 px-4 py-8 backdrop-blur-md">
      <form
        onSubmit={handleSubmit}
        className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-2xl bg-[#141618] p-5 text-white shadow-[0_28px_90px_rgba(0,0,0,0.58)] ring-1 ring-white/[0.1]"
      >
        <div className="flex items-start gap-3">
          <div>
            <h2 className="text-[18px] font-bold text-white">{t('materials.dialogTitle')}</h2>
            <p className="mt-1 text-[12px] text-white/36">
              {t(`materials.categories.${category}.title`)}
            </p>
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

        <div className="mt-5 grid grid-cols-3 gap-2">
          {materialCategories.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={uploading}
              onClick={() => setCategory(item.id)}
              className={cn(
                'h-10 rounded-xl text-[12px] font-bold ring-1 transition-colors disabled:opacity-50',
                category === item.id
                  ? 'bg-white text-[#111315] ring-white'
                  : 'bg-white/[0.055] text-white/56 ring-white/[0.07] hover:bg-white/[0.09] hover:text-white',
              )}
            >
              {t(`materials.categories.${item.id}.title`)}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-white/48">
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
              className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/16 bg-white/[0.035] text-white/42 transition-colors hover:border-white/28 hover:bg-white/[0.06] hover:text-white/72 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <IconPlus size={20} stroke={2.2} />
              <span className="text-[11px] font-bold">{t('materials.pickImages')}</span>
            </button>
            {files.map((file) => (
              <div
                key={file.id}
                className="group relative aspect-square overflow-hidden rounded-xl bg-[#24272a] ring-1 ring-white/[0.08]"
              >
                <img src={file.previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => removeFile(file.id)}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-black/56 text-white/74 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-0"
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
          <span className="mb-2 block text-[12px] font-bold text-white/48">
            {t('materials.name')}
          </span>
          <input
            value={title}
            disabled={uploading}
            onChange={(event) => setTitle(event.target.value)}
            className="h-11 w-full rounded-xl bg-[#0d0f12] px-3 text-[13px] text-white outline-none ring-1 ring-white/[0.08] transition-shadow placeholder:text-white/24 focus:ring-[#79e4ff]/38"
            placeholder={t('materials.namePlaceholder')}
          />
        </label>

        <label className="mt-4 block">
          <span className="mb-2 block text-[12px] font-bold text-white/48">
            {t('materials.subcategory')}
          </span>
          <span className="relative block">
            <select
              value={subcategory}
              disabled={uploading}
              onChange={(event) => setSubcategory(event.target.value)}
              className="h-11 w-full appearance-none rounded-xl bg-[#0d0f12] px-3 pr-10 text-[13px] text-white outline-none ring-1 ring-white/[0.08] focus:ring-[#79e4ff]/38"
            >
              {subcategoryOptions[category].map((option) => (
                <option key={option} value={option} className="bg-[#111315] text-white">
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
            <span className="text-[12px] font-bold text-white/48">
              {t('materials.sellingPoints')}
            </span>
            <button
              type="button"
              disabled={uploading || generatingPoints}
              onClick={handleGeneratePoints}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 text-[11px] font-bold text-white/68 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.11] hover:text-white disabled:opacity-50"
            >
              {generatingPoints ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconSparkles size={14} stroke={2.2} />
              )}
              {t('materials.generatePoints')}
            </button>
          </div>
          <div className="space-y-2">
            {SELLING_POINT_KEYS.map((key, index) => (
              <input
                key={key}
                value={sellingPoints[index] ?? ''}
                disabled={uploading}
                onChange={(event) => updatePoint(index, event.target.value)}
                className="h-11 w-full rounded-xl bg-[#0d0f12] px-3 text-[13px] text-white outline-none ring-1 ring-white/[0.08] transition-shadow placeholder:text-white/24 focus:ring-[#79e4ff]/38"
                placeholder={t('materials.sellingPointPlaceholder', { index: index + 1 })}
              />
            ))}
          </div>
        </div>

        {uploading ? (
          <div className="mt-5 rounded-xl bg-white/[0.045] p-3 ring-1 ring-white/[0.07]">
            <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-white/54">
              <span>{t('materials.uploading')}</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-[#79e4ff] transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl bg-[#2a171a]/72 px-3 py-2 text-[12px] font-medium text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={onClose}
            className="h-10 flex-1 rounded-xl bg-white/[0.07] text-[13px] font-bold text-white/68 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
          >
            {t('common.close')}
          </button>
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-white text-[13px] font-bold text-[#111315] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconCheck size={15} />
            )}
            {t('materials.confirmUpload')}
          </button>
        </div>
      </form>
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

function isLibraryAsset(asset: MaterialAssetRecord): asset is MaterialAssetRecord & {
  category: MaterialAssetCategory;
} {
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
