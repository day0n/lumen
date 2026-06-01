/**
 * Seeds Mongo with the mock data the front-end was using as constants.
 *
 * Idempotent: drops existing rows in studio_home_featured_items /
 * studio_hot_videos before inserting. Also clears the corresponding
 * Redis cache keys.
 *
 * Usage:
 *   cd apps/lumen-studio && pnpm seed
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as dotenvConfig } from 'dotenv';

const envFile = resolve(process.cwd(), '.env.local');
if (existsSync(envFile)) {
  dotenvConfig({ path: envFile });
}

import {
  type CreateHomeFeaturedItemInput,
  type CreateHotVideoInput,
  HomeFeaturedRepository,
  HotVideoRepository,
  closeMongoDatabases,
  closeRedisClients,
  getMongoDatabase,
  getRedisClient,
} from '@lumen/db';

const FEATURED: CreateHomeFeaturedItemInput[] = [
  {
    badge: '新功能',
    subtitle: '让创作拥有自主执行力',
    title: 'Agent 模式上线',
    description: '从商品链接到脚本解析、镜头生成和执行计划，Lumen Agent 会把创意拆成可推进的任务。',
    statsLabel: '商品链接 · 脚本解析 · 镜头生成',
    translations: {
      en: {
        badge: 'New',
        subtitle: 'Give creation its own execution engine',
        title: 'Agent mode is live',
        description:
          'From product links to script analysis, shot generation, and execution plans, Lumen Agent turns ideas into actionable tasks.',
        statsLabel: 'Product links · Script analysis · Shot generation',
      },
      zh: {
        badge: '新功能',
        subtitle: '让创作拥有自主执行力',
        title: 'Agent 模式上线',
        description:
          '从商品链接到脚本解析、镜头生成和执行计划，Lumen Agent 会把创意拆成可推进的任务。',
        statsLabel: '商品链接 · 脚本解析 · 镜头生成',
      },
    },
    ctaHref: '/canvas/new?agent=chat',
    coverUrl: '/home-posters/selected/agent-pop.png',
    backgroundCss: 'linear-gradient(135deg, #160d1c 0%, #36204a 48%, #0b0d10 100%)',
    accentColor: '#ff4aa2',
    stills: ['#ff4aa2', '#6f52ff', '#111315'],
    sortOrder: 0,
  },
  {
    badge: '新功能',
    subtitle: '海量素材，随心创作',
    title: '素材库上线',
    description: '商品图、参考视频、品牌元素和可复用镜头统一管理，创作时可以直接拖入画布。',
    statsLabel: '素材分组 · 标签检索 · 画布引用',
    translations: {
      en: {
        badge: 'New',
        subtitle: 'A deep asset library for free-form creation',
        title: 'Asset library is live',
        description:
          'Manage product images, reference videos, brand elements, and reusable shots in one place, then drag them directly into the canvas.',
        statsLabel: 'Asset groups · Tag search · Canvas references',
      },
      zh: {
        badge: '新功能',
        subtitle: '海量素材，随心创作',
        title: '素材库上线',
        description: '商品图、参考视频、品牌元素和可复用镜头统一管理，创作时可以直接拖入画布。',
        statsLabel: '素材分组 · 标签检索 · 画布引用',
      },
    },
    ctaHref: '/canvas/new',
    coverUrl: '/home-posters/selected/material-mythic.png',
    backgroundCss: 'linear-gradient(135deg, #421511 0%, #9f4d34 44%, #0b1b1d 100%)',
    accentColor: '#f1d1a4',
    stills: ['#f1d1a4', '#8f4431', '#67d3df'],
    sortOrder: 1,
  },
  {
    badge: '新功能',
    subtitle: '一键拆解，复刻爆款',
    title: '爆款复刻上线',
    description: '拆解爆款结构、换素材、改风格，再把可执行版本带回你的商品项目。',
    statsLabel: '结构拆解 · 商品改写 · 风格复刻',
    translations: {
      en: {
        badge: 'New',
        subtitle: 'Break down and remix winning videos',
        title: 'Viral Remix is live',
        description:
          'Analyze winning structures, swap assets, shift the style, and bring an executable version back into your product project.',
        statsLabel: 'Structure analysis · Product rewrite · Style remix',
      },
      zh: {
        badge: '新功能',
        subtitle: '一键拆解，复刻爆款',
        title: '爆款复刻上线',
        description: '拆解爆款结构、换素材、改风格，再把可执行版本带回你的商品项目。',
        statsLabel: '结构拆解 · 商品改写 · 风格复刻',
      },
    },
    ctaHref: '/hot-videos',
    coverUrl: '/home-posters/selected/hot-remix-collage.png',
    backgroundCss: 'linear-gradient(135deg, #17110f 0%, #352421 42%, #0b0d10 100%)',
    accentColor: '#f36b5f',
    stills: ['#f36b5f', '#f0c36a', '#111315'],
    sortOrder: 2,
  },
  {
    badge: '新功能',
    subtitle: '自然对话，智能洞察',
    title: 'Agent Chat 上线',
    description: '和 Lumen 直接讨论商品、视频脚本和执行计划，让 Agent 把想法落到画布。',
    statsLabel: '自然对话 · 智能洞察 · 自动执行',
    translations: {
      en: {
        badge: 'New',
        subtitle: 'Natural conversation, sharper insight',
        title: 'Agent Chat is live',
        description:
          'Discuss products, scripts, and execution plans with Lumen, then let Agent turn the idea into canvas work.',
        statsLabel: 'Natural chat · Smart insight · Automated execution',
      },
      zh: {
        badge: '新功能',
        subtitle: '自然对话，智能洞察',
        title: 'Agent Chat 上线',
        description: '和 Lumen 直接讨论商品、视频脚本和执行计划，让 Agent 把想法落到画布。',
        statsLabel: '自然对话 · 智能洞察 · 自动执行',
      },
    },
    ctaHref: '/canvas/new?agent=chat',
    coverUrl: '/home-posters/selected/agent-chat-minimal.png',
    backgroundCss: 'linear-gradient(135deg, #08090b 0%, #141a22 48%, #050607 100%)',
    accentColor: '#c7e8ff',
    stills: ['#c7e8ff', '#4f6373', '#111315'],
    sortOrder: 3,
  },
  {
    badge: '新功能',
    subtitle: '灵感无限，素材无限',
    title: '素材库上线',
    description: '像逛一座内容档案馆一样挑素材，视频、图片、品牌元素都能作为创作输入。',
    statsLabel: '视频素材 · 图片素材 · 品牌元素',
    translations: {
      en: {
        badge: 'New',
        subtitle: 'Endless inspiration, endless assets',
        title: 'Asset library is live',
        description:
          'Browse assets like a content archive. Videos, images, and brand elements can all become creative inputs.',
        statsLabel: 'Video assets · Image assets · Brand elements',
      },
      zh: {
        badge: '新功能',
        subtitle: '灵感无限，素材无限',
        title: '素材库上线',
        description: '像逛一座内容档案馆一样挑素材，视频、图片、品牌元素都能作为创作输入。',
        statsLabel: '视频素材 · 图片素材 · 品牌元素',
      },
    },
    ctaHref: '/canvas/new',
    coverUrl: '/home-posters/selected/material-archive.png',
    backgroundCss: 'linear-gradient(135deg, #101916 0%, #24403a 48%, #0b0d10 100%)',
    accentColor: '#63e5cb',
    stills: ['#63e5cb', '#214a43', '#c4aa72'],
    sortOrder: 4,
  },
  {
    badge: '新功能',
    subtitle: 'AI 成为你的创作伙伴',
    title: 'Agent 模式上线',
    description: '让 Agent 在脚本、策略、执行和成片之间持续推进，减少反复切换工具的成本。',
    statsLabel: '洞察 · 策略 · 执行 · 成片',
    translations: {
      en: {
        badge: 'New',
        subtitle: 'AI becomes your creative partner',
        title: 'Agent mode is live',
        description:
          'Let Agent keep moving across scripts, strategy, execution, and final output while reducing tool switching.',
        statsLabel: 'Insight · Strategy · Execution · Final video',
      },
      zh: {
        badge: '新功能',
        subtitle: 'AI 成为你的创作伙伴',
        title: 'Agent 模式上线',
        description: '让 Agent 在脚本、策略、执行和成片之间持续推进，减少反复切换工具的成本。',
        statsLabel: '洞察 · 策略 · 执行 · 成片',
      },
    },
    ctaHref: '/canvas/new?agent=chat',
    coverUrl: '/home-posters/selected/agent-glass.png',
    backgroundCss: 'linear-gradient(135deg, #070a0d 0%, #17252a 52%, #050607 100%)',
    accentColor: '#a5f6ff',
    stills: ['#a5f6ff', '#2b4c55', '#111315'],
    sortOrder: 5,
  },
];

interface RawHotVideo {
  daysAgo: number;
  region: string;
  category: string;
  videoType: string;
  product: string;
  title: string;
  sales: number;
  revenueUsd: number;
  revenueLabel: string;
  viewsCount: number;
  viewsLabel: string;
  roas: number;
  paletteCss: string;
  accentColor: string;
  hook: string;
  angle: string;
  score: number;
  tags: string[];
  structure: string[];
}

const HOT_VIDEOS: RawHotVideo[] = [
  {
    daysAgo: 2,
    region: '越南',
    category: '居家日用',
    videoType: '用户原创',
    product: '免打孔挂墙抽纸',
    title: '挂墙抽纸用拆箱镜头做强利益点',
    sales: 4431,
    revenueUsd: 16160,
    revenueLabel: '$1.616万',
    viewsCount: 1_600_000,
    viewsLabel: '160万',
    roas: 2.86,
    paletteCss:
      'radial-gradient(circle at 28% 18%,rgba(247,206,90,0.78),transparent 28%),linear-gradient(145deg,#1d2427 0%,#5a6d72 46%,#151719 100%)',
    accentColor: '#f5c76a',
    hook: '前 2 秒直接展示一箱装和免邮，降低决策成本。',
    angle: '家庭囤货 + 墙面收纳',
    score: 92,
    tags: ['免邮', '囤货', '收纳'],
    structure: ['箱规利益点', '使用场景演示', '价格锚点', '限时行动'],
  },
  {
    daysAgo: 2,
    region: '菲律宾',
    category: '美妆个护',
    videoType: '达人口播',
    product: '烟酰胺亮肤精华',
    title: '日销千单精华用真人反馈拉信任',
    sales: 1381,
    revenueUsd: 3440,
    revenueLabel: '$3440',
    viewsCount: 512_400,
    viewsLabel: '51.24万',
    roas: 4.76,
    paletteCss:
      'radial-gradient(circle at 72% 16%,rgba(157,168,255,0.7),transparent 30%),linear-gradient(145deg,#171720 0%,#464b68 48%,#101214 100%)',
    accentColor: '#9da8ff',
    hook: '用「每天卖 1000 件」做社会证明，接近口播开场。',
    angle: '平价护肤 + 真实反馈',
    score: 88,
    tags: ['护肤', '口播', '反馈'],
    structure: ['销量证明', '脸部近景', '质地展示', '评论引导'],
  },
  {
    daysAgo: 3,
    region: '西班牙',
    category: '食品饮料',
    videoType: '测评种草',
    product: '镁元素营养片',
    title: '镁元素补剂用症状清单做停留',
    sales: 774,
    revenueUsd: 23200,
    revenueLabel: '$2.32万',
    viewsCount: 318_600,
    viewsLabel: '31.86万',
    roas: 4.55,
    paletteCss:
      'radial-gradient(circle at 22% 22%,rgba(121,228,255,0.68),transparent 32%),linear-gradient(145deg,#122027 0%,#315464 52%,#0d1114 100%)',
    accentColor: '#79e4ff',
    hook: '用「4 个信号」制造完播动机，信息密度高。',
    angle: '健康焦虑 + 清单式教育',
    score: 90,
    tags: ['清单', '健康', '教育'],
    structure: ['症状提问', '原因解释', '产品承接', '人群提醒'],
  },
  {
    daysAgo: 2,
    region: '泰国',
    category: '美妆个护',
    videoType: '用户原创',
    product: '柔焦气垫粉底',
    title: '气垫粉底用特写字幕打穿卖点',
    sales: 510,
    revenueUsd: 2146,
    revenueLabel: '$2146',
    viewsCount: 34_100,
    viewsLabel: '3.41万',
    roas: 4.44,
    paletteCss:
      'radial-gradient(circle at 78% 20%,rgba(230,183,207,0.72),transparent 30%),linear-gradient(145deg,#23191f 0%,#6e5665 48%,#111315 100%)',
    accentColor: '#e6b7cf',
    hook: '镜头先给包装和上脸效果，字幕只保留核心承诺。',
    angle: '妆效即时对比',
    score: 84,
    tags: ['妆效', '字幕', '特写'],
    structure: ['产品亮相', '上脸前后', '防脱妆证明', '购买提醒'],
  },
  {
    daysAgo: 2,
    region: '美国',
    category: '女装与女士内衣',
    videoType: '达人口播',
    product: '夏季露肩上衣',
    title: '露肩上衣用穿搭转场做高点击',
    sales: 382,
    revenueUsd: 7105,
    revenueLabel: '$7105',
    viewsCount: 2_138_600,
    viewsLabel: '213.86万',
    roas: 5,
    paletteCss:
      'radial-gradient(circle at 24% 20%,rgba(151,204,173,0.72),transparent 32%),linear-gradient(145deg,#172019 0%,#49614c 50%,#111315 100%)',
    accentColor: '#97ccad',
    hook: '用一句「这是那种衣服」触发代入，再进入真人试穿。',
    angle: '夏日出街 + 显瘦版型',
    score: 86,
    tags: ['穿搭', '转场', '显瘦'],
    structure: ['情绪开场', '上身展示', '细节说明', '场景联想'],
  },
  {
    daysAgo: 5,
    region: '菲律宾',
    category: '电脑办公',
    videoType: '测评种草',
    product: '自粘透明书皮',
    title: '书皮贴用低价套装扩大转化',
    sales: 291,
    revenueUsd: 382,
    revenueLabel: '$382',
    viewsCount: 58_200,
    viewsLabel: '5.82万',
    roas: 1.67,
    paletteCss:
      'radial-gradient(circle at 78% 76%,rgba(236,222,171,0.76),transparent 34%),linear-gradient(145deg,#1f211b 0%,#60604e 46%,#111315 100%)',
    accentColor: '#ecdeab',
    hook: '价格和数量同屏出现，马上进入尺寸适配。',
    angle: '学生开学 + 低价套装',
    score: 79,
    tags: ['低价', '学生', '套装'],
    structure: ['价格锚点', '尺寸展示', '贴膜过程', '批量购买'],
  },
];

const HOT_VIDEO_EN_TRANSLATIONS = [
  {
    region: 'Vietnam',
    category: 'Home goods',
    videoType: 'UGC',
    productName: 'No-drill wall tissue holder',
    title: 'Unboxing shots turn wall tissue packs into clear benefits',
    hook: 'Show the bulk pack and free shipping in the first 2 seconds to reduce friction.',
    angle: 'Family stocking + wall storage',
    tags: ['Free shipping', 'Stock-up', 'Storage'],
    structure: ['Pack-size benefit', 'Use-case demo', 'Price anchor', 'Limited-time action'],
  },
  {
    region: 'Philippines',
    category: 'Beauty & personal care',
    videoType: 'Creator talking head',
    productName: 'Niacinamide brightening serum',
    title: 'A serum selling thousands daily builds trust with real feedback',
    hook: 'Use "1,000 units sold daily" as social proof, close to a talking-head opener.',
    angle: 'Affordable skincare + real feedback',
    tags: ['Skincare', 'Talking head', 'Feedback'],
    structure: ['Sales proof', 'Face close-up', 'Texture demo', 'Comment prompt'],
  },
  {
    region: 'Spain',
    category: 'Food & beverage',
    videoType: 'Review / seeding',
    productName: 'Magnesium supplement tablets',
    title: 'Magnesium supplements hold attention with a symptom checklist',
    hook: 'Use "4 signals" to create completion motivation with high information density.',
    angle: 'Health anxiety + checklist education',
    tags: ['Checklist', 'Health', 'Education'],
    structure: ['Symptom question', 'Cause explanation', 'Product bridge', 'Audience reminder'],
  },
  {
    region: 'Thailand',
    category: 'Beauty & personal care',
    videoType: 'UGC',
    productName: 'Soft-focus cushion foundation',
    title: 'Cushion foundation uses close captions to punch through benefits',
    hook: 'Open on packaging and face results, keeping captions to the core promise.',
    angle: 'Instant makeup-effect comparison',
    tags: ['Makeup effect', 'Captions', 'Close-up'],
    structure: ['Product reveal', 'Before and after', 'Wear-proof proof', 'Purchase reminder'],
  },
  {
    region: 'United States',
    category: "Women's fashion & lingerie",
    videoType: 'Creator talking head',
    productName: 'Summer off-shoulder top',
    title: 'Off-shoulder tops win clicks with outfit transitions',
    hook: 'Use "this is that kind of top" to trigger identification before try-on footage.',
    angle: 'Summer streetwear + slimming fit',
    tags: ['Outfit', 'Transition', 'Slimming'],
    structure: ['Emotional opener', 'Try-on display', 'Detail explanation', 'Scene association'],
  },
  {
    region: 'Philippines',
    category: 'Computers & office',
    videoType: 'Review / seeding',
    productName: 'Self-adhesive transparent book cover',
    title: 'Book cover film expands conversion with low-price bundles',
    hook: 'Show price and quantity together, then immediately demonstrate size fit.',
    angle: 'Back-to-school + low-price bundle',
    tags: ['Low price', 'Students', 'Bundle'],
    structure: ['Price anchor', 'Size display', 'Film process', 'Bulk purchase'],
  },
] satisfies Array<{
  region: string;
  category: string;
  videoType: string;
  productName: string;
  title: string;
  hook: string;
  angle: string;
  tags: string[];
  structure: string[];
}>;

function toCreateHotVideoInput(raw: RawHotVideo, index: number): CreateHotVideoInput {
  const publishedAt = new Date(Date.now() - raw.daysAgo * 24 * 60 * 60 * 1000);
  const en = HOT_VIDEO_EN_TRANSLATIONS[index];
  return {
    sourcePlatform: 'manual',
    externalId: `seed-${index + 1}`,
    title: raw.title,
    productName: raw.product,
    region: raw.region,
    category: raw.category,
    videoType: raw.videoType,
    paletteCss: raw.paletteCss,
    accentColor: raw.accentColor,
    metrics: {
      sales: raw.sales,
      revenueUsd: raw.revenueUsd,
      revenueLabel: raw.revenueLabel,
      viewsCount: raw.viewsCount,
      viewsLabel: raw.viewsLabel,
      roas: raw.roas,
    },
    analysis: {
      hook: raw.hook,
      angle: raw.angle,
      score: raw.score,
      tags: raw.tags,
      structure: raw.structure,
    },
    translations: en
      ? {
          en: {
            title: en.title,
            productName: en.productName,
            region: en.region,
            category: en.category,
            videoType: en.videoType,
            metrics: {
              viewsLabel: new Intl.NumberFormat('en-US', {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(raw.viewsCount),
            },
            analysis: {
              hook: en.hook,
              angle: en.angle,
              tags: en.tags,
              structure: en.structure,
            },
          },
          zh: {
            title: raw.title,
            productName: raw.product,
            region: raw.region,
            category: raw.category,
            videoType: raw.videoType,
            metrics: {
              revenueLabel: raw.revenueLabel,
              viewsLabel: raw.viewsLabel,
            },
            analysis: {
              hook: raw.hook,
              angle: raw.angle,
              tags: raw.tags,
              structure: raw.structure,
            },
          },
        }
      : undefined,
    publishedAt,
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB ?? 'lumen_app';
  if (!uri) throw new Error('MONGODB_URI is required (set it in apps/lumen-studio/.env.local)');

  console.log(`[seed] connecting to ${dbName} ...`);
  const db = await getMongoDatabase({ uri, dbName, appName: 'lumen-studio-seed' });

  const homeRepo = new HomeFeaturedRepository(db);
  const hotRepo = new HotVideoRepository(db);
  await Promise.all([homeRepo.ensureIndexes(), hotRepo.ensureIndexes()]);

  console.log('[seed] wiping existing seed data ...');
  await Promise.all([homeRepo.deleteAll(), hotRepo.deleteAll()]);

  console.log(
    `[seed] inserting ${FEATURED.length} home_featured + ${HOT_VIDEOS.length} hot_videos ...`,
  );
  for (const item of FEATURED) {
    await homeRepo.create(item);
  }
  await Promise.all(HOT_VIDEOS.map((raw, i) => hotRepo.create(toCreateHotVideoInput(raw, i))));

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl?.trim()) {
    console.log('[seed] flushing relevant cache keys ...');
    const redis = getRedisClient({ url: redisUrl, keyPrefix: 'lumen:studio:' });
    if (redis) {
      const patterns = ['home:featured:*', 'hot-videos:*'];
      for (const pattern of patterns) {
        const keys = await redis.keys(`lumen:studio:${pattern}`);
        if (keys.length) {
          // ioredis with keyPrefix re-prefixes on .del, so strip back to bare keys.
          const bare = keys.map((k) => k.replace('lumen:studio:', ''));
          await redis.del(...bare);
        }
      }
    }
  }

  console.log('[seed] done.');
  await closeMongoDatabases();
  await closeRedisClients();
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
