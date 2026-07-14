import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type LandingLocale = 'en' | 'zh';

const enText = {
  'common.language': 'Language',
  'common.switchToChinese': 'Switch to Chinese',
  'common.switchToEnglish': 'Switch to English',
  'landing.cta': 'Start creating',
  'landing.description':
    'Lumen turns short-video creation into a workflow you can understand, run, and review. It references winning structures, but the story is still about your product.',
  'landing.footerCopy':
    'Turn every spark, decision, and review into a reusable workflow for your next shoppable video.',
  'landing.footerGroups.canvas': 'Project canvas',
  'landing.footerGroups.create': 'Start creating',
  'landing.footerGroups.hotAssets': 'Viral assets',
  'landing.footerGroups.materials': 'Asset library',
  'landing.footerGroups.product': 'Product',
  'landing.footerGroups.resources': 'Library',
  'landing.footerGroups.studio': 'Studio',
  'landing.heroTitleA': 'Turn products into',
  'landing.heroTitleB': 'videos that sell',
  'landing.homeAria': 'Lumen home',
  'landing.particleSummary':
    'Lumen turns products, viral structures, and creative judgment into an editable video workflow so every project leaves reusable learning behind.',
  'landing.sectionTitle': 'From product link, to script, shots, assets, and final video.',
} as const;

const zhText: Record<keyof typeof enText, string> = {
  'common.language': '语言',
  'common.switchToChinese': '切换到中文',
  'common.switchToEnglish': '切换到英文',
  'landing.cta': '开始创造',
  'landing.description':
    'Lumen 把短视频创作拆成可以理解、可以运行、可以复盘的工作流。它参考爆款结构，但最终讲的是你自己的商品。',
  'landing.footerCopy': '把一次灵感、一次判断、一次复盘，都变成下一条带货视频能复用的工作流。',
  'landing.footerGroups.canvas': '项目画布',
  'landing.footerGroups.create': '开始创作',
  'landing.footerGroups.hotAssets': '爆款素材',
  'landing.footerGroups.materials': '素材库',
  'landing.footerGroups.product': 'Product',
  'landing.footerGroups.resources': '素材',
  'landing.footerGroups.studio': '工作室',
  'landing.heroTitleA': '把商品变成',
  'landing.heroTitleB': '会卖货的视频',
  'landing.homeAria': 'Lumen 首页',
  'landing.particleSummary':
    'Lumen 把商品、爆款结构和创作判断变成一条可编辑的视频工作流，让每一次创作都留下下一次可复用的经验。',
  'landing.sectionTitle': '从商品链接，到脚本、镜头、素材和成片。',
};

const enArrays = {
  'landing.heroScenes': [
    'Before, one video meant shooting and editing till dawn.',
    'Now, one link runs from script to final cut in a single pass.',
    'Leave the repetition to the flow, keep the ideas for yourself.',
  ],
  'landing.pillars': ['Product insight', 'Viral structure', 'Creative review'],
} as const;

const zhArrays: Record<keyof typeof enArrays, readonly string[]> = {
  'landing.heroScenes': [
    '以前，一条视频从拍到剪熬到天亮。',
    '现在，一个链接从脚本到成片一次跑通。',
    '重复留给流程，灵感留给你。',
  ],
  'landing.pillars': ['商品理解', '爆款结构', '成片复盘'],
};

export const LANDING_MESSAGES = {
  en: { arrays: enArrays, text: enText },
  zh: { arrays: zhArrays, text: zhText },
} as const;

type LandingTextKey = keyof typeof enText;
type LandingArrayKey = keyof typeof enArrays;

interface LandingI18nValue {
  locale: LandingLocale;
  localePath: (href: string, localeOverride?: LandingLocale) => string;
  setLocale: (locale: LandingLocale) => void;
  t: (key: LandingTextKey) => string;
  ta: (key: LandingArrayKey) => readonly string[];
}

const LandingI18nContext = createContext<LandingI18nValue | null>(null);

export function LandingI18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: LandingLocale;
}) {
  const [locale, setLocaleState] = useState(initialLocale);

  useEffect(() => {
    persistLocale(locale);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback((nextLocale: LandingLocale) => {
    setLocaleState(nextLocale);
    persistLocale(nextLocale);
  }, []);

  const value = useMemo<LandingI18nValue>(
    () => ({
      locale,
      localePath: (href, localeOverride) => localizePath(href, localeOverride ?? locale),
      setLocale,
      t: (key) => LANDING_MESSAGES[locale].text[key],
      ta: (key) => LANDING_MESSAGES[locale].arrays[key],
    }),
    [locale, setLocale],
  );

  return <LandingI18nContext.Provider value={value}>{children}</LandingI18nContext.Provider>;
}

export function useLandingI18n() {
  const value = useContext(LandingI18nContext);
  if (!value) throw new Error('useLandingI18n must be used inside LandingI18nProvider');
  return value;
}

function localizePath(href: string, locale: LandingLocale) {
  if (!href || href.startsWith('#') || /^https?:\/\//i.test(href)) return href;
  const url = new URL(href, 'https://lumen.local');
  const pathname = stripLocalePrefix(url.pathname);
  const localizedPath = locale === 'zh' ? (pathname === '/' ? '/zh' : `/zh${pathname}`) : pathname;
  return `${localizedPath}${url.search}${url.hash}`;
}

function stripLocalePrefix(pathname: string) {
  if (pathname === '/zh' || pathname === '/en') return '/';
  if (pathname.startsWith('/zh/') || pathname.startsWith('/en/')) return pathname.slice(3) || '/';
  return pathname || '/';
}

function persistLocale(locale: LandingLocale) {
  if (typeof document !== 'undefined') {
    document.cookie = `lumen_locale=${locale}; path=/; max-age=31536000; sameSite=lax`;
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('lumen_locale', locale);
  }
}
