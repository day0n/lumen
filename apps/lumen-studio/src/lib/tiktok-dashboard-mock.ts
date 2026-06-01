import type { Locale } from '@/i18n/routing';

export type TiktokDashboardRange = '7d' | '14d' | '30d' | '90d';
export type TiktokDashboardRegion = 'global' | 'us' | 'sea' | 'uk' | 'de';
export type TiktokDashboardChannel =
  | 'all'
  | 'spark_ads'
  | 'creator_whitelist'
  | 'retargeting'
  | 'live_boost';
export type TiktokDashboardObjective = 'sales' | 'roas' | 'cold_start' | 'creative_test';

export interface TiktokDashboardQuery {
  range: TiktokDashboardRange;
  region: TiktokDashboardRegion;
  channel: TiktokDashboardChannel;
  objective: TiktokDashboardObjective;
}

export interface TiktokDashboardSummary {
  spend: number;
  revenue: number;
  orders: number;
  impressions: number;
  clicks: number;
  roas: number;
  ctr: number;
  cvr: number;
  cpa: number;
  thumbStop: number;
  watchAvg: number;
  confidence: number;
  forecastRevenue: number;
  spendDelta: number;
  revenueDelta: number;
  roasDelta: number;
  cvrDelta: number;
}

export interface TiktokDailyPoint {
  date: string;
  label: string;
  spend: number;
  revenue: number;
  orders: number;
  ctr: number;
  cvr: number;
  roas: number;
}

export interface TiktokCampaignMetrics {
  spend: number;
  revenue: number;
  orders: number;
  impressions: number;
  clicks: number;
  roas: number;
  ctr: number;
  cvr: number;
  cpa: number;
  thumbStop: number;
  watchAvg: number;
  holdRate: number;
}

export interface TiktokCampaign {
  id: string;
  name: string;
  product: string;
  region: TiktokDashboardRegion;
  regionLabel: string;
  channel: TiktokDashboardChannel;
  channelLabel: string;
  objective: TiktokDashboardObjective;
  status: 'active' | 'learning' | 'paused';
  stage: string;
  budget: number;
  creativeScore: number;
  fatigue: number;
  thumbnail: string;
  hook: string;
  angle: string;
  persona: string;
  materialSource: string;
  sourceDeclaration: string;
  factors: string[];
  metrics: TiktokCampaignMetrics;
}

export interface TiktokFactorRow {
  key: string;
  factor: string;
  module: string;
  signal: string;
  score: number;
  confidence: number;
  ctrLift: number;
  cvrLift: number;
  roasLift: number;
  retentionLift: number;
  diagnosis: string;
}

export interface TiktokFunnelStage {
  key: string;
  label: string;
  value: number;
  rate: number;
  benchmark: number;
}

export interface TiktokRecommendation {
  id: string;
  title: string;
  detail: string;
  impact: string;
  confidence: number;
  effort: string;
  owner: string;
}

export interface TiktokAbTest {
  id: string;
  campaignId: string;
  variant: string;
  hook: string;
  spend: number;
  roas: number;
  cvr: number;
  thumbStop: number;
  lift: number;
  winner: boolean;
}

export interface TiktokGeoBreakdown {
  region: string;
  spend: number;
  revenue: number;
  roas: number;
  orders: number;
  share: number;
}

export interface TiktokTraceEvent {
  id: string;
  stage: string;
  agent: string;
  status: 'done' | 'running' | 'watch';
  latencyMs: number;
  output: string;
}

export interface TiktokDashboardPayload {
  generatedAt: string;
  filters: TiktokDashboardQuery;
  summary: TiktokDashboardSummary;
  timeseries: TiktokDailyPoint[];
  campaigns: TiktokCampaign[];
  factorMatrix: TiktokFactorRow[];
  funnel: TiktokFunnelStage[];
  recommendations: TiktokRecommendation[];
  abTests: TiktokAbTest[];
  geoBreakdown: TiktokGeoBreakdown[];
  trace: TiktokTraceEvent[];
}

interface BaseCampaign {
  id: string;
  name: string;
  product: string;
  region: TiktokDashboardRegion;
  regionLabel: string;
  channel: TiktokDashboardChannel;
  channelLabel: string;
  objective: TiktokDashboardObjective;
  status: TiktokCampaign['status'];
  stage: TiktokCampaign['stage'];
  budget: number;
  creativeScore: number;
  fatigue: number;
  thumbnail: string;
  hook: string;
  angle: string;
  persona: string;
  materialSource: string;
  sourceDeclaration: string;
  factors: string[];
  metrics30d: Omit<TiktokCampaignMetrics, 'roas' | 'ctr' | 'cvr' | 'cpa'>;
}

const CAMPAIGNS: BaseCampaign[] = [
  {
    id: 'camp-glow-serum-ugc',
    name: 'Glow Serum - UGC 3 秒钩子',
    product: 'Vitamin C Glow Serum',
    region: 'us',
    regionLabel: '美国',
    channel: 'spark_ads',
    channelLabel: 'Spark Ads',
    objective: 'sales',
    status: 'active',
    stage: '放量',
    budget: 1850,
    creativeScore: 92,
    fatigue: 18,
    thumbnail:
      'linear-gradient(135deg,#101315 0%,#214c55 48%,#f1c66a 100%),radial-gradient(circle at 28% 18%,rgba(255,255,255,.42),transparent 32%)',
    hook: '素颜上脸前后对比，0.8 秒给出光泽差异',
    angle: '敏感肌也能稳定提亮',
    persona: '25-34 岁通勤女性',
    materialSource: '商家上传主图 + 达人授权公开视频结构化拆解',
    sourceDeclaration: '只保存 Hook/分镜/卖点拆解，不复刻原片',
    factors: ['before_after', 'ugc_voice', 'closeup_texture', 'fast_subtitle'],
    metrics30d: {
      spend: 18240,
      revenue: 81450,
      orders: 1532,
      impressions: 1720000,
      clicks: 68420,
      thumbStop: 42.4,
      watchAvg: 8.9,
      holdRate: 61.2,
    },
  },
  {
    id: 'camp-kitchen-slicer-demo',
    name: 'Kitchen Slicer - 场景痛点演示',
    product: 'Foldable Kitchen Slicer',
    region: 'sea',
    regionLabel: '东南亚',
    channel: 'creator_whitelist',
    channelLabel: '达人白名单',
    objective: 'roas',
    status: 'learning',
    stage: '冷启动',
    budget: 920,
    creativeScore: 86,
    fatigue: 27,
    thumbnail:
      'linear-gradient(135deg,#111315 0%,#5a7350 48%,#f3e4a6 100%),radial-gradient(circle at 74% 18%,rgba(255,255,255,.34),transparent 30%)',
    hook: '切菜失败镜头开场，立即切到一键切丝',
    angle: '租房小厨房也能省空间',
    persona: '年轻家庭和独居人群',
    materialSource: '商品视频切片 + 平台公开评论摘要',
    sourceDeclaration: '评论仅做语义聚类，未展示用户身份',
    factors: ['problem_first', 'product_demo', 'price_anchor', 'cta_coupon'],
    metrics30d: {
      spend: 9720,
      revenue: 52210,
      orders: 2148,
      impressions: 1184000,
      clicks: 48150,
      thumbStop: 39.8,
      watchAvg: 7.6,
      holdRate: 57.8,
    },
  },
  {
    id: 'camp-air-fryer-retargeting',
    name: 'Air Fryer - 加购召回短链路',
    product: 'Mini Air Fryer 3.5L',
    region: 'uk',
    regionLabel: '英国',
    channel: 'retargeting',
    channelLabel: '重定向',
    objective: 'roas',
    status: 'active',
    stage: '放量',
    budget: 1320,
    creativeScore: 88,
    fatigue: 34,
    thumbnail:
      'linear-gradient(135deg,#111315 0%,#31485f 52%,#e78355 100%),radial-gradient(circle at 24% 70%,rgba(255,255,255,.32),transparent 34%)',
    hook: '15 秒晚餐成片，字幕同步列出省油量',
    angle: '小户型快速晚餐',
    persona: '有加购行为的厨房小家电用户',
    materialSource: '历史商品图 + AIGC 分镜重渲染',
    sourceDeclaration: '素材来自自有资产库与生成结果',
    factors: ['retargeting', 'time_lapse', 'subtitle_numbers', 'cta_coupon'],
    metrics30d: {
      spend: 14150,
      revenue: 70420,
      orders: 926,
      impressions: 684000,
      clicks: 31240,
      thumbStop: 45.6,
      watchAvg: 9.8,
      holdRate: 66.4,
    },
  },
  {
    id: 'camp-pet-brush-live',
    name: 'Pet Brush - 直播切片加热',
    product: 'Self Cleaning Pet Brush',
    region: 'de',
    regionLabel: '德国',
    channel: 'live_boost',
    channelLabel: 'Live Boost',
    objective: 'cold_start',
    status: 'active',
    stage: '冷启动',
    budget: 760,
    creativeScore: 81,
    fatigue: 21,
    thumbnail:
      'linear-gradient(135deg,#111315 0%,#4a3f63 50%,#79e4ff 100%),radial-gradient(circle at 68% 26%,rgba(255,255,255,.36),transparent 32%)',
    hook: '一键退毛的声音和画面同步放大',
    angle: '换毛季清洁效率',
    persona: '宠物新手与小户型养宠用户',
    materialSource: '直播授权切片 + 商品主图',
    sourceDeclaration: '直播切片为商家自有授权素材',
    factors: ['asmr_hook', 'closeup_texture', 'creator_handheld', 'cta_coupon'],
    metrics30d: {
      spend: 8120,
      revenue: 31880,
      orders: 1188,
      impressions: 934000,
      clicks: 26900,
      thumbStop: 37.2,
      watchAvg: 7.1,
      holdRate: 53.6,
    },
  },
  {
    id: 'camp-vacuum-compare',
    name: 'Handheld Vacuum - 对比测评',
    product: 'Handheld Vacuum Pro',
    region: 'us',
    regionLabel: '美国',
    channel: 'creator_whitelist',
    channelLabel: '达人白名单',
    objective: 'creative_test',
    status: 'learning',
    stage: '复盘',
    budget: 1180,
    creativeScore: 84,
    fatigue: 41,
    thumbnail:
      'linear-gradient(135deg,#111315 0%,#49505a 46%,#a9d3ba 100%),radial-gradient(circle at 72% 18%,rgba(255,255,255,.34),transparent 28%)',
    hook: '车内碎屑清理前后，分屏对比吸力',
    angle: '车载和沙发缝隙清洁',
    persona: '有车家庭和宠物家庭',
    materialSource: '测评脚本 + 自有商品视频切片',
    sourceDeclaration: '对比对象为抽象场景，不引用竞品商标',
    factors: ['split_screen', 'product_demo', 'proof_overlay', 'creator_handheld'],
    metrics30d: {
      spend: 11960,
      revenue: 43860,
      orders: 628,
      impressions: 906000,
      clicks: 28780,
      thumbStop: 35.4,
      watchAvg: 6.8,
      holdRate: 49.2,
    },
  },
  {
    id: 'camp-summer-dress-spark',
    name: 'Summer Dress - 度假风灵感模板',
    product: 'Linen Summer Dress',
    region: 'sea',
    regionLabel: '东南亚',
    channel: 'spark_ads',
    channelLabel: 'Spark Ads',
    objective: 'sales',
    status: 'paused',
    stage: '素材疲劳',
    budget: 640,
    creativeScore: 76,
    fatigue: 68,
    thumbnail:
      'linear-gradient(135deg,#111315 0%,#6b7e8c 50%,#ffc756 100%),radial-gradient(circle at 24% 22%,rgba(255,255,255,.38),transparent 30%)',
    hook: '海边走动转场，材质细节贴近镜头',
    angle: '一件完成通勤到度假',
    persona: '18-30 岁轻时尚用户',
    materialSource: '商品图 + AIGC 场景生成',
    sourceDeclaration: '场景为生成图像，不指向真实地点',
    factors: ['vacation_style', 'closeup_texture', 'soft_bgm', 'creator_handheld'],
    metrics30d: {
      spend: 6320,
      revenue: 18540,
      orders: 412,
      impressions: 548000,
      clicks: 15120,
      thumbStop: 31.6,
      watchAvg: 5.9,
      holdRate: 43.4,
    },
  },
  {
    id: 'camp-led-mirror-cold',
    name: 'LED Mirror - 冷启动 A/B',
    product: 'LED Makeup Mirror',
    region: 'us',
    regionLabel: '美国',
    channel: 'spark_ads',
    channelLabel: 'Spark Ads',
    objective: 'cold_start',
    status: 'learning',
    stage: '冷启动',
    budget: 840,
    creativeScore: 83,
    fatigue: 16,
    thumbnail:
      'linear-gradient(135deg,#111315 0%,#2a4f67 48%,#e2e7ec 100%),radial-gradient(circle at 78% 26%,rgba(255,255,255,.36),transparent 34%)',
    hook: '开灯瞬间切到妆面细节，字幕强调自然光',
    angle: '小空间高显色化妆',
    persona: '学生与租房女性',
    materialSource: '商品主图 + 达人口播脚本模板',
    sourceDeclaration: '达人口播为生成脚本，未复刻真人声音',
    factors: ['lighting_hook', 'fast_subtitle', 'ugc_voice', 'cta_coupon'],
    metrics30d: {
      spend: 7880,
      revenue: 29640,
      orders: 802,
      impressions: 776000,
      clicks: 22340,
      thumbStop: 36.9,
      watchAvg: 6.7,
      holdRate: 51.6,
    },
  },
];

type CampaignCopy = Pick<
  BaseCampaign,
  | 'name'
  | 'regionLabel'
  | 'channelLabel'
  | 'stage'
  | 'hook'
  | 'angle'
  | 'persona'
  | 'materialSource'
  | 'sourceDeclaration'
>;

const REGION_LABELS: Record<Locale, Record<TiktokDashboardRegion, string>> = {
  en: {
    global: 'Global',
    us: 'United States',
    sea: 'Southeast Asia',
    uk: 'United Kingdom',
    de: 'Germany',
  },
  zh: {
    global: '全球',
    us: '美国',
    sea: '东南亚',
    uk: '英国',
    de: '德国',
  },
};

const CHANNEL_LABELS: Record<Locale, Record<TiktokDashboardChannel, string>> = {
  en: {
    all: 'All channels',
    spark_ads: 'Spark Ads',
    creator_whitelist: 'Creator whitelist',
    retargeting: 'Retargeting',
    live_boost: 'Live Boost',
  },
  zh: {
    all: '全部渠道',
    spark_ads: 'Spark Ads',
    creator_whitelist: '达人白名单',
    retargeting: '重定向',
    live_boost: 'Live Boost',
  },
};

const STAGE_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    冷启动: 'Cold start',
    放量: 'Scaling',
    复盘: 'Review',
    素材疲劳: 'Creative fatigue',
  },
  zh: {
    冷启动: '冷启动',
    放量: '放量',
    复盘: '复盘',
    素材疲劳: '素材疲劳',
  },
};

const CAMPAIGN_COPY_EN: Record<string, Partial<CampaignCopy>> = {
  'camp-glow-serum-ugc': {
    name: 'Glow Serum - UGC 3-second hook',
    hook: 'Before/after bare-skin application shows the glow difference in 0.8s',
    angle: 'Stable brightening even for sensitive skin',
    persona: 'Commuting women aged 25-34',
    materialSource: 'Merchant product images + structured breakdown of authorized creator videos',
    sourceDeclaration:
      'Stores only hook, storyboard, and selling-point structure, not the source video',
  },
  'camp-kitchen-slicer-demo': {
    name: 'Kitchen Slicer - problem demo',
    hook: 'Failed chopping opens the spot, then cuts to one-tap julienne prep',
    angle: 'Space saving for small rental kitchens',
    persona: 'Young families and solo living shoppers',
    materialSource: 'Product video clips + public platform review summaries',
    sourceDeclaration: 'Reviews are used only for semantic clustering without user identity',
  },
  'camp-air-fryer-retargeting': {
    name: 'Air Fryer - cart recovery path',
    hook: '15-second dinner edit with captions calling out oil savings',
    angle: 'Fast dinners for small apartments',
    persona: 'Kitchen appliance shoppers with add-to-cart behavior',
    materialSource: 'Historical product images + AI-generated storyboard rerenders',
    sourceDeclaration: 'Assets come from owned library items and generated results',
  },
  'camp-pet-brush-live': {
    name: 'Pet Brush - live clip boost',
    hook: 'The sound and close-up of one-click hair removal are amplified together',
    angle: 'Efficient cleanup during shedding season',
    persona: 'New pet owners and apartment pet households',
    materialSource: 'Authorized live-stream clip + product hero images',
    sourceDeclaration: 'Live clip assets are owned or authorized by the merchant',
  },
  'camp-vacuum-compare': {
    name: 'Handheld Vacuum - comparison review',
    hook: 'Split-screen suction comparison before and after cleaning car crumbs',
    angle: 'Car and sofa gap cleaning',
    persona: 'Car households and pet households',
    materialSource: 'Review script + owned product video clips',
    sourceDeclaration: 'Comparison is an abstract scene and does not cite competitor marks',
  },
  'camp-summer-dress-spark': {
    name: 'Summer Dress - vacation inspiration template',
    hook: 'Beach walking transition with fabric details close to camera',
    angle: 'One piece from commute to vacation',
    persona: 'Light fashion shoppers aged 18-30',
    materialSource: 'Product images + AI-generated lifestyle scenes',
    sourceDeclaration: 'Scenes are generated images and do not identify a real location',
  },
  'camp-led-mirror-cold': {
    name: 'LED Mirror - cold-start A/B',
    hook: 'Light-on moment cuts to makeup detail, captions emphasize natural light',
    angle: 'High color rendering for small spaces',
    persona: 'Students and renters who apply makeup',
    materialSource: 'Product hero images + creator talking-script template',
    sourceDeclaration: 'Creator speech is generated script copy and does not clone a real voice',
  },
};

const FACTORS: TiktokFactorRow[] = [
  {
    key: 'before_after',
    factor: '前后对比开场',
    module: '剧本',
    signal: '0-3 秒停留',
    score: 94,
    confidence: 93,
    ctrLift: 12.6,
    cvrLift: 8.4,
    roasLift: 18.7,
    retentionLift: 11.8,
    diagnosis: '最适合美妆和清洁类，能快速压缩理解成本。',
  },
  {
    key: 'product_demo',
    factor: '真实使用演示',
    module: '素材',
    signal: '点击后成交',
    score: 91,
    confidence: 88,
    ctrLift: 7.8,
    cvrLift: 12.9,
    roasLift: 16.1,
    retentionLift: 8.2,
    diagnosis: '把商品尺度、用法和结果放在同一镜头里，转化更稳。',
  },
  {
    key: 'fast_subtitle',
    factor: '高密度卖点字幕',
    module: '创作',
    signal: '静音播放',
    score: 87,
    confidence: 84,
    ctrLift: 9.4,
    cvrLift: 4.9,
    roasLift: 10.6,
    retentionLift: 5.6,
    diagnosis: '提升静音场景理解，但超过 3 行会损伤留存。',
  },
  {
    key: 'cta_coupon',
    factor: '优惠锚点 CTA',
    module: '投放',
    signal: '加购率',
    score: 84,
    confidence: 82,
    ctrLift: 4.8,
    cvrLift: 11.1,
    roasLift: 13.8,
    retentionLift: -1.2,
    diagnosis: '适合重定向与直播切片，冷启动阶段要弱化价格感。',
  },
  {
    key: 'creator_handheld',
    factor: '手持达人视角',
    module: '素材',
    signal: '评论可信度',
    score: 81,
    confidence: 78,
    ctrLift: 6.2,
    cvrLift: 5.7,
    roasLift: 8.9,
    retentionLift: 6.8,
    diagnosis: '增强真实感，适合和商品细节近景组合。',
  },
  {
    key: 'soft_bgm',
    factor: '轻音乐氛围',
    module: '创作',
    signal: '完播率',
    score: 73,
    confidence: 71,
    ctrLift: 1.2,
    cvrLift: 2.4,
    roasLift: 3.1,
    retentionLift: 7.9,
    diagnosis: '提升观感，但对硬转化贡献弱，需要搭配清晰 CTA。',
  },
  {
    key: 'problem_first',
    factor: '痛点先行',
    module: '剧本',
    signal: '点击率',
    score: 89,
    confidence: 86,
    ctrLift: 13.8,
    cvrLift: 6.6,
    roasLift: 14.9,
    retentionLift: 7.2,
    diagnosis: '适合居家、厨房、清洁类低解释成本商品。',
  },
  {
    key: 'time_lapse',
    factor: '15 秒浓缩过程',
    module: '创作',
    signal: '平均观看',
    score: 86,
    confidence: 80,
    ctrLift: 5.1,
    cvrLift: 8.2,
    roasLift: 12.4,
    retentionLift: 12.7,
    diagnosis: '在小家电和食品类能同时提高留存与转化。',
  },
];

const MODULE_LABELS_EN: Record<string, string> = {
  素材: 'Assets',
  剧本: 'Script',
  创作: 'Creative',
  投放: 'Ads',
};

const FACTOR_COPY_EN: Record<
  string,
  Partial<Pick<TiktokFactorRow, 'factor' | 'signal' | 'diagnosis'>>
> = {
  before_after: {
    factor: 'Before/after opener',
    signal: '0-3s retention',
    diagnosis: 'Best for beauty and cleaning products because it compresses comprehension quickly.',
  },
  product_demo: {
    factor: 'Real-use demo',
    signal: 'Post-click purchase',
    diagnosis: 'Showing scale, usage, and result in one shot makes conversion steadier.',
  },
  fast_subtitle: {
    factor: 'Dense selling-point captions',
    signal: 'Muted playback',
    diagnosis: 'Improves silent-context understanding, but more than three lines hurts retention.',
  },
  cta_coupon: {
    factor: 'Coupon anchor CTA',
    signal: 'Add-to-cart rate',
    diagnosis: 'Works well for retargeting and live clips; soften price cues in cold start.',
  },
  creator_handheld: {
    factor: 'Handheld creator POV',
    signal: 'Comment trust',
    diagnosis: 'Adds authenticity and pairs well with close-up product details.',
  },
  soft_bgm: {
    factor: 'Soft background music',
    signal: 'Completion rate',
    diagnosis: 'Improves viewing comfort, but needs a clear CTA to drive conversion.',
  },
  problem_first: {
    factor: 'Problem-first opening',
    signal: 'Click-through rate',
    diagnosis: 'Fits home, kitchen, and cleaning products with low explanation cost.',
  },
  time_lapse: {
    factor: '15-second compressed process',
    signal: 'Average watch time',
    diagnosis: 'For appliances and food, it improves both retention and conversion.',
  },
};

const FACTOR_LABELS: Record<Locale, Record<string, string>> = {
  en: Object.fromEntries(
    FACTORS.map((factor) => [factor.key, FACTOR_COPY_EN[factor.key]?.factor ?? factor.key]),
  ),
  zh: Object.fromEntries(FACTORS.map((factor) => [factor.key, factor.factor])),
};

export function getTiktokFactorLabel(key: string, locale: Locale): string {
  return FACTOR_LABELS[locale][key] ?? key;
}

const RECOMMENDATIONS: TiktokRecommendation[] = [
  {
    id: 'rec-budget-shift',
    title: '把 18% 预算迁移到 Glow Serum 与 Air Fryer',
    detail: '这两组在前后对比、数字字幕和重定向人群上同时高于基准，预计 7 天 ROAS +0.42。',
    impact: '+$9.6k 收入',
    confidence: 91,
    effort: '低',
    owner: '投放 Agent',
  },
  {
    id: 'rec-slicer-cta',
    title: 'Kitchen Slicer 先保留痛点开场，弱化首屏价格',
    detail: '冷启动人群对演示镜头响应更好，价格锚点后移到第 8 秒可以减少早跳失。',
    impact: '+6.4% 完播',
    confidence: 84,
    effort: '中',
    owner: '剧本 Agent',
  },
  {
    id: 'rec-dress-refresh',
    title: 'Summer Dress 需要更换首帧与 BGM',
    detail: '素材疲劳达到 68%，推荐用“办公室到海边”转场替换纯度假首帧。',
    impact: '-22% CPA',
    confidence: 79,
    effort: '中',
    owner: '剪辑 Agent',
  },
  {
    id: 'rec-pet-localize',
    title: 'Pet Brush 德语字幕要保留拟声词',
    detail: 'ASMR 型开场在德区评论情绪更高，字幕不宜完全翻译成理性卖点。',
    impact: '+4.8% CVR',
    confidence: 76,
    effort: '低',
    owner: '素材 Agent',
  },
];

const RECOMMENDATION_COPY_EN: Record<
  string,
  Partial<Pick<TiktokRecommendation, 'title' | 'detail' | 'impact' | 'effort' | 'owner'>>
> = {
  'rec-budget-shift': {
    title: 'Move 18% budget to Glow Serum and Air Fryer',
    detail:
      'Both groups beat benchmark on before/after, numeric captions, and retargeting audiences. Estimated 7-day ROAS +0.42.',
    impact: '+$9.6k revenue',
    effort: 'Low',
    owner: 'Ads Agent',
  },
  'rec-slicer-cta': {
    title: 'Keep Kitchen Slicer problem opener and soften first-screen pricing',
    detail:
      'Cold-start audiences respond better to demo shots. Move the price anchor to second 8 to reduce early drop-off.',
    impact: '+6.4% completion',
    effort: 'Medium',
    owner: 'Script Agent',
  },
  'rec-dress-refresh': {
    title: 'Refresh the Summer Dress first frame and BGM',
    detail:
      'Creative fatigue reached 68%. Use an office-to-beach transition to replace the pure vacation first frame.',
    impact: '-22% CPA',
    effort: 'Medium',
    owner: 'Editing Agent',
  },
  'rec-pet-localize': {
    title: 'Keep onomatopoeia in Pet Brush German captions',
    detail:
      'ASMR openers earn stronger sentiment in Germany, so captions should not become only rational selling points.',
    impact: '+4.8% CVR',
    effort: 'Low',
    owner: 'Assets Agent',
  },
};

const TRACE: TiktokTraceEvent[] = [
  {
    id: 'trace-ingest',
    stage: '素材入库',
    agent: 'Material Agent',
    status: 'done',
    latencyMs: 1240,
    output: '识别 42 个商品/视频/slice 标签，完成授权来源声明',
  },
  {
    id: 'trace-script',
    stage: '剧本生成',
    agent: 'Script Agent',
    status: 'done',
    latencyMs: 2180,
    output: '生成 6 套 Hook 因子组合，保留 3 条 A/B 候选',
  },
  {
    id: 'trace-render',
    stage: '一键成片',
    agent: 'Editing Agent',
    status: 'done',
    latencyMs: 8760,
    output: '输出 9:16 / 16:9 两个画幅，含字幕、TTS、BGM',
  },
  {
    id: 'trace-ads',
    stage: '投流诊断',
    agent: 'Growth Agent',
    status: 'running',
    latencyMs: 640,
    output: '持续回流生成因子与成交事件，刷新归因置信度',
  },
];

const TRACE_COPY_EN: Record<
  string,
  Partial<Pick<TiktokTraceEvent, 'stage' | 'agent' | 'output'>>
> = {
  'trace-ingest': {
    stage: 'Asset ingest',
    agent: 'Material Agent',
    output: 'Identified 42 product/video/slice tags and completed authorization source notes',
  },
  'trace-script': {
    stage: 'Script generation',
    agent: 'Script Agent',
    output: 'Generated 6 hook-factor combinations and kept 3 A/B candidates',
  },
  'trace-render': {
    stage: 'One-click render',
    agent: 'Editing Agent',
    output: 'Exported 9:16 and 16:9 cuts with captions, TTS, and BGM',
  },
  'trace-ads': {
    stage: 'Ad diagnosis',
    agent: 'Growth Agent',
    output:
      'Continuously maps generation factors to conversion events and refreshes attribution confidence',
  },
};

export function normalizeTiktokDashboardQuery(
  raw: Partial<Record<keyof TiktokDashboardQuery, string | null>>,
): TiktokDashboardQuery {
  return {
    range: readEnum(raw.range, ['7d', '14d', '30d', '90d'], '30d'),
    region: readEnum(raw.region, ['global', 'us', 'sea', 'uk', 'de'], 'global'),
    channel: readEnum(
      raw.channel,
      ['all', 'spark_ads', 'creator_whitelist', 'retargeting', 'live_boost'],
      'all',
    ),
    objective: readEnum(raw.objective, ['sales', 'roas', 'cold_start', 'creative_test'], 'sales'),
  };
}

export function buildTiktokDashboardMock(
  query: TiktokDashboardQuery,
  locale: Locale = 'en',
): TiktokDashboardPayload {
  const days = Number.parseInt(query.range, 10);
  const scale = days / 30;
  const objectiveMultiplier = getObjectiveMultiplier(query.objective);
  const filtered = CAMPAIGNS.filter((campaign) => {
    const regionMatch = query.region === 'global' || campaign.region === query.region;
    const channelMatch = query.channel === 'all' || campaign.channel === query.channel;
    const objectiveMatch =
      query.objective === 'sales' ||
      campaign.objective === query.objective ||
      campaign.objective === 'sales';
    return regionMatch && channelMatch && objectiveMatch;
  });
  const baseCampaigns = filtered.length > 0 ? filtered : CAMPAIGNS.slice(0, 5);
  const campaigns = baseCampaigns.map((campaign, index) =>
    toCampaign(campaign, scale, objectiveMultiplier + index * 0.015, locale),
  );
  const summary = buildSummary(campaigns);
  const timeseries = buildTimeseries(campaigns, days, query);
  const factorMatrix = buildFactors(query, campaigns, locale);
  const funnel = buildFunnel(summary, locale);
  const geoBreakdown = buildGeoBreakdown(campaigns, summary.revenue);
  const abTests = buildAbTests(campaigns, locale);

  return {
    generatedAt: new Date().toISOString(),
    filters: query,
    summary,
    timeseries,
    campaigns,
    factorMatrix,
    funnel,
    recommendations: localizeRecommendations(locale),
    abTests,
    geoBreakdown,
    trace: localizeTrace(locale),
  };
}

function readEnum<T extends string>(
  value: string | null | undefined,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function getObjectiveMultiplier(objective: TiktokDashboardObjective) {
  if (objective === 'roas') return 1.08;
  if (objective === 'cold_start') return 0.86;
  if (objective === 'creative_test') return 0.74;
  return 1;
}

function toCampaign(
  base: BaseCampaign,
  scale: number,
  multiplier: number,
  locale: Locale,
): TiktokCampaign {
  const spend = Math.round(base.metrics30d.spend * scale * (0.92 + multiplier * 0.08));
  const revenue = Math.round(base.metrics30d.revenue * scale * multiplier);
  const orders = Math.max(1, Math.round(base.metrics30d.orders * scale * multiplier));
  const impressions = Math.max(
    1,
    Math.round(base.metrics30d.impressions * scale * (0.96 + multiplier * 0.04)),
  );
  const clicks = Math.max(1, Math.round(base.metrics30d.clicks * scale * multiplier));
  const roas = roundMetric(revenue / Math.max(spend, 1), 2);
  const ctr = roundMetric((clicks / impressions) * 100, 2);
  const cvr = roundMetric((orders / clicks) * 100, 2);
  const cpa = roundMetric(spend / orders, 2);

  return {
    ...localizeCampaignBase(base, locale),
    budget: Math.round(base.budget * multiplier),
    metrics: {
      spend,
      revenue,
      orders,
      impressions,
      clicks,
      roas,
      ctr,
      cvr,
      cpa,
      thumbStop: roundMetric(base.metrics30d.thumbStop * (0.96 + multiplier * 0.04), 1),
      watchAvg: roundMetric(base.metrics30d.watchAvg * (0.96 + multiplier * 0.04), 1),
      holdRate: roundMetric(base.metrics30d.holdRate * (0.96 + multiplier * 0.04), 1),
    },
  };
}

function localizeCampaignBase(base: BaseCampaign, locale: Locale): BaseCampaign {
  const englishCopy = locale === 'en' ? CAMPAIGN_COPY_EN[base.id] : null;
  return {
    ...base,
    ...englishCopy,
    regionLabel: REGION_LABELS[locale][base.region],
    channelLabel: CHANNEL_LABELS[locale][base.channel],
    stage: STAGE_LABELS[locale][base.stage] ?? base.stage,
  };
}

function localizeFactor(factor: TiktokFactorRow, locale: Locale): TiktokFactorRow {
  if (locale === 'zh') return factor;
  const copy = FACTOR_COPY_EN[factor.key];
  return {
    ...factor,
    ...copy,
    module: MODULE_LABELS_EN[factor.module] ?? factor.module,
  };
}

function localizeRecommendations(locale: Locale): TiktokRecommendation[] {
  if (locale === 'zh') return RECOMMENDATIONS;
  return RECOMMENDATIONS.map((recommendation) => ({
    ...recommendation,
    ...RECOMMENDATION_COPY_EN[recommendation.id],
  }));
}

function localizeTrace(locale: Locale): TiktokTraceEvent[] {
  if (locale === 'zh') return TRACE;
  return TRACE.map((event) => ({
    ...event,
    ...TRACE_COPY_EN[event.id],
  }));
}

function buildSummary(campaigns: TiktokCampaign[]): TiktokDashboardSummary {
  const spend = campaigns.reduce((sum, campaign) => sum + campaign.metrics.spend, 0);
  const revenue = campaigns.reduce((sum, campaign) => sum + campaign.metrics.revenue, 0);
  const orders = campaigns.reduce((sum, campaign) => sum + campaign.metrics.orders, 0);
  const impressions = campaigns.reduce((sum, campaign) => sum + campaign.metrics.impressions, 0);
  const clicks = campaigns.reduce((sum, campaign) => sum + campaign.metrics.clicks, 0);
  const roas = roundMetric(revenue / Math.max(spend, 1), 2);
  const ctr = roundMetric((clicks / Math.max(impressions, 1)) * 100, 2);
  const cvr = roundMetric((orders / Math.max(clicks, 1)) * 100, 2);
  const cpa = roundMetric(spend / Math.max(orders, 1), 2);
  const thumbStop = weightedAverage(campaigns, 'thumbStop', 'impressions');
  const watchAvg = weightedAverage(campaigns, 'watchAvg', 'impressions');

  return {
    spend,
    revenue,
    orders,
    impressions,
    clicks,
    roas,
    ctr,
    cvr,
    cpa,
    thumbStop,
    watchAvg,
    confidence: Math.min(96, Math.round(78 + campaigns.length * 2.6 + roas * 1.4)),
    forecastRevenue: Math.round(revenue * (1.12 + Math.min(roas, 6) * 0.012)),
    spendDelta: 8.7,
    revenueDelta: 21.4,
    roasDelta: 13.2,
    cvrDelta: 6.8,
  };
}

function weightedAverage(
  campaigns: TiktokCampaign[],
  metricKey: 'thumbStop' | 'watchAvg',
  weightKey: 'impressions',
) {
  const totalWeight = campaigns.reduce((sum, campaign) => sum + campaign.metrics[weightKey], 0);
  if (totalWeight === 0) return 0;
  const value = campaigns.reduce(
    (sum, campaign) => sum + campaign.metrics[metricKey] * campaign.metrics[weightKey],
    0,
  );
  return roundMetric(value / totalWeight, 1);
}

function buildTimeseries(
  campaigns: TiktokCampaign[],
  days: number,
  query: TiktokDashboardQuery,
): TiktokDailyPoint[] {
  const spendTotal = campaigns.reduce((sum, campaign) => sum + campaign.metrics.spend, 0);
  const revenueTotal = campaigns.reduce((sum, campaign) => sum + campaign.metrics.revenue, 0);
  const ordersTotal = campaigns.reduce((sum, campaign) => sum + campaign.metrics.orders, 0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const seed =
    query.range.length +
    query.region.length * 3 +
    query.channel.length * 5 +
    query.objective.length * 7;
  const weights = Array.from({ length: days }, (_, index) => {
    const weekly = 1 + Math.sin((index + seed) / 2.4) * 0.16;
    const trend = 0.88 + (index / Math.max(days - 1, 1)) * 0.28;
    const pulse = index % 9 === 3 ? 1.16 : 1;
    return weekly * trend * pulse;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  return weights.map((weight, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const ratio = weight / weightTotal;
    const spend = Math.round(spendTotal * ratio);
    const revenue = Math.round(revenueTotal * ratio * (0.94 + weight * 0.05));
    const orders = Math.max(1, Math.round(ordersTotal * ratio * (0.96 + weight * 0.035)));
    const roas = roundMetric(revenue / Math.max(spend, 1), 2);
    return {
      date: date.toISOString().slice(0, 10),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      spend,
      revenue,
      orders,
      ctr: roundMetric(3.4 + Math.sin((index + seed) / 3) * 0.28 + index / days / 3, 2),
      cvr: roundMetric(2.5 + Math.cos((index + seed) / 3.6) * 0.22 + roas / 18, 2),
      roas,
    };
  });
}

function buildFactors(
  query: TiktokDashboardQuery,
  campaigns: TiktokCampaign[],
  locale: Locale,
): TiktokFactorRow[] {
  const activeFactorKeys = new Set(campaigns.flatMap((campaign) => campaign.factors));
  return FACTORS.map((factor, index) => {
    const activeBoost = activeFactorKeys.has(factor.key) ? 1.1 : 0.88;
    const objectiveBoost =
      query.objective === 'roas' && factor.module === '投放'
        ? 1.14
        : query.objective === 'creative_test' && factor.module === '创作'
          ? 1.12
          : 1;
    const boost = activeBoost * objectiveBoost;
    return {
      ...factor,
      score: Math.min(98, Math.round(factor.score * boost)),
      confidence: Math.min(96, Math.round(factor.confidence * (0.98 + campaigns.length * 0.006))),
      ctrLift: roundMetric(factor.ctrLift * boost + index * 0.08, 1),
      cvrLift: roundMetric(factor.cvrLift * boost - index * 0.03, 1),
      roasLift: roundMetric(factor.roasLift * boost + index * 0.06, 1),
      retentionLift: roundMetric(factor.retentionLift * boost, 1),
    };
  })
    .map((factor) => localizeFactor(factor, locale))
    .sort((a, b) => b.roasLift - a.roasLift);
}

const FUNNEL_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    impressions: 'Impressions',
    threeSecondViews: '3s views',
    productClicks: 'Product clicks',
    addToCart: 'Add to cart',
    checkout: 'Checkout',
    orders: 'Orders',
  },
  zh: {
    impressions: '曝光',
    threeSecondViews: '3 秒观看',
    productClicks: '商品点击',
    addToCart: '加购',
    checkout: '结账',
    orders: '成交',
  },
};

function buildFunnel(summary: TiktokDashboardSummary, locale: Locale): TiktokFunnelStage[] {
  const threeSecondViews = Math.round(summary.impressions * (summary.thumbStop / 100));
  const productClicks = summary.clicks;
  const addToCart = Math.round(summary.orders * 2.35);
  const checkout = Math.round(summary.orders * 1.44);
  const labels = FUNNEL_LABELS[locale];
  return [
    {
      key: 'impressions',
      label: labels.impressions ?? 'Impressions',
      value: summary.impressions,
      rate: 100,
      benchmark: 100,
    },
    {
      key: 'threeSecondViews',
      label: labels.threeSecondViews ?? '3s views',
      value: threeSecondViews,
      rate: roundMetric((threeSecondViews / summary.impressions) * 100, 1),
      benchmark: 35,
    },
    {
      key: 'productClicks',
      label: labels.productClicks ?? 'Product clicks',
      value: productClicks,
      rate: roundMetric((productClicks / threeSecondViews) * 100, 1),
      benchmark: 8.6,
    },
    {
      key: 'addToCart',
      label: labels.addToCart ?? 'Add to cart',
      value: addToCart,
      rate: roundMetric((addToCart / productClicks) * 100, 1),
      benchmark: 6.8,
    },
    {
      key: 'checkout',
      label: labels.checkout ?? 'Checkout',
      value: checkout,
      rate: roundMetric((checkout / addToCart) * 100, 1),
      benchmark: 58,
    },
    {
      key: 'orders',
      label: labels.orders ?? 'Orders',
      value: summary.orders,
      rate: roundMetric((summary.orders / checkout) * 100, 1),
      benchmark: 66,
    },
  ];
}

function buildGeoBreakdown(
  campaigns: TiktokCampaign[],
  totalRevenue: number,
): TiktokGeoBreakdown[] {
  const byRegion = new Map<string, { spend: number; revenue: number; orders: number }>();
  for (const campaign of campaigns) {
    const current = byRegion.get(campaign.regionLabel) ?? { spend: 0, revenue: 0, orders: 0 };
    current.spend += campaign.metrics.spend;
    current.revenue += campaign.metrics.revenue;
    current.orders += campaign.metrics.orders;
    byRegion.set(campaign.regionLabel, current);
  }

  return [...byRegion.entries()]
    .map(([region, value]) => ({
      region,
      spend: value.spend,
      revenue: value.revenue,
      roas: roundMetric(value.revenue / Math.max(value.spend, 1), 2),
      orders: value.orders,
      share: roundMetric((value.revenue / Math.max(totalRevenue, 1)) * 100, 1),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function buildAbTests(campaigns: TiktokCampaign[], locale: Locale): TiktokAbTest[] {
  return campaigns.slice(0, 4).flatMap((campaign, index) => {
    const base = campaign.metrics;
    return [
      {
        id: `${campaign.id}-a`,
        campaignId: campaign.id,
        variant: 'A',
        hook: campaign.hook,
        spend: Math.round(base.spend * 0.48),
        roas: roundMetric(base.roas * (0.94 + index * 0.02), 2),
        cvr: roundMetric(base.cvr * (0.96 + index * 0.01), 2),
        thumbStop: roundMetric(base.thumbStop * 0.97, 1),
        lift: roundMetric(-2.4 + index * 1.6, 1),
        winner: false,
      },
      {
        id: `${campaign.id}-b`,
        campaignId: campaign.id,
        variant: 'B',
        hook: `${locale === 'zh' ? '强化：' : 'Strengthen: '}${campaign.angle}`,
        spend: Math.round(base.spend * 0.52),
        roas: roundMetric(base.roas * (1.06 + index * 0.015), 2),
        cvr: roundMetric(base.cvr * (1.04 + index * 0.012), 2),
        thumbStop: roundMetric(base.thumbStop * 1.05, 1),
        lift: roundMetric(8.6 + index * 2.1, 1),
        winner: true,
      },
    ];
  });
}

function roundMetric(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
