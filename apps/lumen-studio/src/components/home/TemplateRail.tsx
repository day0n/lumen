'use client';

import { IconArrowRight, IconSearch, IconSparkles } from '@tabler/icons-react';
import { motion } from 'motion/react';

interface CanvasPick {
  id: string;
  name: string;
  author: string;
  uses: string;
  gradient: string;
}

const CATEGORIES = [
  '全部',
  '带货开场',
  '商品细节',
  '口播脚本',
  '场景种草',
  '多语种',
  '爆款拆解',
  '素材拼贴',
];

const CANVAS_PICKS: CanvasPick[] = [
  {
    id: 'p1',
    name: '清爽防晒面膜种草',
    author: 'Lumen Studio',
    uses: '128',
    gradient:
      'radial-gradient(circle at 20% 18%,rgba(129,190,232,0.72),transparent 38%),linear-gradient(135deg,#16212b,#30465a 55%,#101214)',
  },
  {
    id: 'p2',
    name: '3C 耳机卖点快切',
    author: 'Noise Lab',
    uses: '86',
    gradient:
      'radial-gradient(circle at 72% 18%,rgba(94,140,205,0.7),transparent 36%),linear-gradient(135deg,#101820,#1e3148 58%,#0c0f12)',
  },
  {
    id: 'p3',
    name: '食品 ASMR 近景流',
    author: 'Taste Maker',
    uses: '243',
    gradient:
      'radial-gradient(circle at 24% 20%,rgba(179,139,92,0.6),transparent 38%),linear-gradient(135deg,#241f19,#43505a 58%,#111315)',
  },
  {
    id: 'p4',
    name: '通勤鞋履质感广告',
    author: 'QianliGood',
    uses: '169',
    gradient:
      'radial-gradient(circle at 80% 18%,rgba(220,226,233,0.42),transparent 34%),linear-gradient(135deg,#1a1d20,#3d4652 54%,#101113)',
  },
  {
    id: 'p5',
    name: '护肤前后对比节奏',
    author: 'Glow Team',
    uses: '77',
    gradient:
      'radial-gradient(circle at 18% 70%,rgba(96,170,198,0.62),transparent 42%),linear-gradient(135deg,#121b22,#284254 62%,#0b0d10)',
  },
  {
    id: 'p6',
    name: '运动水杯户外短片',
    author: 'Trail Cut',
    uses: '54',
    gradient:
      'radial-gradient(circle at 78% 24%,rgba(116,163,205,0.68),transparent 36%),linear-gradient(135deg,#121820,#2b3f50 58%,#0d1013)',
  },
  {
    id: 'p7',
    name: '家居香氛氛围镜头',
    author: 'Quiet Room',
    uses: '61',
    gradient:
      'radial-gradient(circle at 28% 18%,rgba(157,143,199,0.5),transparent 36%),linear-gradient(135deg,#171722,#34364a 56%,#0f1013)',
  },
  {
    id: 'p8',
    name: '母婴用品温柔讲解',
    author: 'Soft Sell',
    uses: '42',
    gradient:
      'radial-gradient(circle at 80% 20%,rgba(167,202,219,0.54),transparent 36%),linear-gradient(135deg,#151c21,#31404a 58%,#0d0f11)',
  },
  {
    id: 'p9',
    name: '跨境英文口播模板',
    author: 'Global Script',
    uses: '101',
    gradient:
      'radial-gradient(circle at 18% 18%,rgba(85,126,220,0.64),transparent 38%),linear-gradient(135deg,#101622,#263352 58%,#0b0d12)',
  },
  {
    id: 'p10',
    name: '爆款评论反打结构',
    author: 'Hook Lab',
    uses: '92',
    gradient:
      'radial-gradient(circle at 82% 74%,rgba(79,126,181,0.62),transparent 42%),linear-gradient(135deg,#11161b,#273747 58%,#0b0d10)',
  },
  {
    id: 'p11',
    name: '主图到分镜组图',
    author: 'Frame Kit',
    uses: '58',
    gradient:
      'radial-gradient(circle at 22% 22%,rgba(201,211,224,0.45),transparent 34%),linear-gradient(135deg,#161b20,#344050 60%,#0e1012)',
  },
  {
    id: 'p12',
    name: '新品首发倒计时',
    author: 'Launch Desk',
    uses: '73',
    gradient:
      'radial-gradient(circle at 78% 18%,rgba(117,198,231,0.58),transparent 36%),linear-gradient(135deg,#101b22,#234152 58%,#0b0d10)',
  },
];

export function TemplateRail() {
  return (
    <section className="mx-auto mt-14 max-w-[1260px] px-6 pb-20">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-4 text-[20px] font-bold text-white">推荐画布</h2>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category, index) => (
            <button
              key={category}
              type="button"
              className={
                index === 0
                  ? 'rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-[#111315]'
                  : 'rounded-lg bg-white/[0.045] px-3 py-1.5 text-[12px] text-white/52 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.08] hover:text-white'
              }
            >
              {category}
            </button>
          ))}
        </div>

        <div className="ml-auto flex h-10 min-w-[260px] items-center gap-2 rounded-xl bg-[#141619] px-3 ring-1 ring-white/[0.08]">
          <input
            placeholder="搜索画布、商品类目或卖点"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
          />
          <IconSearch size={17} className="text-white/40" stroke={2.1} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {CANVAS_PICKS.map((pick, index) => (
          <CanvasPickCard key={pick.id} pick={pick} index={index} />
        ))}
      </div>
    </section>
  );
}

function CanvasPickCard({ pick, index }: { pick: CanvasPick; index: number }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.025, ease: [0.32, 0.72, 0, 1] }}
      className="group overflow-hidden rounded-xl bg-[#1d1f21] text-left ring-1 ring-white/[0.055] transition-colors hover:bg-[#24272a]"
    >
      <div className="relative h-[165px]" style={{ background: pick.gradient }}>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.68))]" />
        <div className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-1 text-[11px] font-medium text-white/72 backdrop-blur">
          {pick.uses}
        </div>
        <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-white/72">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/16">
            <IconSparkles size={13} stroke={2.2} />
          </span>
          {pick.author}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3.5 py-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/85">
          {pick.name}
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.055] text-white/45 transition-colors group-hover:text-white">
          <IconArrowRight size={14} stroke={2.3} />
        </span>
      </div>
    </motion.button>
  );
}
