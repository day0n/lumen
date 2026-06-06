import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  HomeWorkflowTemplateRepository,
  type ProjectCanvas,
  type UpsertHomeWorkflowTemplateInput,
  closeMongoDatabases,
  closeRedisClients,
  getMongoDatabase,
  getRedisClient,
} from '@lumen/db';
import { config as dotenvConfig } from 'dotenv';

const envFile = resolve(process.cwd(), '.env.local');
if (existsSync(envFile)) {
  dotenvConfig({ path: envFile });
}

type MediaType = 'image' | 'video';
type WorkflowShape = 'hook' | 'visual' | 'script' | 'kit';

interface WorkflowResultDocument {
  _id: string;
  run_id?: string;
  project_id?: string | null;
  workflow_id?: string | null;
  node_id?: string;
  status?: string;
  output_type?: MediaType;
  output_value?: string;
  asset?: {
    url?: string;
  };
  input?: {
    prompt?: string;
  };
  updated_at?: Date;
}

interface ResultSeed {
  id: string;
  runId: string;
  projectId: string;
  nodeId: string;
  mediaType: MediaType;
  url: string;
  prompt: string;
  updatedAt: Date;
}

interface CatalogEntry {
  slug: string;
  categoryId: string;
  categorySortOrder: number;
  categoryLabelZh: string;
  categoryLabelEn: string;
  titleZh: string;
  titleEn: string;
  subtitleZh: string;
  subtitleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  badgeZh: string;
  badgeEn: string;
  tags: string[];
  shape: WorkflowShape;
  briefZh: string;
  briefEn: string;
  visualPrompt: string;
}

const CATEGORIES = [
  { id: 'sales-openers', sortOrder: 0, zh: '带货开场', en: 'Sales Openers' },
  { id: 'product-scenes', sortOrder: 1, zh: '商品场景', en: 'Product Scenes' },
  { id: 'creator-scripts', sortOrder: 2, zh: '口播脚本', en: 'Creator Scripts' },
  { id: 'asset-kits', sortOrder: 3, zh: '素材套组', en: 'Asset Kits' },
] as const;

const CATALOG: CatalogEntry[] = [
  entry(
    'sales-openers',
    'pain-hook-sequence',
    '3秒痛点钩子',
    'Three-Second Pain Hook',
    '先抛痛点再给解决方案',
    'Problem-first conversion opener',
    '把使用前困扰、产品入场和结果镜头拆成可直接运行的短视频开场。',
    'Turns a customer pain point into a runnable opener with setup, product reveal, and payoff.',
    '转化开场',
    'Hook',
    ['pain point', 'hook', 'conversion'],
    'hook',
    '围绕一个真实使用痛点，生成开场问题、利益点字幕和镜头节奏。',
    'Draft a pain-led hook, benefit captions, and shot rhythm for one product.',
    'Create a direct-response opener with a clear before state, product reveal, and visual payoff.',
  ),
  entry(
    'sales-openers',
    'price-anchor-cut',
    '价格锚点快切',
    'Price Anchor Cut',
    '用价格对比降低决策成本',
    'Value framing with quick cuts',
    '生成价格利益点、赠品提示和行动召唤，适合优惠期素材。',
    'Builds price framing, bundle notes, and a fast call to action for promotion windows.',
    '促销',
    'Offer',
    ['price', 'offer', 'bundle'],
    'hook',
    '提炼优惠信息，设计三段式价格锚点和下单理由。',
    'Extract the offer and design a three-part value anchor.',
    'Make a punchy offer-led commerce visual with clear price value and product proof.',
  ),
  entry(
    'sales-openers',
    'comment-reply-opener',
    '评论反问开场',
    'Comment Reply Opener',
    '把用户疑问变成脚本入口',
    'Turn objections into the first line',
    '从评论疑问切入，自动生成反问、演示和信任补充。',
    'Starts from a buyer objection, then generates a reply, demo, and proof beat.',
    '互动',
    'Reply',
    ['comment', 'objection', 'demo'],
    'script',
    '写一个像回复评论一样自然的开场，并列出要展示的证据。',
    'Write a natural comment-reply opener and list the proof to show.',
    'Produce a creator-style reply scene with product proof and a calm conversion beat.',
  ),
  entry(
    'sales-openers',
    'launch-countdown-flow',
    '新品倒计时发布',
    'Launch Countdown Flow',
    '适合新品首发和补货提醒',
    'For drops, launches, and restocks',
    '组合倒计时、关键卖点和稀缺感镜头，形成新品发布工作流。',
    'Combines countdown, key claims, and urgency shots for launch-ready content.',
    '新品',
    'Launch',
    ['launch', 'countdown', 'new'],
    'hook',
    '规划新品发布的倒计时文案、主卖点和最后行动句。',
    'Plan launch countdown copy, primary claims, and closing action line.',
    'Generate a clean launch visual with countdown energy and product-first framing.',
  ),
  entry(
    'sales-openers',
    'before-after-proof',
    '前后对比证明',
    'Before-After Proof',
    '用结果差异制造停留',
    'Retention through visible contrast',
    '把对比画面、解释字幕和结论收束成可执行节点。',
    'Turns contrast shots, explanation captions, and the final takeaway into runnable nodes.',
    '对比',
    'Proof',
    ['before after', 'proof', 'retention'],
    'visual',
    '列出对比前状态、对比后状态和需要强调的细节。',
    'List the before state, after state, and details worth emphasizing.',
    'Create a comparison visual with clear contrast, simple captions, and product relevance.',
  ),
  entry(
    'sales-openers',
    'feature-challenge-open',
    '功能挑战开场',
    'Feature Challenge Opener',
    '用小挑战证明功能',
    'Show the feature under pressure',
    '围绕一个可视化挑战设计镜头，用结果来解释产品能力。',
    'Designs a visual challenge where the outcome explains the product capability.',
    '挑战',
    'Challenge',
    ['challenge', 'feature', 'proof'],
    'hook',
    '设计一个能在前5秒看懂的产品功能挑战。',
    'Design a product challenge that is clear in the first five seconds.',
    'Create a challenge-style scene where product performance is immediately visible.',
  ),
  entry(
    'sales-openers',
    'unbox-trust-proof',
    '开箱信任证明',
    'Unbox Trust Proof',
    '从包装到实物细节建立信任',
    'Build trust from package to details',
    '生成开箱、细节、质感和使用场景的连贯镜头。',
    'Creates a flow from unboxing to detail proof, texture, and real use.',
    '开箱',
    'Unbox',
    ['unboxing', 'trust', 'detail'],
    'visual',
    '拆解开箱流程，标注包装、材质和第一眼信任点。',
    'Break down packaging, material cues, and first-look trust points.',
    'Create a tactile unboxing visual with product details and clean lighting.',
  ),
  entry(
    'sales-openers',
    'repurchase-reason-list',
    '复购理由清单',
    'Repurchase Reason List',
    '把卖点变成用户理由',
    'Turn claims into buyer reasons',
    '自动生成复购理由、字幕顺序和补充镜头提示。',
    'Generates repeat-purchase reasons, caption order, and supporting shot prompts.',
    '清单',
    'List',
    ['reasons', 'repeat', 'list'],
    'script',
    '把产品卖点改写成用户会复购的三个理由。',
    'Rewrite product claims as three reasons buyers would come back.',
    'Build a reason-list scene with concise captions and credible product visuals.',
  ),
  entry(
    'sales-openers',
    'gift-angle-pitch',
    '送礼场景开场',
    'Gift-Angle Pitch',
    '把商品切成礼物理由',
    'Frame the product as a gift',
    '生成节日、关系和场景化送礼理由，适合轻转化素材。',
    'Creates occasion, relationship, and use-case reasons for giftable products.',
    '送礼',
    'Gift',
    ['gift', 'occasion', 'soft sell'],
    'hook',
    '写出一个不过度促销的送礼开场和镜头节奏。',
    'Write a gentle gift-led opener and shot rhythm.',
    'Create a warm gift scenario with product close-ups and a clear occasion.',
  ),

  entry(
    'product-scenes',
    'texture-macro-lab',
    '质地微距实验室',
    'Texture Macro Lab',
    '突出材质、液体和表面细节',
    'Macro product texture shots',
    '将质地卖点转成微距镜头、灯光和慢动作提示。',
    'Turns texture claims into macro shots, lighting notes, and slow-motion prompts.',
    '微距',
    'Macro',
    ['texture', 'macro', 'detail'],
    'visual',
    '总结产品质地、触感和适合的微距镜头。',
    'Summarize texture, tactility, and the right macro shot.',
    'Create a premium macro scene emphasizing material texture and light behavior.',
  ),
  entry(
    'product-scenes',
    'desk-setup-demo',
    '桌面场景演示',
    'Desk Setup Demo',
    '适合3C和办公用品',
    'For gadgets and workspace items',
    '生成从桌面入场、功能展示到收纳结尾的工作流。',
    'Creates a workspace flow from reveal, to function, to tidy closing shot.',
    '场景',
    'Scene',
    ['desk', 'gadget', 'workspace'],
    'visual',
    '规划桌面使用场景，突出一个功能和一个效率利益点。',
    'Plan a workspace scene around one feature and one efficiency benefit.',
    'Create a clean desktop product scene with practical use and controlled lighting.',
  ),
  entry(
    'product-scenes',
    'outdoor-use-story',
    '户外使用短片',
    'Outdoor Use Story',
    '把商品放进真实行动场景',
    'Put the product into motion',
    '适合水杯、鞋服、包袋等户外场景的镜头生成。',
    'Generates motion-friendly scenes for bottles, shoes, bags, and outdoor goods.',
    '户外',
    'Outdoor',
    ['outdoor', 'motion', 'lifestyle'],
    'visual',
    '给商品设计一个户外使用情境，包含动作、环境和结尾。',
    'Design an outdoor use case with action, environment, and final beat.',
    'Create a lifestyle outdoor product scene with natural movement and clear product presence.',
  ),
  entry(
    'product-scenes',
    'kitchen-closeup-flow',
    '厨房近景流程',
    'Kitchen Close-Up Flow',
    '适合食品和家居日用',
    'Food and home utility close-ups',
    '从准备、使用、结果三个镜头组织可运行画布。',
    'Organizes prep, use, and result shots into a runnable canvas.',
    '近景',
    'Close-up',
    ['kitchen', 'food', 'home'],
    'visual',
    '拆出厨房场景里的准备动作、使用动作和结果画面。',
    'Split a kitchen scene into prep, use, and result shots.',
    'Create a close-up kitchen scene with satisfying product interaction.',
  ),
  entry(
    'product-scenes',
    'fashion-fit-check',
    '穿搭版型检查',
    'Fashion Fit Check',
    '突出轮廓、材质和搭配',
    'Fit, silhouette, and styling',
    '为服饰商品生成上身展示、局部细节和场景收束。',
    'Builds try-on, detail, and lifestyle closing shots for apparel.',
    '穿搭',
    'Fit',
    ['fashion', 'fit', 'styling'],
    'visual',
    '列出服饰的版型、材质、搭配场景和镜头顺序。',
    'List fit, material, styling scenario, and shot order.',
    'Create a fashion fit-check scene with clean movement and detail emphasis.',
  ),
  entry(
    'product-scenes',
    'beauty-routine-steps',
    '护肤步骤流程',
    'Beauty Routine Steps',
    '把使用顺序拍清楚',
    'Make the routine easy to follow',
    '生成使用前、质地、上脸和结果的连续节点。',
    'Creates consecutive nodes for before, texture, application, and result.',
    '护肤',
    'Routine',
    ['beauty', 'routine', 'skin'],
    'script',
    '把护肤产品拆成使用步骤、注意事项和镜头说明。',
    'Break a beauty product into steps, notes, and shot directions.',
    'Create a clean beauty routine visual with texture and face-safe framing.',
  ),
  entry(
    'product-scenes',
    'home-mood-shot',
    '家居氛围镜头',
    'Home Mood Shot',
    '适合香氛、灯具和软装',
    'For fragrance, lighting, and decor',
    '自动生成氛围、光线和生活方式镜头描述。',
    'Generates mood, lighting, and lifestyle shot prompts for home goods.',
    '家居',
    'Home',
    ['home', 'mood', 'decor'],
    'visual',
    '描述一个安静的家居使用时刻，突出氛围和产品位置。',
    'Describe a calm home moment with mood and product placement.',
    'Create a home lifestyle scene with soft light, real placement, and product clarity.',
  ),
  entry(
    'product-scenes',
    'pet-friendly-demo',
    '宠物友好演示',
    'Pet-Friendly Demo',
    '展示安全、耐用和陪伴感',
    'Safety, durability, and warmth',
    '把宠物用品或耐用商品做成有情绪的演示镜头。',
    'Turns pet or durable goods into a warm demonstration scene.',
    '陪伴',
    'Pet',
    ['pet', 'durable', 'warm'],
    'visual',
    '规划一个宠物参与的安全演示，避免夸张承诺。',
    'Plan a pet-involved safety demo without exaggerated claims.',
    'Create a warm pet-friendly product scene with clear interaction.',
  ),
  entry(
    'product-scenes',
    'travel-pack-shot',
    '旅行收纳镜头',
    'Travel Pack Shot',
    '强调便携、容量和秩序',
    'Portability, capacity, order',
    '生成收纳、携带和到达后的三段式商品画面。',
    'Creates packing, carrying, and arrival visuals for portable products.',
    '旅行',
    'Travel',
    ['travel', 'packing', 'portable'],
    'visual',
    '写出旅行场景中的收纳动作、容量证明和使用结尾。',
    'Write packing action, capacity proof, and use-case ending.',
    'Create a travel packing scene with organized composition and practical detail.',
  ),

  entry(
    'creator-scripts',
    'soft-spoken-review',
    '温和测评口播',
    'Soft-Spoken Review',
    '自然讲清利益点',
    'A calm creator review script',
    '生成真人口播结构、镜头提示和可信措辞。',
    'Generates a creator review structure, shot notes, and credible phrasing.',
    '口播',
    'Review',
    ['review', 'creator', 'trust'],
    'script',
    '写一个像真实测评一样的开场、体验和总结。',
    'Write an opener, experience beat, and summary like a real review.',
    'Create a creator review scene with natural delivery and product support shots.',
  ),
  entry(
    'creator-scripts',
    'problem-solution-talk',
    '问题解决口播',
    'Problem-Solution Talk',
    '先说困扰再演示',
    'A clear problem-to-solution arc',
    '把口播拆成痛点、演示、结果和购买理由。',
    'Breaks the script into pain point, demo, result, and buying reason.',
    '解决方案',
    'Solution',
    ['problem', 'solution', 'talking'],
    'script',
    '围绕一个用户困扰写出口播脚本和镜头搭配。',
    'Write a talking script and shot pairing around one customer problem.',
    'Create a talking-head product solution scene with clear demonstration inserts.',
  ),
  entry(
    'creator-scripts',
    'multi-language-short',
    '多语种短口播',
    'Multilingual Short Script',
    '适合跨境素材快速本地化',
    'Quick localization for commerce clips',
    '生成可翻译短句、镜头顺序和字幕节奏。',
    'Creates translatable short lines, shot order, and subtitle rhythm.',
    '多语种',
    'Localized',
    ['localization', 'subtitle', 'global'],
    'script',
    '写一版短句式口播，方便翻译成多语言字幕。',
    'Write short spoken lines that are easy to localize.',
    'Create a simple creator-led scene with clean subtitle-safe framing.',
  ),
  entry(
    'creator-scripts',
    'objection-handling-script',
    '疑虑化解脚本',
    'Objection Handling Script',
    '把犹豫点逐个拆掉',
    'Address hesitation one by one',
    '提取常见疑虑，生成回应话术和证明镜头。',
    'Extracts buyer hesitations, then generates response lines and proof shots.',
    '答疑',
    'Objection',
    ['objection', 'faq', 'proof'],
    'script',
    '列出三个购买疑虑，并分别写出回应和证据。',
    'List three buying objections with response and proof.',
    'Create a concise FAQ-style creator scene with visible product evidence.',
  ),
  entry(
    'creator-scripts',
    'day-in-life-insert',
    '一天使用植入',
    'Day-in-Life Insert',
    '把产品放进生活节奏',
    'Place the product inside a routine',
    '生成早中晚使用点、过渡和柔性转化句。',
    'Builds morning, midday, evening beats with soft conversion lines.',
    '生活流',
    'Routine',
    ['day in life', 'routine', 'soft sell'],
    'script',
    '设计一天中三个自然出现商品的时刻。',
    'Design three natural moments where the product appears in a day.',
    'Create a day-in-life scene with natural product presence and gentle pacing.',
  ),
  entry(
    'creator-scripts',
    'expert-tone-explainer',
    '专业解释口播',
    'Expert-Tone Explainer',
    '适合成分、参数和原理',
    'For ingredients, specs, and mechanisms',
    '把复杂卖点改成容易听懂的解释型短视频。',
    'Turns complex claims into an easy-to-follow explainer clip.',
    '解释',
    'Explainer',
    ['education', 'specs', 'explain'],
    'script',
    '把专业卖点翻译成普通用户能听懂的三句话。',
    'Translate expert claims into three plain-language lines.',
    'Create an educational creator scene with supporting close-ups and simple captions.',
  ),
  entry(
    'creator-scripts',
    'testimonial-thread',
    '真实反馈串联',
    'Testimonial Thread',
    '用反馈组织信任链路',
    'String together believable feedback',
    '生成反馈摘录、展示顺序和结论镜头。',
    'Generates testimonial excerpts, display order, and closing scene.',
    '反馈',
    'Feedback',
    ['testimonial', 'feedback', 'trust'],
    'script',
    '写出三条可信反馈，并安排对应镜头。',
    'Write three believable feedback lines and matching shots.',
    'Create a feedback-led creator scene with grounded product visuals.',
  ),
  entry(
    'creator-scripts',
    'comparison-talking-points',
    '对比讲解脚本',
    'Comparison Talking Points',
    '突出差异但不过度攻击',
    'Contrast without sounding harsh',
    '生成对比维度、措辞边界和画面说明。',
    'Creates comparison dimensions, wording guardrails, and visual notes.',
    '对比讲解',
    'Compare',
    ['comparison', 'talking points', 'safe claims'],
    'script',
    '列出产品对比维度，并写出克制的讲解文案。',
    'List comparison dimensions and write restrained explanation copy.',
    'Create a comparison explainer scene with side-by-side product details.',
  ),
  entry(
    'creator-scripts',
    'live-room-preview',
    '直播间预热视频',
    'Live Preview Clip',
    '为直播前预热利益点',
    'Warm up before a live session',
    '生成直播预告、福利提示和开播行动句。',
    'Builds a preview clip with live benefits and start-time action line.',
    '直播预热',
    'Live',
    ['live', 'preview', 'offer'],
    'hook',
    '写一个直播前预热视频，包含福利、时间和商品亮点。',
    'Write a live preview clip with benefit, time, and product highlight.',
    'Create a live-preview commerce scene with energetic but clear framing.',
  ),

  entry(
    'asset-kits',
    'main-image-variant-set',
    '主图变体套组',
    'Main Image Variant Set',
    '一张结果扩展多种主图方向',
    'Turn one output into listing variants',
    '保存主图风格、构图和可复用提示，便于继续衍生。',
    'Stores style, composition, and reusable prompts for listing variants.',
    '主图',
    'Listing',
    ['main image', 'variant', 'listing'],
    'kit',
    '整理主图需要保留的构图、背景和卖点文字。',
    'Organize composition, background, and selling text for a listing image.',
    'Create a commerce-ready main image with clear product silhouette and clean background.',
  ),
  entry(
    'asset-kits',
    'style-consistency-board',
    '风格一致性画板',
    'Style Consistency Board',
    '沉淀颜色、光线和构图规则',
    'Save color, light, and framing rules',
    '把运行结果转成可复用风格板，后续节点可继续引用。',
    'Turns the run result into a reusable style board for future nodes.',
    '风格',
    'Style',
    ['style', 'consistency', 'board'],
    'kit',
    '提炼画面的色彩、光线、构图和适合延展的品类。',
    'Extract color, light, composition, and extension categories.',
    'Create a style-consistent product visual that can guide future assets.',
  ),
  entry(
    'asset-kits',
    'ad-scene-pack',
    '广告场景素材包',
    'Ad Scene Pack',
    '为投放准备多镜头素材',
    'Prepare multi-shot ad assets',
    '生成主视觉、细节镜头和补充字幕的素材节点。',
    'Creates hero, detail, and caption-support nodes for ad production.',
    '投放素材',
    'Ad Kit',
    ['ad', 'scene', 'assets'],
    'kit',
    '把广告素材拆成主视觉、细节图和字幕承接。',
    'Split ad assets into hero visual, detail shot, and caption support.',
    'Create a polished ad-scene visual with product-first composition.',
  ),
  entry(
    'asset-kits',
    'social-cover-maker',
    '社媒封面生成器',
    'Social Cover Maker',
    '适合短视频封面和帖子头图',
    'For covers and post headers',
    '输出醒目封面、标题安全区和平台裁切提示。',
    'Creates a strong cover, title-safe area, and crop notes.',
    '封面',
    'Cover',
    ['cover', 'social', 'thumbnail'],
    'kit',
    '设计一张可放标题的社媒封面，并说明安全区。',
    'Design a social cover with room for title text and safe areas.',
    'Create a bold social cover visual with readable negative space.',
  ),
  entry(
    'asset-kits',
    'storyboard-contact-sheet',
    '分镜联系表',
    'Storyboard Contact Sheet',
    '把视频想法拆成可检查画面',
    'Review the story as still frames',
    '生成分镜结构、镜头用途和继续执行提示。',
    'Generates storyboard structure, shot purpose, and next-run prompts.',
    '分镜',
    'Storyboard',
    ['storyboard', 'shots', 'planning'],
    'kit',
    '把短片拆成起承转合四个分镜，并标记每镜用途。',
    'Break a clip into four storyboard beats and mark each purpose.',
    'Create a storyboard-style visual with distinct beats and clear continuity.',
  ),
  entry(
    'asset-kits',
    'product-detail-bank',
    '商品细节素材库',
    'Product Detail Bank',
    '沉淀材质、包装和使用细节',
    'Capture material, package, and use details',
    '从结果中扩展细节素材，方便后续组合成广告。',
    'Extends result details into reusable assets for future ads.',
    '细节库',
    'Detail Bank',
    ['detail', 'package', 'materials'],
    'kit',
    '整理可复用的包装、材质、尺寸和使用细节。',
    'Organize reusable package, material, size, and usage details.',
    'Create a product detail visual with strong texture and accurate focus.',
  ),
  entry(
    'asset-kits',
    'seasonal-campaign-kit',
    '季节活动套组',
    'Seasonal Campaign Kit',
    '围绕季节和节日做延展',
    'Extend around season and occasion',
    '生成季节主题、配色、场景和二次创作节点。',
    'Creates seasonal theme, palette, scene, and remix nodes.',
    '季节',
    'Seasonal',
    ['seasonal', 'campaign', 'occasion'],
    'kit',
    '提炼适合季节活动的场景、配色和标题方向。',
    'Extract scene, palette, and title direction for a seasonal campaign.',
    'Create a seasonal commerce visual with occasion cues and product clarity.',
  ),
  entry(
    'asset-kits',
    'ugc-b-roll-pack',
    'UGC补充镜头包',
    'UGC B-Roll Pack',
    '补齐手部、细节和环境镜头',
    'Fill hand, detail, and context shots',
    '把一个结果延展成 UGC 可剪辑的 B-roll 素材。',
    'Extends one result into editable b-roll for creator-style clips.',
    'B-roll',
    'B-roll',
    ['ugc', 'b-roll', 'editing'],
    'kit',
    '列出UGC短片需要补拍的手部、环境和细节镜头。',
    'List hand, environment, and detail b-roll for a creator clip.',
    'Create a b-roll style product scene with natural hand interaction.',
  ),
  entry(
    'asset-kits',
    'marketplace-image-set',
    '平台商品图套组',
    'Marketplace Image Set',
    '主图、场景图和卖点图一次规划',
    'Plan hero, scene, and benefit images',
    '生成电商上架所需的多图结构和素材节点。',
    'Creates the multi-image structure needed for marketplace listings.',
    '上架',
    'Marketplace',
    ['marketplace', 'image set', 'ecommerce'],
    'kit',
    '规划平台商品图的主图、场景图和卖点图顺序。',
    'Plan hero, scene, and benefit image order for marketplace listings.',
    'Create a marketplace-ready product image with clean product hierarchy.',
  ),
];

const dryRun = process.argv.includes('--dry-run');

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([closeMongoDatabases(), closeRedisClients()]);
  });

async function main() {
  if (CATALOG.length !== 36) {
    throw new Error(`Expected 36 catalog entries, found ${CATALOG.length}`);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const appDbName = process.env.MONGODB_DB || 'lumen_app';
  const workflowDbName = process.env.WORKFLOW_MONGODB_DB || 'lumen_engine';

  const appDb = await getMongoDatabase({
    uri,
    dbName: appDbName,
    appName: 'lumen-studio-seed-home-templates',
  });
  const workflowDb = await getMongoDatabase({
    uri,
    dbName: workflowDbName,
    appName: 'lumen-studio-seed-home-templates-workflow',
  });

  const results = await loadResultSeeds(workflowDb);
  if (results.length < CATALOG.length) {
    throw new Error(`Need ${CATALOG.length} distinct workflow results, found ${results.length}`);
  }

  const documents = CATALOG.map((item, index) => toTemplateInput(item, results[index], index));

  console.log(
    JSON.stringify(
      {
        dryRun,
        appDbName,
        workflowDbName,
        templates: documents.length,
        categories: summarizeCategories(documents),
        sample: documents.slice(0, 4).map((document) => ({
          id: document._id,
          category: document.category_label,
          title: document.title,
          mediaType: document.media_type,
          sourceRunId: document.source_run_id,
          resultNodeId: document.result_node_id,
          coverUrl: document.cover_url,
        })),
      },
      null,
      2,
    ),
  );

  if (dryRun) return;

  const repository = new HomeWorkflowTemplateRepository(appDb);
  await repository.ensureIndexes();
  const changed = await repository.upsertMany(documents);
  const hidden = await repository.hideMissing(documents.map((document) => document._id));
  await clearHomeTemplateCache();
  console.log(`[seed] upserted/modified ${changed}, hidden ${hidden}`);
}

async function loadResultSeeds(workflowDb: Awaited<ReturnType<typeof getMongoDatabase>>) {
  const documents = await workflowDb
    .collection<WorkflowResultDocument>('workflow_node_results')
    .find(
      {
        status: 'success',
        output_type: { $in: ['image', 'video'] },
        $or: [{ 'asset.url': { $type: 'string', $ne: '' } }, { output_value: /^https?:\/\// }],
      },
      {
        projection: {
          _id: 1,
          run_id: 1,
          project_id: 1,
          workflow_id: 1,
          node_id: 1,
          output_type: 1,
          output_value: 1,
          'asset.url': 1,
          input: 1,
          updated_at: 1,
        },
      },
    )
    .sort({ updated_at: -1 })
    .limit(240)
    .toArray();

  const seenUrls = new Set<string>();
  const seeds: ResultSeed[] = [];
  for (const document of documents) {
    const url = normalizeUrl(document.asset?.url) ?? normalizeUrl(document.output_value);
    const mediaType = document.output_type === 'video' ? 'video' : 'image';
    const runId = document.run_id?.trim();
    const nodeId = document.node_id?.trim();
    const projectId = document.project_id?.trim() || document.workflow_id?.trim();
    if (!url || seenUrls.has(url) || !runId || !nodeId || !projectId) continue;
    seenUrls.add(url);
    seeds.push({
      id: document._id,
      runId,
      projectId,
      nodeId,
      mediaType,
      url,
      prompt: normalizePrompt(document.input?.prompt),
      updatedAt: document.updated_at instanceof Date ? document.updated_at : new Date(),
    });
  }
  return seeds;
}

function toTemplateInput(
  item: CatalogEntry,
  result: ResultSeed,
  index: number,
): UpsertHomeWorkflowTemplateInput {
  const searchText = [
    item.titleZh,
    item.titleEn,
    item.subtitleZh,
    item.subtitleEn,
    item.descriptionZh,
    item.descriptionEn,
    item.categoryLabelZh,
    item.categoryLabelEn,
    item.badgeZh,
    item.badgeEn,
    ...item.tags,
  ]
    .join(' ')
    .toLocaleLowerCase();

  return {
    _id: `home-template-${item.slug}`,
    category_id: item.categoryId,
    category_label: item.categoryLabelEn,
    category_sort_order: item.categorySortOrder,
    title: item.titleEn,
    subtitle: item.subtitleEn,
    description: item.descriptionEn,
    badge: item.badgeEn,
    translations: {
      en: {
        title: item.titleEn,
        subtitle: item.subtitleEn,
        description: item.descriptionEn,
        categoryLabel: item.categoryLabelEn,
        badge: item.badgeEn,
      },
      zh: {
        title: item.titleZh,
        subtitle: item.subtitleZh,
        description: item.descriptionZh,
        categoryLabel: item.categoryLabelZh,
        badge: item.badgeZh,
      },
    },
    tags: item.tags,
    cover_url: result.url,
    media_type: result.mediaType,
    source_project_id: result.projectId,
    source_run_id: result.runId,
    result_node_id: result.nodeId,
    result_url: result.url,
    last_run_at: result.updatedAt,
    usage_count: 0,
    sort_order: index % 9,
    status: 'active',
    search_text: searchText,
    canvas: buildCanvas(item, result),
  };
}

function buildCanvas(item: CatalogEntry, result: ResultSeed): ProjectCanvas {
  const briefNodeId = `brief-${item.slug}`;
  const scriptNodeId = `script-${item.slug}`;
  const mediaNodeId = `result-${item.slug}`;
  const notesNodeId = `notes-${item.slug}`;
  const mediaPrompt = result.prompt || item.visualPrompt;
  const mediaTitle =
    result.mediaType === 'video' ? 'Generated video result' : 'Generated image result';
  const nodes: ProjectCanvas['nodes'] = [
    {
      id: briefNodeId,
      type: 'lumenNode',
      position: { x: 0, y: 40 },
      data: {
        kind: 'text',
        title: 'Template brief',
        prompt: item.briefZh,
        output: item.briefEn,
        modelId: 'gemini-2.5-flash',
        settings: {},
        status: 'success',
        progress: 1,
      },
    },
  ];
  const edges: ProjectCanvas['edges'] = [];

  if (item.shape === 'hook' || item.shape === 'script') {
    nodes.push({
      id: scriptNodeId,
      type: 'lumenNode',
      position: { x: 360, y: item.shape === 'hook' ? -80 : 40 },
      data: {
        kind: 'text',
        title: item.shape === 'hook' ? 'Hook script' : 'Talking script',
        prompt: item.briefEn,
        output: item.descriptionEn,
        modelId: 'gemini-2.5-flash',
        settings: {},
        status: 'success',
        progress: 1,
      },
    });
    edges.push(createEdge(briefNodeId, scriptNodeId));
  }

  const mediaSourceId =
    item.shape === 'hook' || item.shape === 'script' ? scriptNodeId : briefNodeId;
  nodes.push({
    id: mediaNodeId,
    type: 'lumenNode',
    position: { x: item.shape === 'visual' || item.shape === 'kit' ? 360 : 720, y: 40 },
    data: {
      kind: result.mediaType,
      title: mediaTitle,
      prompt: mediaPrompt,
      output: result.url,
      modelId: result.mediaType === 'video' ? 'seedance-1.5-pro' : 'nano-banana2',
      settings: {
        aspectRatio: '9:16',
        aspect_ratio: '9:16',
        sourceRunId: result.runId,
        sourceResultNodeId: result.nodeId,
      },
      status: 'success',
      progress: 1,
    },
  });
  edges.push(createEdge(mediaSourceId, mediaNodeId));

  if (item.shape === 'kit') {
    nodes.push({
      id: notesNodeId,
      type: 'lumenNode',
      position: { x: 720, y: 40 },
      data: {
        kind: 'text',
        title: 'Reuse notes',
        prompt: 'Summarize how this result can be reused in the next asset run.',
        output: item.descriptionEn,
        modelId: 'gemini-2.5-flash',
        settings: {},
        status: 'success',
        progress: 1,
      },
    });
    edges.push(createEdge(mediaNodeId, notesNodeId));
  }

  return {
    nodes,
    edges,
    viewport: { x: 80, y: 120, zoom: 0.72 },
  };
}

function createEdge(source: string, target: string) {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    data: {},
  };
}

function entry(
  categoryId: (typeof CATEGORIES)[number]['id'],
  slug: string,
  titleZh: string,
  titleEn: string,
  subtitleZh: string,
  subtitleEn: string,
  descriptionZh: string,
  descriptionEn: string,
  badgeZh: string,
  badgeEn: string,
  tags: string[],
  shape: WorkflowShape,
  briefZh: string,
  briefEn: string,
  visualPrompt: string,
): CatalogEntry {
  const category = CATEGORIES.find((item) => item.id === categoryId);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);
  return {
    slug,
    categoryId,
    categorySortOrder: category.sortOrder,
    categoryLabelZh: category.zh,
    categoryLabelEn: category.en,
    titleZh,
    titleEn,
    subtitleZh,
    subtitleEn,
    descriptionZh,
    descriptionEn,
    badgeZh,
    badgeEn,
    tags,
    shape,
    briefZh,
    briefEn,
    visualPrompt,
  };
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 1200);
}

function summarizeCategories(documents: UpsertHomeWorkflowTemplateInput[]) {
  const summary = new Map<string, number>();
  for (const document of documents) {
    summary.set(document.category_label, (summary.get(document.category_label) ?? 0) + 1);
  }
  return Object.fromEntries(summary);
}

async function clearHomeTemplateCache() {
  const redis = getRedisClient({
    url: process.env.REDIS_URL,
    keyPrefix: 'lumen:studio:',
  });
  if (!redis) return;
  await Promise.all([
    redis.del('home:workflow-templates:v1:en'),
    redis.del('home:workflow-templates:v1:zh'),
  ]);
}
