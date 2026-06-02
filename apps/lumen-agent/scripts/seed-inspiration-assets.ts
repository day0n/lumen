/**
 * Seed the official Lumen inspiration library.
 *
 * Flow:
 *   seed metadata -> OpenAI image generation -> R2 upload -> OpenAI tag embedding -> Mongo upsert
 *
 * Usage:
 *   pnpm --filter @lumen/agent seed:inspiration -- --dry-run
 *   pnpm --filter @lumen/agent seed:inspiration -- --limit 20
 *   pnpm --filter @lumen/agent seed:inspiration -- --category automotive --force
 *   pnpm --filter @lumen/agent seed:inspiration -- --ensure-search-index --skip-images
 *   pnpm --filter @lumen/agent seed:inspiration -- --index-only --ensure-search-index
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config as dotenvConfig } from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { type Collection, type Document, MongoClient } from 'mongodb';
import OpenAI from 'openai';

import {
  INSPIRATION_ASSETS_COLLECTION,
  INSPIRATION_VECTOR_INDEX,
} from '../src/adapters/outbound/tools/inspirationSearch.js';

const envRoots = [
  { path: process.cwd(), override: true },
  { path: resolve(process.cwd(), 'apps/lumen-agent'), override: false },
  { path: resolve(process.cwd(), '../lumen-studio'), override: false },
  { path: resolve(process.cwd(), 'apps/lumen-studio'), override: false },
];

for (const root of envRoots) {
  for (const file of ['.env', '.env.local']) {
    const path = resolve(root.path, file);
    if (existsSync(path)) dotenvConfig({ path, override: root.override });
  }
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
const DEFAULT_IMAGE_MODEL = 'gpt-image-1';

// gpt-image-1 只支持这三种尺寸；facets.aspect_ratio 会被映射到最接近的一种，
// 保证写进库的 aspect_ratio 和真实生成的画幅一致（否则按画幅过滤会"撒谎"）。
const IMAGE_SIZES = {
  landscape: '1536x1024', // ≈1.50
  square: '1024x1024', // 1.00
  portrait: '1024x1536', // ≈0.67
} as const;
const FALLBACK_IMAGE_SIZE = IMAGE_SIZES.portrait;

interface InspirationFacets {
  era: string;
  scene: string;
  style: string;
  subject: string;
  mood: string;
  color: string;
  region: string;
  aspect_ratio: string;
}

interface InspirationSeed {
  slug: string;
  title: string;
  description: string;
  category: string;
  tagsZh: string[];
  tagsEn: string[];
  facets: InspirationFacets;
  prompt: string;
}

interface CliOptions {
  dryRun: boolean;
  force: boolean;
  skipImages: boolean;
  ensureSearchIndex: boolean;
  indexOnly: boolean;
  limit: number | null;
  category: string | null;
}

interface R2Settings {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

function buildPrompt(seed: InspirationSeed): string {
  return [
    seed.prompt,
    '',
    'Create a polished, original reference image for a creative inspiration library.',
    'No brand logos, no readable text, no trademarks, no watermarks.',
    'If people appear, they must be clearly adult, respectful, non-sexualized, and suitable as commercial visual references.',
    'Make it useful as visual reference for short-form product marketing.',
    `Aspect ratio cue: ${seed.facets.aspect_ratio}.`,
  ].join('\n');
}

function embeddingText(seed: InspirationSeed): string {
  return [
    `category: ${seed.category}`,
    `title: ${seed.title}`,
    `tags_en: ${seed.tagsEn.join(', ')}`,
    `tags_zh: ${seed.tagsZh.join(', ')}`,
    `facets: ${Object.entries(seed.facets)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')}`,
  ].join('\n');
}

const DEFAULT_SEEDS: InspirationSeed[] = [
  {
    slug: '1990s-automotive-garage-chrome',
    title: '1990s garage chrome car detail',
    description: 'Analog-film garage mood with chrome details and a nostalgic auto culture feel.',
    category: 'automotive',
    tagsZh: ['九十年代', '汽车', '车库', '铬金属', '胶片感', '怀旧'],
    tagsEn: ['1990s', 'automotive', 'garage', 'chrome', 'analog film', 'nostalgic'],
    facets: {
      era: '1990s',
      scene: 'garage',
      style: 'analog film photo',
      subject: 'car exterior detail',
      mood: 'nostalgic',
      color: 'chrome muted teal',
      region: 'us',
      aspect_ratio: '4:5',
    },
    prompt:
      'A 1990s inspired automotive garage still life, close view of a clean chrome car fender and headlight, oil-stained concrete, tool shelves in the background, Kodak-style analog film grain, soft afternoon light, realistic commercial photography.',
  },
  {
    slug: '1990s-automotive-highway-dusk',
    title: '1990s highway dusk drive',
    description: 'A cinematic open-road car reference for retro automotive storytelling.',
    category: 'automotive',
    tagsZh: ['九十年代', '汽车', '公路', '黄昏', '电影感', '美国'],
    tagsEn: ['1990s', 'automotive', 'highway', 'dusk', 'cinematic', 'american road trip'],
    facets: {
      era: '1990s',
      scene: 'highway',
      style: 'cinematic film still',
      subject: 'car on road',
      mood: 'free spirited',
      color: 'amber blue',
      region: 'us',
      aspect_ratio: '16:9',
    },
    prompt:
      'A 1990s inspired car cruising on an empty desert highway at dusk, low camera angle, long shadows, amber sky, subtle film grain, realistic cinematic commercial still, no logos, no text.',
  },
  {
    slug: '1990s-automotive-dashboard-night',
    title: '1990s dashboard night glow',
    description: 'Interior dashboard reference with late-night analog instrument light.',
    category: 'automotive',
    tagsZh: ['九十年代', '汽车内饰', '仪表盘', '夜晚', '绿色灯光', '胶片'],
    tagsEn: ['1990s', 'car interior', 'dashboard', 'night', 'green glow', 'film'],
    facets: {
      era: '1990s',
      scene: 'car interior',
      style: 'documentary flash photo',
      subject: 'dashboard',
      mood: 'quiet',
      color: 'black green amber',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A realistic 1990s car dashboard at night, softly glowing analog gauges, cassette deck, hands on steering wheel partially visible, documentary flash photography, film grain, no logos, no readable text.',
  },
  {
    slug: '1990s-automotive-parking-lot-flash',
    title: '1990s parking lot flash photo',
    description: 'Flash-lit parking lot mood for youth car culture and street references.',
    category: 'automotive',
    tagsZh: ['九十年代', '停车场', '闪光灯', '街头', '汽车文化'],
    tagsEn: ['1990s', 'parking lot', 'flash photo', 'street', 'car culture'],
    facets: {
      era: '1990s',
      scene: 'parking lot',
      style: 'flash photo',
      subject: 'parked car',
      mood: 'raw energetic',
      color: 'night neon',
      region: 'us',
      aspect_ratio: '3:4',
    },
    prompt:
      'A 1990s youth car culture scene in a night parking lot, one clean older sedan under harsh camera flash, wet asphalt, faint neon from a storefront, candid realistic flash photo, no logos, no readable text.',
  },
  {
    slug: '1990s-automotive-japanese-street',
    title: '1990s Japanese street car scene',
    description: 'Compact street automotive reference with urban night atmosphere.',
    category: 'automotive',
    tagsZh: ['九十年代', '日本街头', '汽车', '霓虹', '夜景'],
    tagsEn: ['1990s', 'japan street', 'automotive', 'neon', 'night'],
    facets: {
      era: '1990s',
      scene: 'urban street',
      style: 'analog street photography',
      subject: 'compact car',
      mood: 'moody',
      color: 'neon magenta blue',
      region: 'japan',
      aspect_ratio: '4:5',
    },
    prompt:
      'A 1990s Japanese urban street at night with a compact car parked under soft neon reflections, rain on pavement, realistic analog street photography, no logos, no readable signs.',
  },
  {
    slug: '1990s-automotive-magazine-ad',
    title: '1990s car magazine ad still',
    description: 'Clean editorial auto still inspired by vintage magazine layouts.',
    category: 'automotive',
    tagsZh: ['九十年代', '汽车广告', '杂志', '棚拍', '编辑风'],
    tagsEn: ['1990s', 'car ad', 'magazine', 'studio', 'editorial'],
    facets: {
      era: '1990s',
      scene: 'studio',
      style: 'editorial catalog',
      subject: 'car profile',
      mood: 'confident',
      color: 'white silver red',
      region: 'global',
      aspect_ratio: '16:9',
    },
    prompt:
      'A clean 1990s automotive magazine advertisement style still, generic silver coupe in a bright studio, crisp reflections, editorial catalog photography, no logos, no text, no watermark.',
  },
  {
    slug: '1990s-automotive-car-wash',
    title: '1990s self-serve car wash',
    description: 'Retro lifestyle scene with foam, water, and casual car care energy.',
    category: 'automotive',
    tagsZh: ['九十年代', '洗车', '汽车护理', '生活方式', '阳光'],
    tagsEn: ['1990s', 'car wash', 'auto care', 'lifestyle', 'sunny'],
    facets: {
      era: '1990s',
      scene: 'self serve car wash',
      style: 'lifestyle photography',
      subject: 'washing car',
      mood: 'bright casual',
      color: 'sunny blue white',
      region: 'us',
      aspect_ratio: '9:16',
    },
    prompt:
      'A 1990s self-serve car wash lifestyle scene, foam on a generic car door, water spray in sunlight, casual hands cleaning with sponge, realistic bright film photo, no logos, no text.',
  },
  {
    slug: '1990s-automotive-roadside-diner',
    title: '1990s roadside diner car stop',
    description: 'Road trip mood with diner lights and parked car composition.',
    category: 'automotive',
    tagsZh: ['九十年代', '公路餐厅', '汽车', '旅行', '霓虹'],
    tagsEn: ['1990s', 'roadside diner', 'automotive', 'road trip', 'neon'],
    facets: {
      era: '1990s',
      scene: 'roadside diner',
      style: 'cinematic photo',
      subject: 'parked car',
      mood: 'nostalgic warm',
      color: 'red teal amber',
      region: 'us',
      aspect_ratio: '16:9',
    },
    prompt:
      'A generic 1990s car parked outside a roadside diner at blue hour, warm windows, soft neon glow, cinematic realistic film still, no logos, no readable text.',
  },
  {
    slug: 'y2k-silver-fashion-editorial',
    title: 'Y2K silver fashion editorial',
    description: 'Metallic styling reference for futuristic beauty and fashion shoots.',
    category: 'fashion',
    tagsZh: ['Y2K', '银色', '时尚大片', '金属感', '未来感'],
    tagsEn: ['y2k', 'silver', 'fashion editorial', 'metallic', 'futuristic'],
    facets: {
      era: 'y2k',
      scene: 'studio',
      style: 'fashion editorial',
      subject: 'outfit texture',
      mood: 'sleek',
      color: 'silver icy blue',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Y2K fashion editorial close-up of metallic silver fabric, glossy accessories, clean futuristic studio lighting, high-end realistic photography, no logos, no text.',
  },
  {
    slug: '1990s-denim-bedroom-catalog',
    title: '1990s denim bedroom catalog',
    description: 'Casual denim reference with bedroom catalog warmth.',
    category: 'fashion',
    tagsZh: ['九十年代', '牛仔', '卧室', '目录风', '休闲'],
    tagsEn: ['1990s', 'denim', 'bedroom', 'catalog', 'casual'],
    facets: {
      era: '1990s',
      scene: 'bedroom',
      style: 'catalog photography',
      subject: 'denim outfit',
      mood: 'relaxed',
      color: 'blue cream',
      region: 'us',
      aspect_ratio: '4:5',
    },
    prompt:
      'A 1990s catalog-style denim outfit reference in a sunlit bedroom, folded jeans, jacket on chair, soft cotton textures, realistic commercial photo, no logos, no text.',
  },
  {
    slug: '1980s-workout-neon-fashion',
    title: '1980s neon workout fashion',
    description: 'Bright retro athletic styling for energetic social video ideas.',
    category: 'fashion',
    tagsZh: ['八十年代', '健身', '霓虹', '运动服', '复古'],
    tagsEn: ['1980s', 'workout', 'neon', 'activewear', 'retro'],
    facets: {
      era: '1980s',
      scene: 'fitness studio',
      style: 'flash editorial',
      subject: 'activewear',
      mood: 'energetic',
      color: 'neon pink blue',
      region: 'global',
      aspect_ratio: '9:16',
    },
    prompt:
      '1980s inspired workout fashion still, neon activewear laid out in a fitness studio, bright flash editorial lighting, realistic textures, no logos, no text.',
  },
  {
    slug: 'quiet-luxury-cream-product-style',
    title: 'Quiet luxury cream wardrobe',
    description: 'Minimal premium fashion reference for refined product storytelling.',
    category: 'fashion',
    tagsZh: ['静奢', '米白', '衣橱', '高级感', '极简'],
    tagsEn: ['quiet luxury', 'cream', 'wardrobe', 'premium', 'minimal'],
    facets: {
      era: 'modern',
      scene: 'wardrobe',
      style: 'minimal editorial',
      subject: 'neutral clothing',
      mood: 'refined',
      color: 'cream charcoal',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Minimal quiet luxury wardrobe reference, cream knitwear and tailored neutral clothing on hangers, soft window light, premium editorial still, no logos, no text.',
  },
  {
    slug: 'beauty-glass-skin-bathroom',
    title: 'Glass skin bathroom shelf',
    description: 'Clean skincare shelf visual for product routine references.',
    category: 'beauty',
    tagsZh: ['护肤', '浴室', '玻璃肌', '清透', '晨间'],
    tagsEn: ['skincare', 'bathroom', 'glass skin', 'clean', 'morning routine'],
    facets: {
      era: 'modern',
      scene: 'bathroom shelf',
      style: 'clean beauty photography',
      subject: 'skincare bottles',
      mood: 'fresh',
      color: 'white aqua',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Clean beauty product reference on a bathroom shelf, generic glass skincare bottles with no labels, morning light, water droplets, fresh realistic commercial photography.',
  },
  {
    slug: '1990s-beauty-vanity-flash',
    title: '1990s vanity flash beauty',
    description: 'Retro makeup vanity image with flash and playful cosmetics.',
    category: 'beauty',
    tagsZh: ['九十年代', '化妆台', '美妆', '闪光灯', '复古'],
    tagsEn: ['1990s', 'vanity', 'makeup', 'flash photo', 'retro'],
    facets: {
      era: '1990s',
      scene: 'vanity table',
      style: 'flash photo',
      subject: 'makeup products',
      mood: 'playful',
      color: 'pink pearl black',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      '1990s makeup vanity still life, generic lipstick tubes and compact powders with no labels, mirror bulbs, direct camera flash, realistic retro beauty photography.',
  },
  {
    slug: 'beauty-spa-green-botanical',
    title: 'Botanical spa skincare mood',
    description: 'Green spa scene for calming botanical beauty references.',
    category: 'beauty',
    tagsZh: ['护肤', '植物', '水疗', '绿色', '放松'],
    tagsEn: ['skincare', 'botanical', 'spa', 'green', 'calm'],
    facets: {
      era: 'modern',
      scene: 'spa counter',
      style: 'natural light photo',
      subject: 'cream jar',
      mood: 'calming',
      color: 'sage white',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Botanical skincare spa still life, unlabeled cream jar, green leaves, ceramic tray, soft natural window light, calming realistic product photography.',
  },
  {
    slug: 'food-1990s-diner-soda',
    title: '1990s diner soda and fries',
    description: 'Bright diner food scene for nostalgic snack references.',
    category: 'food',
    tagsZh: ['九十年代', '餐厅', '汽水', '薯条', '怀旧'],
    tagsEn: ['1990s', 'diner', 'soda', 'fries', 'nostalgic'],
    facets: {
      era: '1990s',
      scene: 'diner table',
      style: 'flash lifestyle photo',
      subject: 'snack food',
      mood: 'fun',
      color: 'red yellow teal',
      region: 'us',
      aspect_ratio: '4:5',
    },
    prompt:
      '1990s diner table with generic soda glass and fries basket, colorful booth, direct flash lifestyle photo, realistic food styling, no logos, no readable text.',
  },
  {
    slug: 'food-kitchen-morning-cereal',
    title: 'Morning cereal kitchen',
    description: 'Sunny kitchen breakfast composition for family product ideas.',
    category: 'food',
    tagsZh: ['早餐', '厨房', '谷物', '晨光', '家庭'],
    tagsEn: ['breakfast', 'kitchen', 'cereal', 'morning light', 'family'],
    facets: {
      era: 'modern',
      scene: 'kitchen counter',
      style: 'lifestyle photography',
      subject: 'breakfast bowl',
      mood: 'warm',
      color: 'yellow white',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Sunny kitchen breakfast scene, cereal bowl, milk pour, fruit on counter, warm morning light, realistic lifestyle food photography, no branded packaging, no text.',
  },
  {
    slug: 'food-asian-night-market',
    title: 'Asian night market steam',
    description: 'Steam, neon, and street food energy for snack campaign references.',
    category: 'food',
    tagsZh: ['夜市', '街头食物', '蒸汽', '亚洲', '霓虹'],
    tagsEn: ['night market', 'street food', 'steam', 'asia', 'neon'],
    facets: {
      era: 'modern',
      scene: 'night market',
      style: 'street photography',
      subject: 'street food',
      mood: 'lively',
      color: 'warm neon',
      region: 'asia',
      aspect_ratio: '9:16',
    },
    prompt:
      'Asian night market street food reference, steam rising from a generic snack stall, warm lantern light and soft neon, realistic street photography, no readable signs.',
  },
  {
    slug: 'electronics-y2k-translucent-gadget',
    title: 'Y2K translucent gadget macro',
    description: 'Translucent plastic electronics look for retro-tech ideas.',
    category: 'electronics',
    tagsZh: ['Y2K', '透明塑料', '电子产品', '微距', '复古科技'],
    tagsEn: ['y2k', 'translucent plastic', 'electronics', 'macro', 'retro tech'],
    facets: {
      era: 'y2k',
      scene: 'studio macro',
      style: 'product macro photo',
      subject: 'gadget detail',
      mood: 'curious',
      color: 'clear blue',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Y2K translucent plastic gadget macro shot, generic handheld electronic device with visible circuits, glossy clear blue casing, clean studio product photography, no logos, no text.',
  },
  {
    slug: 'electronics-1990s-desk-setup',
    title: '1990s computer desk setup',
    description: 'Retro desk composition for software, learning, and productivity stories.',
    category: 'electronics',
    tagsZh: ['九十年代', '电脑桌', 'CRT', '键盘', '科技'],
    tagsEn: ['1990s', 'computer desk', 'CRT', 'keyboard', 'tech'],
    facets: {
      era: '1990s',
      scene: 'desk setup',
      style: 'documentary photo',
      subject: 'computer setup',
      mood: 'focused',
      color: 'beige green',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      '1990s computer desk setup with generic CRT monitor, beige keyboard, scattered floppy disks, soft desk lamp, realistic documentary photo, no logos, no readable text.',
  },
  {
    slug: 'electronics-modern-unboxing-table',
    title: 'Modern gadget unboxing table',
    description: 'Clean top-down unboxing reference for consumer electronics videos.',
    category: 'electronics',
    tagsZh: ['开箱', '电子产品', '桌面', '极简', '现代'],
    tagsEn: ['unboxing', 'electronics', 'desk', 'minimal', 'modern'],
    facets: {
      era: 'modern',
      scene: 'desk flatlay',
      style: 'top down product photo',
      subject: 'gadget accessories',
      mood: 'clean',
      color: 'white black cyan',
      region: 'global',
      aspect_ratio: '1:1',
    },
    prompt:
      'Modern consumer electronics unboxing flat lay, generic earbuds case, cable, matte packaging with no text, clean desk, crisp top-down product photography.',
  },
  {
    slug: 'home-sunlit-sofa-lifestyle',
    title: 'Sunlit sofa lifestyle corner',
    description: 'Warm living room reference for home goods and comfort products.',
    category: 'home',
    tagsZh: ['家居', '沙发', '阳光', '生活方式', '舒适'],
    tagsEn: ['home', 'sofa', 'sunlight', 'lifestyle', 'cozy'],
    facets: {
      era: 'modern',
      scene: 'living room',
      style: 'lifestyle photography',
      subject: 'sofa corner',
      mood: 'cozy',
      color: 'warm white green',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Warm living room sofa corner with sunlight, textured blanket, houseplant, ceramic mug, realistic home lifestyle photography, no logos, no text.',
  },
  {
    slug: 'home-1990s-bedroom-lamp',
    title: '1990s bedroom lamp atmosphere',
    description: 'Soft retro bedroom lighting for nostalgic household references.',
    category: 'home',
    tagsZh: ['九十年代', '卧室', '台灯', '怀旧', '柔光'],
    tagsEn: ['1990s', 'bedroom', 'lamp', 'nostalgic', 'soft light'],
    facets: {
      era: '1990s',
      scene: 'bedroom',
      style: 'analog interior photo',
      subject: 'bedside table',
      mood: 'quiet',
      color: 'amber blue',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      '1990s bedroom bedside table with warm lamp, paperback book, patterned fabric, soft analog interior photography, nostalgic quiet mood, no logos, no readable text.',
  },
  {
    slug: 'travel-coastal-product-picnic',
    title: 'Coastal picnic product mood',
    description: 'Outdoor picnic and beach lifestyle reference for summer products.',
    category: 'lifestyle',
    tagsZh: ['海岸', '野餐', '夏日', '生活方式', '产品氛围'],
    tagsEn: ['coastal', 'picnic', 'summer', 'lifestyle', 'product mood'],
    facets: {
      era: 'modern',
      scene: 'coastal picnic',
      style: 'sunny lifestyle photo',
      subject: 'picnic setup',
      mood: 'breezy',
      color: 'blue cream coral',
      region: 'global',
      aspect_ratio: '9:16',
    },
    prompt:
      'Coastal summer picnic setup near the beach, generic tote bag, fruit, sunscreen-like unlabeled bottle, breezy sunlight, realistic lifestyle product photography.',
  },
  {
    slug: 'lifestyle-night-city-rain-product',
    title: 'Night city rain product mood',
    description: 'Moody urban rain reference for premium nighttime campaigns.',
    category: 'lifestyle',
    tagsZh: ['城市夜景', '雨天', '产品氛围', '电影感', '高级'],
    tagsEn: ['night city', 'rain', 'product mood', 'cinematic', 'premium'],
    facets: {
      era: 'modern',
      scene: 'rainy street',
      style: 'cinematic still',
      subject: 'handheld product',
      mood: 'premium moody',
      color: 'black blue amber',
      region: 'global',
      aspect_ratio: '9:16',
    },
    prompt:
      'Moody rainy city night lifestyle reference, hand holding a generic small product with no label, wet street reflections, cinematic realistic photography, no logos, no text.',
  },
];

const ADDITIONAL_SEEDS: InspirationSeed[] = [
  {
    slug: 'adult-blonde-woman-clean-studio-portrait',
    title: 'Adult blonde woman clean studio portrait',
    description:
      'Polished adult blonde model portrait for beauty, fashion, and creator references.',
    category: 'people',
    tagsZh: ['成人', '金发美女', '人像', '棚拍', '干净妆容', '时尚'],
    tagsEn: ['adult', 'blonde woman', 'portrait', 'studio', 'clean makeup', 'fashion'],
    facets: {
      era: 'modern',
      scene: 'studio portrait',
      style: 'clean beauty editorial',
      subject: 'adult blonde woman',
      mood: 'confident',
      color: 'cream soft gold',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful adult blonde woman studio portrait, clean makeup, soft cream backdrop, natural skin texture, premium fashion and beauty editorial lighting, realistic commercial photography, no logos, no text.',
  },
  {
    slug: 'adult-blonde-woman-cafe-window-lifestyle',
    title: 'Adult blonde woman cafe window lifestyle',
    description: 'Soft lifestyle portrait with casual knitwear and window light.',
    category: 'people',
    tagsZh: ['成人', '金发美女', '咖啡馆', '生活方式', '针织衫', '自然光'],
    tagsEn: ['adult', 'blonde woman', 'cafe', 'lifestyle', 'knitwear', 'window light'],
    facets: {
      era: 'modern',
      scene: 'cafe window',
      style: 'natural lifestyle photo',
      subject: 'adult blonde woman',
      mood: 'warm relaxed',
      color: 'latte cream blue',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful adult blonde woman sitting by a cafe window in casual knitwear, warm natural light, coffee cup without branding, candid lifestyle photography, no logos, no readable text.',
  },
  {
    slug: 'baseball-cap-streetwear-closeup',
    title: 'Baseball cap streetwear closeup',
    description: 'Clean cap detail for streetwear, accessory, and product styling references.',
    category: 'accessories',
    tagsZh: ['棒球帽', '街头', '配饰', '帽檐', '棉布', '潮流'],
    tagsEn: ['baseball cap', 'streetwear', 'accessory', 'brim', 'cotton', 'fashion'],
    facets: {
      era: 'modern',
      scene: 'urban wall',
      style: 'product lifestyle closeup',
      subject: 'baseball cap',
      mood: 'casual cool',
      color: 'navy concrete white',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A generic baseball cap close-up on an urban concrete background, visible cotton texture and curved brim, streetwear product lifestyle photography, no logos, no text, no brand marks.',
  },
  {
    slug: 'adult-model-baseball-cap-summer-portrait',
    title: 'Adult model with baseball cap summer portrait',
    description: 'Sunny adult portrait reference centered on cap styling and casual fashion.',
    category: 'people',
    tagsZh: ['成人', '棒球帽', '夏日', '人像', '休闲穿搭', '阳光'],
    tagsEn: ['adult', 'baseball cap', 'summer', 'portrait', 'casual outfit', 'sunny'],
    facets: {
      era: 'modern',
      scene: 'sunny sidewalk',
      style: 'lifestyle portrait',
      subject: 'adult model wearing baseball cap',
      mood: 'bright casual',
      color: 'sky blue white tan',
      region: 'global',
      aspect_ratio: '9:16',
    },
    prompt:
      'A respectful adult model wearing a plain baseball cap and casual summer outfit on a sunny sidewalk, lifestyle portrait, bright natural light, no logos, no readable text.',
  },
  {
    slug: 'red-lip-beauty-editorial-adult-model',
    title: 'Red lip beauty editorial adult model',
    description: 'Bold makeup portrait for lipstick and beauty campaign references.',
    category: 'beauty',
    tagsZh: ['成人模特', '红唇', '美妆大片', '妆容', '高级感'],
    tagsEn: ['adult model', 'red lip', 'beauty editorial', 'makeup', 'premium'],
    facets: {
      era: 'modern',
      scene: 'studio closeup',
      style: 'beauty editorial',
      subject: 'adult makeup model',
      mood: 'bold elegant',
      color: 'red black ivory',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful adult beauty model close-up with precise red lipstick, minimal black outfit, ivory studio background, premium realistic beauty editorial photography, no logos, no text.',
  },
  {
    slug: 'silver-haired-elegant-adult-woman',
    title: 'Silver-haired elegant adult woman',
    description: 'Mature fashion portrait for premium lifestyle and skincare references.',
    category: 'people',
    tagsZh: ['成熟女性', '银发', '优雅', '人像', '高级生活方式'],
    tagsEn: ['mature woman', 'silver hair', 'elegant', 'portrait', 'premium lifestyle'],
    facets: {
      era: 'modern',
      scene: 'soft studio',
      style: 'premium lifestyle portrait',
      subject: 'silver-haired adult woman',
      mood: 'calm elegant',
      color: 'silver taupe cream',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'An elegant silver-haired adult woman in a neutral tailored outfit, soft studio light, refined premium lifestyle portrait, realistic photography, no logos, no text.',
  },
  {
    slug: 'curly-hair-denim-adult-model',
    title: 'Curly hair denim adult model',
    description: 'Casual denim portrait with textured hair and approachable fashion energy.',
    category: 'people',
    tagsZh: ['成人模特', '卷发', '牛仔', '休闲', '自然人像'],
    tagsEn: ['adult model', 'curly hair', 'denim', 'casual', 'natural portrait'],
    facets: {
      era: 'modern',
      scene: 'studio daylight',
      style: 'casual fashion portrait',
      subject: 'curly-haired adult model',
      mood: 'friendly confident',
      color: 'denim blue warm white',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful curly-haired adult model wearing a plain denim jacket, natural smile, soft daylight studio, casual fashion portrait, no logos, no readable text.',
  },
  {
    slug: 'brunette-business-creator-desk',
    title: 'Brunette business creator desk',
    description: 'Work-focused adult creator portrait for productivity and SaaS references.',
    category: 'people',
    tagsZh: ['成人女性', '办公桌', '创作者', '商务休闲', '电脑'],
    tagsEn: ['adult woman', 'desk', 'creator', 'business casual', 'laptop'],
    facets: {
      era: 'modern',
      scene: 'home office',
      style: 'work lifestyle photo',
      subject: 'adult creator at desk',
      mood: 'focused',
      color: 'charcoal cream green',
      region: 'global',
      aspect_ratio: '16:9',
    },
    prompt:
      'A brunette adult woman creator at a tidy home office desk with a generic laptop, business casual outfit, focused expression, realistic work lifestyle photography, no logos, no readable screen text.',
  },
  {
    slug: 'athletic-adult-man-training-portrait',
    title: 'Athletic adult man training portrait',
    description: 'Fitness portrait for sports gear, wellness, and training references.',
    category: 'people',
    tagsZh: ['成年男性', '健身', '运动', '训练', '汗水', '健康'],
    tagsEn: ['adult man', 'fitness', 'sports', 'training', 'sweat', 'wellness'],
    facets: {
      era: 'modern',
      scene: 'gym wall',
      style: 'sports portrait',
      subject: 'athletic adult man',
      mood: 'determined',
      color: 'black grey cyan',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful athletic adult man after training near a gym wall, plain performance shirt with no logo, sweat texture, dramatic sports portrait lighting, realistic photography, no text.',
  },
  {
    slug: 'asian-adult-streetwear-night-portrait',
    title: 'Asian adult streetwear night portrait',
    description: 'Urban night portrait for streetwear, creator, and city campaign references.',
    category: 'people',
    tagsZh: ['亚洲成人', '街头穿搭', '夜景', '霓虹', '城市'],
    tagsEn: ['asian adult', 'streetwear', 'night portrait', 'neon', 'city'],
    facets: {
      era: 'modern',
      scene: 'night street',
      style: 'cinematic street portrait',
      subject: 'asian adult model',
      mood: 'cool moody',
      color: 'neon blue magenta black',
      region: 'asia',
      aspect_ratio: '9:16',
    },
    prompt:
      'A respectful Asian adult model in plain streetwear on a rainy city street at night, soft neon reflections, cinematic street portrait, no logos, no readable signs.',
  },
  {
    slug: 'vintage-leather-jacket-adult-portrait',
    title: 'Vintage leather jacket adult portrait',
    description: 'Retro adult portrait with leather jacket styling and analog character.',
    category: 'fashion',
    tagsZh: ['成人模特', '皮夹克', '复古', '胶片', '街头'],
    tagsEn: ['adult model', 'leather jacket', 'vintage', 'film', 'street'],
    facets: {
      era: '1990s',
      scene: 'brick alley',
      style: 'analog fashion portrait',
      subject: 'leather jacket outfit',
      mood: 'independent',
      color: 'black brick amber',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful adult model wearing a plain vintage leather jacket in a brick alley, analog fashion portrait, subtle film grain, no logos, no readable text.',
  },
  {
    slug: 'sunglasses-beach-lifestyle-accessory',
    title: 'Sunglasses beach lifestyle accessory',
    description: 'Sunny eyewear product mood for summer and travel campaigns.',
    category: 'accessories',
    tagsZh: ['墨镜', '海滩', '夏日', '配饰', '旅行', '阳光'],
    tagsEn: ['sunglasses', 'beach', 'summer', 'accessory', 'travel', 'sunlight'],
    facets: {
      era: 'modern',
      scene: 'beach towel',
      style: 'sunny product lifestyle',
      subject: 'sunglasses',
      mood: 'breezy',
      color: 'sand blue amber',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Generic sunglasses on a beach towel beside shells and a plain water bottle, bright summer sunlight, realistic product lifestyle photography, no logos, no text.',
  },
  {
    slug: 'chunky-sneaker-street-flatlay',
    title: 'Chunky sneaker street flatlay',
    description: 'Footwear flatlay for sneaker, activewear, and street campaign references.',
    category: 'accessories',
    tagsZh: ['球鞋', '街头', '鞋子', '平铺', '运动潮流'],
    tagsEn: ['sneakers', 'street', 'footwear', 'flatlay', 'athleisure'],
    facets: {
      era: 'modern',
      scene: 'concrete ground',
      style: 'streetwear flatlay',
      subject: 'chunky sneakers',
      mood: 'fresh sporty',
      color: 'white grey lime',
      region: 'global',
      aspect_ratio: '1:1',
    },
    prompt:
      'A pair of generic chunky sneakers on clean concrete with plain socks and sport towel, streetwear flatlay product photo, no logos, no text, no brand marks.',
  },
  {
    slug: 'canvas-tote-market-lifestyle',
    title: 'Canvas tote market lifestyle',
    description: 'Reusable tote bag lifestyle scene for everyday product references.',
    category: 'accessories',
    tagsZh: ['帆布包', '市集', '环保', '生活方式', '日常'],
    tagsEn: ['canvas tote', 'market', 'eco', 'lifestyle', 'everyday'],
    facets: {
      era: 'modern',
      scene: 'farmers market',
      style: 'natural lifestyle photo',
      subject: 'canvas tote bag',
      mood: 'fresh everyday',
      color: 'cream green red',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A plain canvas tote bag filled with fresh produce at an outdoor market, natural morning light, realistic lifestyle product photography, no logos, no readable text.',
  },
  {
    slug: 'minimal-watch-wrist-macro',
    title: 'Minimal watch wrist macro',
    description: 'Premium wrist accessory macro for watch and jewelry references.',
    category: 'accessories',
    tagsZh: ['手表', '腕表', '微距', '高级', '配饰'],
    tagsEn: ['watch', 'wristwatch', 'macro', 'premium', 'accessory'],
    facets: {
      era: 'modern',
      scene: 'soft studio macro',
      style: 'premium accessory macro',
      subject: 'minimal wristwatch',
      mood: 'precise refined',
      color: 'steel black cream',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A minimal generic wristwatch on an adult wrist, close macro view, premium soft studio lighting, refined accessory photography, no logos, no readable text or brand marks.',
  },
  {
    slug: 'structured-handbag-minimal-studio',
    title: 'Structured handbag minimal studio',
    description: 'Clean handbag product reference for premium fashion campaigns.',
    category: 'accessories',
    tagsZh: ['手袋', '包包', '极简', '棚拍', '高级时尚'],
    tagsEn: ['handbag', 'bag', 'minimal', 'studio', 'premium fashion'],
    facets: {
      era: 'modern',
      scene: 'minimal studio',
      style: 'fashion product photo',
      subject: 'structured handbag',
      mood: 'quiet premium',
      color: 'cream black silver',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A structured generic handbag on a minimal cream studio plinth, soft shadows, premium fashion product photography, no logos, no text, no brand marks.',
  },
  {
    slug: 'headphones-commute-adult-portrait',
    title: 'Headphones commute adult portrait',
    description: 'Urban audio lifestyle portrait for electronics and creator references.',
    category: 'electronics',
    tagsZh: ['成人', '耳机', '通勤', '城市', '音频', '生活方式'],
    tagsEn: ['adult', 'headphones', 'commute', 'city', 'audio', 'lifestyle'],
    facets: {
      era: 'modern',
      scene: 'subway platform',
      style: 'urban lifestyle portrait',
      subject: 'adult wearing headphones',
      mood: 'focused calm',
      color: 'grey blue white',
      region: 'global',
      aspect_ratio: '9:16',
    },
    prompt:
      'A respectful adult commuter wearing generic over-ear headphones on a subway platform, urban lifestyle portrait, shallow depth of field, no logos, no readable signs.',
  },
  {
    slug: 'skincare-model-bathroom-mirror',
    title: 'Skincare model bathroom mirror',
    description: 'Adult skincare routine reference with mirror, towel, and clean bathroom light.',
    category: 'beauty',
    tagsZh: ['成人模特', '护肤', '浴室镜子', '洁面', '清晨'],
    tagsEn: ['adult model', 'skincare', 'bathroom mirror', 'face care', 'morning'],
    facets: {
      era: 'modern',
      scene: 'bathroom mirror',
      style: 'clean routine photo',
      subject: 'adult skincare routine',
      mood: 'fresh honest',
      color: 'white aqua skin tone',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful adult model doing a skincare routine at a bathroom mirror, white towel, clean natural light, unlabeled skincare bottle, realistic routine photography, no logos, no text.',
  },
  {
    slug: 'makeup-brush-vanity-closeup',
    title: 'Makeup brush vanity closeup',
    description: 'Cosmetic texture closeup for makeup and vanity visual references.',
    category: 'beauty',
    tagsZh: ['化妆刷', '粉底', '美妆', '化妆台', '质感'],
    tagsEn: ['makeup brush', 'foundation', 'beauty', 'vanity', 'texture'],
    facets: {
      era: 'modern',
      scene: 'vanity table',
      style: 'beauty macro photo',
      subject: 'makeup brushes',
      mood: 'soft polished',
      color: 'rose beige gold',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Makeup brushes and powder texture on a vanity table, unlabeled cosmetics, soft rose beige light, realistic beauty macro photography, no logos, no readable text.',
  },
  {
    slug: 'barbershop-men-grooming-adult',
    title: 'Barbershop men grooming adult',
    description: 'Men grooming scene for haircare, beard, and lifestyle references.',
    category: 'beauty',
    tagsZh: ['成年男性', '理发店', '男士护理', '胡须', '复古'],
    tagsEn: ['adult man', 'barbershop', 'men grooming', 'beard', 'vintage'],
    facets: {
      era: 'modern',
      scene: 'barbershop',
      style: 'warm documentary photo',
      subject: 'adult grooming',
      mood: 'crafted classic',
      color: 'brown amber cream',
      region: 'global',
      aspect_ratio: '16:9',
    },
    prompt:
      'A respectful adult man in a barbershop grooming scene, barber cape without logo, warm mirror light, vintage tools, realistic documentary lifestyle photography, no readable text.',
  },
  {
    slug: 'adult-hands-jewelry-closeup',
    title: 'Adult hands jewelry closeup',
    description: 'Hands and jewelry detail for accessory, nail, and beauty references.',
    category: 'accessories',
    tagsZh: ['成人手部', '首饰', '戒指', '美甲', '细节'],
    tagsEn: ['adult hands', 'jewelry', 'rings', 'nails', 'detail'],
    facets: {
      era: 'modern',
      scene: 'soft tabletop',
      style: 'accessory detail photo',
      subject: 'hands with rings',
      mood: 'delicate',
      color: 'gold nude cream',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'Adult hands wearing generic rings with neat nails on a soft cream tabletop, delicate accessory detail photography, no logos, no text, no brand marks.',
  },
  {
    slug: 'baseball-field-cap-lifestyle',
    title: 'Baseball field cap lifestyle',
    description: 'Sporty cap and field reference for outdoor lifestyle campaigns.',
    category: 'lifestyle',
    tagsZh: ['棒球帽', '棒球场', '运动', '户外', '美式生活方式'],
    tagsEn: ['baseball cap', 'baseball field', 'sports', 'outdoor', 'american lifestyle'],
    facets: {
      era: 'modern',
      scene: 'baseball field',
      style: 'sunny lifestyle photo',
      subject: 'cap on bench',
      mood: 'sporty nostalgic',
      color: 'green tan navy',
      region: 'us',
      aspect_ratio: '16:9',
    },
    prompt:
      'A plain baseball cap on a wooden bench beside a baseball field, golden afternoon light, sporty outdoor lifestyle photography, no logos, no text.',
  },
  {
    slug: 'adult-skateboard-urban-fashion',
    title: 'Adult skateboard urban fashion',
    description: 'Street fashion and skateboard scene for youth-culture product references.',
    category: 'people',
    tagsZh: ['成人', '滑板', '街头穿搭', '城市', '运动休闲'],
    tagsEn: ['adult', 'skateboard', 'street fashion', 'city', 'sport casual'],
    facets: {
      era: 'modern',
      scene: 'urban skate spot',
      style: 'street fashion photo',
      subject: 'adult skateboarder',
      mood: 'active casual',
      color: 'concrete red blue',
      region: 'global',
      aspect_ratio: '9:16',
    },
    prompt:
      'A respectful adult skateboarder holding a generic skateboard at an urban skate spot, plain streetwear, energetic street fashion photography, no logos, no readable text.',
  },
  {
    slug: 'cowboy-hat-western-fashion-adult',
    title: 'Cowboy hat western fashion adult',
    description: 'Western hat styling reference for festival, denim, and outdoor campaigns.',
    category: 'fashion',
    tagsZh: ['成人模特', '牛仔帽', '西部风', '牛仔', '户外'],
    tagsEn: ['adult model', 'cowboy hat', 'western', 'denim', 'outdoor'],
    facets: {
      era: 'modern',
      scene: 'open field',
      style: 'western fashion portrait',
      subject: 'cowboy hat outfit',
      mood: 'free spirited',
      color: 'tan denim sky',
      region: 'us',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful adult model wearing a plain cowboy hat and denim jacket in an open field, western fashion portrait, warm natural light, no logos, no text.',
  },
  {
    slug: 'raincoat-city-adult-portrait',
    title: 'Raincoat city adult portrait',
    description: 'Rainwear and city portrait reference for outerwear and commute campaigns.',
    category: 'fashion',
    tagsZh: ['成人模特', '雨衣', '城市', '雨天', '通勤穿搭'],
    tagsEn: ['adult model', 'raincoat', 'city', 'rain', 'commute outfit'],
    facets: {
      era: 'modern',
      scene: 'rainy crosswalk',
      style: 'cinematic lifestyle portrait',
      subject: 'raincoat outfit',
      mood: 'urban practical',
      color: 'yellow grey blue',
      region: 'global',
      aspect_ratio: '9:16',
    },
    prompt:
      'A respectful adult model wearing a plain raincoat at a rainy city crosswalk, umbrella, wet reflections, cinematic lifestyle portrait, no logos, no readable text.',
  },
  {
    slug: 'chef-hands-food-prep-closeup',
    title: 'Chef hands food prep closeup',
    description: 'Hands-on cooking prep scene for food tools and kitchen product references.',
    category: 'food',
    tagsZh: ['成人手部', '厨师', '备餐', '厨房', '食材'],
    tagsEn: ['adult hands', 'chef', 'food prep', 'kitchen', 'ingredients'],
    facets: {
      era: 'modern',
      scene: 'kitchen prep counter',
      style: 'food documentary closeup',
      subject: 'hands preparing food',
      mood: 'crafted fresh',
      color: 'wood green steel',
      region: 'global',
      aspect_ratio: '16:9',
    },
    prompt:
      'Adult chef hands preparing fresh ingredients on a kitchen counter, generic knife and cutting board, realistic food documentary close-up, no logos, no readable text.',
  },
  {
    slug: 'yoga-mat-morning-lifestyle',
    title: 'Yoga mat morning lifestyle',
    description: 'Wellness scene for fitness, home, and self-care campaign references.',
    category: 'lifestyle',
    tagsZh: ['瑜伽垫', '晨练', '健康', '生活方式', '居家'],
    tagsEn: ['yoga mat', 'morning workout', 'wellness', 'lifestyle', 'home'],
    facets: {
      era: 'modern',
      scene: 'sunlit apartment',
      style: 'wellness lifestyle photo',
      subject: 'yoga mat setup',
      mood: 'calm healthy',
      color: 'sage cream sunlight',
      region: 'global',
      aspect_ratio: '9:16',
    },
    prompt:
      'A sunlit apartment wellness setup with a plain yoga mat, towel, water bottle without branding, calm morning light, realistic lifestyle photography, no text.',
  },
  {
    slug: 'office-casual-phone-adult-portrait',
    title: 'Office casual phone adult portrait',
    description:
      'Everyday creator portrait with phone for app, productivity, and social references.',
    category: 'people',
    tagsZh: ['成人', '手机', '办公休闲', '创作者', '日常'],
    tagsEn: ['adult', 'phone', 'office casual', 'creator', 'everyday'],
    facets: {
      era: 'modern',
      scene: 'bright office corner',
      style: 'creator lifestyle portrait',
      subject: 'adult holding phone',
      mood: 'approachable',
      color: 'white blue plant green',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A respectful adult creator in office casual clothing holding a generic smartphone in a bright office corner, realistic creator lifestyle portrait, no logos, no readable screen text.',
  },
  {
    slug: 'concert-neon-crowd-style',
    title: 'Concert neon crowd style',
    description: 'Music event atmosphere reference for fashion, lights, and nightlife campaigns.',
    category: 'lifestyle',
    tagsZh: ['音乐会', '霓虹', '人群', '夜生活', '氛围'],
    tagsEn: ['concert', 'neon', 'crowd', 'nightlife', 'atmosphere'],
    facets: {
      era: 'modern',
      scene: 'small concert venue',
      style: 'event photography',
      subject: 'adult crowd atmosphere',
      mood: 'electric',
      color: 'purple blue amber',
      region: 'global',
      aspect_ratio: '16:9',
    },
    prompt:
      'A small concert venue with an adult crowd atmosphere, hands raised, colorful neon stage lights, realistic event photography, no identifiable faces, no logos, no readable text.',
  },
  {
    slug: 'retro-polaroid-adult-friends-table',
    title: 'Retro polaroid adult friends table',
    description: 'Casual adult friend group table scene for nostalgic social references.',
    category: 'people',
    tagsZh: ['成人朋友', '复古', '拍立得', '餐桌', '聚会'],
    tagsEn: ['adult friends', 'retro', 'polaroid', 'table', 'gathering'],
    facets: {
      era: '1990s',
      scene: 'dinner table',
      style: 'analog flash photo',
      subject: 'adult friend group',
      mood: 'friendly nostalgic',
      color: 'warm flash cream',
      region: 'global',
      aspect_ratio: '4:5',
    },
    prompt:
      'A casual group of adult friends around a dinner table, retro instant-camera flash look, candid nostalgic atmosphere, generic tableware, no logos, no readable text.',
  },
];

const BASE_SEEDS: InspirationSeed[] = [...DEFAULT_SEEDS, ...ADDITIONAL_SEEDS];

const EXPANDED_SEEDS: InspirationSeed[] = [
  ...BASE_SEEDS,
  ...BASE_SEEDS.map((seed) => ({
    ...seed,
    slug: `${seed.slug}-vertical`,
    title: `${seed.title} vertical`,
    facets: { ...seed.facets, aspect_ratio: '9:16' },
    tagsEn: [...seed.tagsEn, 'vertical composition', 'short video reference'],
    tagsZh: [...seed.tagsZh, '竖屏构图', '短视频参考'],
    prompt: `${seed.prompt} Compose it as a vertical social video reference with strong foreground, midground, and background separation.`,
  })),
];

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    force: false,
    skipImages: false,
    ensureSearchIndex: false,
    indexOnly: false,
    limit: null,
    category: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--skip-images') opts.skipImages = true;
    else if (arg === '--ensure-search-index') opts.ensureSearchIndex = true;
    else if (arg === '--index-only') opts.indexOnly = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--category') opts.category = String(argv[++i] ?? '').trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (opts.limit !== null && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
    throw new Error('--limit must be a positive integer');
  }
  return opts;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readR2Settings(): R2Settings {
  return {
    accountId: readRequiredEnv('R2_ACCOUNT_ID'),
    bucket: readRequiredEnv('R2_BUCKET'),
    accessKeyId: readRequiredEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: readRequiredEnv('R2_SECRET_ACCESS_KEY'),
    publicBaseUrl: readRequiredEnv('R2_PUBLIC_BASE_URL'),
  };
}

function readProxyUrl(): string | null {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    null
  );
}

async function configureFetchProxy(): Promise<void> {
  const proxy = readProxyUrl();
  if (!proxy) return;

  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new ProxyAgent(proxy));
}

function makeOpenAI(apiKey: string): OpenAI {
  const proxy = readProxyUrl();
  return new OpenAI({
    apiKey,
    ...(proxy ? { httpAgent: new HttpsProxyAgent(proxy) } : {}),
  });
}

function makeS3(settings: R2Settings): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
}

/** "16:9" → 1.78；解析失败返回 null。 */
function parseAspectRatio(value: string): number | null {
  const match = /^(\d+)\s*:\s*(\d+)$/.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return width / height;
}

/**
 * 把 seed 声明的 aspect_ratio 映射到 gpt-image-1 支持的最接近尺寸。
 * 保证真实生成的画幅和写进库的 facets.aspect_ratio 不矛盾。
 */
function resolveImageSize(seed: InspirationSeed): string {
  const ratio = parseAspectRatio(seed.facets.aspect_ratio);
  if (ratio === null) return FALLBACK_IMAGE_SIZE;

  const candidates = [
    { size: IMAGE_SIZES.landscape, value: 1536 / 1024 },
    { size: IMAGE_SIZES.square, value: 1 },
    { size: IMAGE_SIZES.portrait, value: 1024 / 1536 },
  ];
  let best = candidates[0]!;
  for (const candidate of candidates.slice(1)) {
    if (Math.abs(ratio - candidate.value) < Math.abs(ratio - best.value)) best = candidate;
  }
  return best.size;
}

async function generateImage(openai: OpenAI, seed: InspirationSeed): Promise<Buffer> {
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
  const response = await openai.images.generate({
    model,
    prompt: buildPrompt(seed),
    size: resolveImageSize(seed),
    n: 1,
  } as never);

  const image = (response.data ?? [])[0] as { b64_json?: string; url?: string } | undefined;
  if (!image) throw new Error('OpenAI image response is empty');
  if (image.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image.url) return downloadImage(image.url);
  throw new Error('OpenAI image response has neither b64_json nor url');
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to download OpenAI image: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function uploadImage(args: {
  s3: S3Client;
  settings: R2Settings;
  seed: InspirationSeed;
  body: Buffer;
}): Promise<{ key: string; url: string; size: number }> {
  const safeEra = args.seed.facets.era.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const key = `inspiration/${args.seed.category}/${safeEra}/${args.seed.slug}.png`;
  await args.s3.send(
    new PutObjectCommand({
      Bucket: args.settings.bucket,
      Key: key,
      Body: args.body,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  const base = args.settings.publicBaseUrl.replace(/\/+$/, '');
  return { key, url: `${base}/${key}`, size: args.body.byteLength };
}

async function embed(openai: OpenAI, text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMS,
  });
  return response.data[0]!.embedding;
}

async function ensureRegularIndexes(collection: Collection<Document>): Promise<void> {
  await collection.createIndex({ status: 1, kind: 1, category: 1, updated_at: -1 });
  await collection.createIndex({ asset_id: 1 }, { unique: true });
  await collection.createIndex({ category: 1, 'facets.era': 1, 'facets.aspect_ratio': 1 });
  await collection.createIndex({ batch_id: 1, status: 1 });
}

async function ensureVectorSearchIndex(collection: Collection<Document>): Promise<void> {
  const anyCollection = collection as unknown as {
    listSearchIndexes?: () => AsyncIterable<Document>;
    createSearchIndex?: (index: Document) => Promise<string>;
  };
  if (!anyCollection.listSearchIndexes || !anyCollection.createSearchIndex) {
    console.warn(
      'MongoDB driver does not expose search index helpers; skip vector index creation.',
    );
    return;
  }

  for await (const index of anyCollection.listSearchIndexes()) {
    if (index.name === INSPIRATION_VECTOR_INDEX) {
      console.log(`Vector search index exists: ${INSPIRATION_VECTOR_INDEX}`);
      return;
    }
  }

  await anyCollection.createSearchIndex({
    name: INSPIRATION_VECTOR_INDEX,
    type: 'vectorSearch',
    definition: {
      fields: [
        {
          type: 'vector',
          path: 'embedding_tags',
          numDimensions: EMBEDDING_DIMS,
          similarity: 'cosine',
        },
        { type: 'filter', path: 'status' },
        { type: 'filter', path: 'kind' },
        { type: 'filter', path: 'category' },
        { type: 'filter', path: 'facets.era' },
        { type: 'filter', path: 'facets.style' },
        { type: 'filter', path: 'facets.aspect_ratio' },
      ],
    },
  });
  console.log(`Created vector search index: ${INSPIRATION_VECTOR_INDEX}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const seeds = EXPANDED_SEEDS.filter(
    (seed) => !opts.category || seed.category === opts.category,
  ).slice(0, opts.limit ?? undefined);

  console.log(
    `Preparing ${seeds.length} inspiration assets` +
      ` (dryRun=${opts.dryRun}, force=${opts.force}, skipImages=${opts.skipImages})`,
  );

  if (opts.dryRun) {
    for (const seed of seeds.slice(0, 12)) {
      console.log(`\n[${seed.slug}] ${seed.title}`);
      console.log(embeddingText(seed));
      console.log(buildPrompt(seed));
    }
    if (seeds.length > 12) console.log(`\n... ${seeds.length - 12} more`);
    return;
  }

  await configureFetchProxy();

  const mongoUri = readRequiredEnv('MONGODB_URI');
  const dbName =
    process.env.INSPIRATION_MONGODB_DB?.trim() ||
    process.env.STUDIO_MONGODB_DB?.trim() ||
    'lumen_app';
  const openai = opts.indexOnly ? null : makeOpenAI(readRequiredEnv('OPENAI_API_KEY'));
  const r2 = opts.skipImages || opts.indexOnly ? null : readR2Settings();
  const s3 = r2 ? makeS3(r2) : null;

  const mongo = new MongoClient(mongoUri, { appName: 'lumen-agent-inspiration-seed' });
  await mongo.connect();
  try {
    const collection = mongo.db(dbName).collection(INSPIRATION_ASSETS_COLLECTION);
    await ensureRegularIndexes(collection);
    if (opts.ensureSearchIndex) await ensureVectorSearchIndex(collection);
    if (opts.indexOnly) {
      console.log(`Indexes are ready for ${dbName}.${INSPIRATION_ASSETS_COLLECTION}`);
      return;
    }

    let done = 0;
    for (const seed of seeds) {
      const assetId = `insp_${seed.slug}`;
      const existing = await collection.findOne({ asset_id: assetId });
      if (existing && !opts.force) {
        console.log(`[skip] ${assetId}`);
        continue;
      }

      console.log(`[seed] ${assetId}`);
      const existingUrl = typeof existing?.cdn_url === 'string' ? existing.cdn_url : '';
      const existingKey = typeof existing?.r2_key === 'string' ? existing.r2_key : '';
      let upload = existingUrl
        ? { key: existingKey, url: existingUrl, size: existing.size ?? 0 }
        : null;

      if (!opts.skipImages) {
        if (!s3 || !r2) throw new Error('R2 client is not configured');
        if (!openai) throw new Error('OpenAI client is not configured');
        const body = await generateImage(openai, seed);
        upload = await uploadImage({ s3, settings: r2, seed, body });
      }

      if (!upload?.url) {
        throw new Error(
          `No image URL available for ${assetId}; remove --skip-images or seed once first`,
        );
      }

      const now = new Date();
      const text = embeddingText(seed);
      if (!openai) throw new Error('OpenAI client is not configured');
      const embedding = await embed(openai, text);
      await collection.updateOne(
        { asset_id: assetId },
        {
          $set: {
            asset_id: assetId,
            kind: 'image',
            source: 'ai_generated',
            title: seed.title,
            description: seed.description,
            cdn_url: upload.url,
            thumbnail_url: upload.url,
            r2_key: upload.key,
            content_type: 'image/png',
            size: upload.size,
            category: seed.category,
            facets: seed.facets,
            tags_zh: seed.tagsZh,
            tags_en: seed.tagsEn,
            embedding_text: text,
            embedding_tags: embedding,
            embedding_model: EMBEDDING_MODEL,
            generation_prompt: buildPrompt(seed),
            generation_model: process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL,
            generation_params: {
              size: resolveImageSize(seed),
            },
            batch_id: 'initial-inspiration-v1',
            quality_score: 1,
            status: 'published',
            updated_at: now,
          },
          $setOnInsert: {
            _id: assetId,
            created_at: now,
          },
        },
        { upsert: true },
      );
      done += 1;
      console.log(`[ok] ${assetId} -> ${upload.url}`);
    }
    console.log(
      `Done. Upserted/updated ${done} assets in ${dbName}.${INSPIRATION_ASSETS_COLLECTION}`,
    );
  } finally {
    await mongo.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
