# Lumen Studio 桌面端动效实施方案

> **文档用途**：供其他 AI / 工程师评审「是否可行、改哪里、怎么实现」。  
> **范围**：仅 **桌面端 Web**（`viewport > 767px` 画布；`> 1023px` 聊天等）。**不**改 `MobileSheet`、手机画布底栏等移动路径。  
> **参考来源**：[Design Spells · Desktop](https://designspells.com/?tag=desktop) 及部分桌面 Web 产品案例（见各条链接）。  
> **仓库**：`apps/lumen-studio`（Next.js App Router + `motion/react` + React Flow）

---

## 0. 评审清单（给其他 AI）

请逐项判断 **可行 / 需调整 / 不做**：

| # | 问题 | 期望结论 |
|---|------|----------|
| 1 | 是否所有改动都可通过 `!isMobileCanvas` / `!isMobile` 门控，避免影响手机？ | 必须 |
| 2 | P0 是否与现有 `isCanvasHydrated` + `markCanvasHydrated` 双 rAF 逻辑冲突？ | 应兼容，仅延长揭示时机 |
| 3 | 节点 stagger 在节点数 >50 时是否需降级（仅 opacity）？ | 建议有 |
| 4 | Unicorn Studio WebGL 与额外 DOM 动画是否争用主线程？ | 监控 FPS，必要时 `prefers-reduced-motion` |
| 5 | 新增 i18n 阶段文案是否必须？ | P0 建议有（无障碍 `aria-live`） |
| 6 | 是否需新增依赖？ | **否**，沿用 `motion/react` + 现有 CSS |

---

## 1. 背景与目标

### 1.1 现状问题

- 用户从工作区进入 `/canvas/:id` 时，虽有 `CanvasHydrationOverlay`，但 **等待语义弱**（只有循环光晕 + Unicorn，无阶段感）。
- Overlay 淡出后，节点常 **一次性出现**，仍有「先空后蹦」感（见 `CanvasWorkbench.tsx` 注释）。
- 桌面左侧 **素材/历史面板**、**Agent 聊天**、**空状态** 以 instant / 简单 transition 为主，与 Design Spells 桌面案例相比偏「工具感」、少「产品感」。

### 1.2 目标

在 **不改业务流程** 的前提下，用 `motion/react` 与少量 CSS 增强：

1. 画布加载：**有阶段的等待** → **unwrap 式节点入场**
2. 桌面侧栏 / 聊天：**错峰、spring、busy 语义**
3. 节点运行 / 成功：**与 Agent busy 统一的「工作中 / 完成」语言**
4. 列表页空态 / 骨架：**与画布 loading 视觉统一**

### 1.3 非目标（明确不做）

| 参考 | 链接 | 原因 |
|------|------|------|
| Claude pull-to-refresh | https://designspells.com/spells/pull-to-refresh-animation-in-claude | 移动端手势 |
| Are.na fluid sheet | https://designspells.com/spells/fluid-sheet-interactions-in-are-na | 移动 sheet |
| Wabi / Threads overscroll / Telegram 拖拽 | 各 interaction 条目 | 原生 App 交互 |
| Ripples / Particle（iOS） | 各 spell | 非 Web 桌面 |
| Discord Godzilla 等彩蛋 | 各 spell | 与生产力工具气质不符 |

---

## 2. 技术约束与约定

### 2.1 桌面断点（与代码一致）

| Hook | Media query | 用途 |
|------|-------------|------|
| `useIsMobileCanvas()` | `max-width: 767px` | 画布：MobileSheet、底栏、`compact` 顶栏 |
| `useIsMobile()` | `max-width: 1023px` | 聊天：底部弹出 vs 右侧 dock |

**本方案实施时**：画布相关用 `!isMobileCanvas`；聊天相关用 `!isMobile`（或 `Composer` 的 `mobile={false}` 分支）。

### 2.2 已有动效基建

| 能力 | 位置 |
|------|------|
| `motion/react` | `CanvasHydrationOverlay.tsx`、`ChatPanel.tsx`、`CanvasWorkbench.tsx`（`AnimatePresence`）等 |
| Overlay 退场 | `ease: [0.32, 0.72, 0, 1]`，`duration: 0.32` |
| 节点 running 样式 | `globals.css`：`.lumen-node-card--running`、`lumen-node-progress-bar` |
| 聊天面板入场（桌面） | `ChatPanel.tsx`：`x: 34`, `blur(6px)` → `spring stiffness: 260, damping: 30` |

### 2.3 全局 motion 约定（建议统一）

```ts
// 建议抽到 apps/lumen-studio/src/lib/motion.ts（可选，P1 再做）
export const EASE_OUT = [0.32, 0.72, 0, 1] as const;
export const OVERLAY_EXIT = { duration: 0.32, ease: EASE_OUT };
export const PANEL_SPRING = { type: 'spring' as const, stiffness: 280, damping: 32 };
export const STAGGER_CHILD = 0.06;
export const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

所有循环动画在 `prefers-reduced-motion: reduce` 时改为 **静态或仅 opacity 一次**。

---

## 3. 工作项总览

| ID | 优先级 | 名称 | Design Spells 参考 | 主要改动文件 |
|----|--------|------|-------------------|--------------|
| M0 | P0 | 画布加载阶段感 | [Linear](https://designspells.com/spells/progress-indicator-animation-in-linear)、[Things](https://designspells.com/spells/progress-indicator-animation-in-things) | `CanvasHydrationOverlay.tsx`, `CanvasWorkbench.tsx`, `messages.ts` |
| M1 | P0 | 节点 unwrap 入场 | [untitled unwrap](https://designspells.com/spells/unwrapping-experience-when-opening-an-album-in-untitled) | `CanvasWorkbench.tsx`, 可选 `CanvasNodeEnterAnimation.tsx` |
| M2 | P1 | 左侧 dock 面板 | [Roomsmith sidebar](https://designspells.com/spells/sidebar-animations-in-roomsmith) | `CanvasWorkbench.tsx`（`MaterialLibraryPanel`, `ProjectHistoryPanel`, `LeftToolbar`） |
| M3 | P1 | 顶栏保存/分享反馈 | [Linear](https://designspells.com/spells/progress-indicator-animation-in-linear) | `CanvasWorkbench.tsx`（`CanvasTopbar`） |
| M4 | P1 | Agent 聊天动效 | [Granola chatbox](https://designspells.com/spells/chatbox-animations-in-granola)、[Paper agent-at-work](https://designspells.com/spells/agent-at-work-indicator-in-paper) | `ChatPanel.tsx` |
| M5 | P1 | 节点 running / success | [Paper](https://designspells.com/spells/agent-at-work-indicator-in-paper)、[mymind achievement](https://designspells.com/spells/achievement-unlocked-animation-in-mymind) | `CanvasWorkbench.tsx`（`LumenFlowNode`）、`globals.css` |
| M6 | P2 | 侧栏/列表空状态 | [Basedash](https://designspells.com/spells/interactive-empty-state-graphics-in-basedash) | `PanelEmptyState`、`MaterialsPage.tsx`、`DashboardPage.tsx` |
| M7 | P2 | 工作区项目卡片 | [Joodle grid](https://designspells.com/spells/interactive-grid-of-doodle-entires-on-joodle) | `WorkspacePage.tsx` |
| M8 | P2 | 快捷键欢迎引导 | [Perplexity onboarding](https://designspells.com/spells/keyboard-shortcut-tutorial-in-perplexity-s-onboarding) | `ChatPanel.tsx`（`WelcomeMessage`） |
| M9 | P2 | 多步授权流 | [Codex permissions](https://designspells.com/spells/permissions-flow-in-codex) | 新建 `components/onboarding/`（待产品定稿） |

**建议实施顺序**：M0 → M1 → M2 → M4 → M3 → M5 → M6 → M7 → M8 → M9

---

## 4. 详细实现说明

### M0 — 画布加载阶段感（P0）

**参考**

- https://designspells.com/spells/progress-indicator-animation-in-linear  
- https://designspells.com/spells/progress-indicator-animation-in-things  

**Lumen 对应场景**

- 路由 fallback：`CanvasRouteLoader.tsx` → `app/canvas/[projectId]/loading.tsx`、`app/canvas/new/loading.tsx`
- 画布内：`CanvasWorkbench.tsx` 在 `!isCanvasHydrated` 时渲染 `CanvasHydrationOverlay`

**当前逻辑（勿删）**

```ts
// CanvasWorkbench.tsx
const [isCanvasHydrated, setIsCanvasHydrated] = useState(!projectId && !createOnMount);
const markCanvasHydrated = useCallback(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => setIsCanvasHydrated(true)));
}, []);
```

**改什么**

1. 在 `CanvasHydrationOverlay` 增加 prop：`phase: 'fetch' | 'layout' | 'ready'`（或 `stepIndex` + `stepCount`）。
2. 在 `CanvasWorkbench` 根据状态推导 phase：
   - `saveState === 'loading'` 且尚无节点 → `fetch`
   - 已有 nodes 但未 `markCanvasHydrated` → `layout`
   - 可选：`ready` 仅用于 aria 文案，视觉仍由 overlay 覆盖直到 hydrated
3. **仅桌面**（`!isMobileCanvas`）在 overlay 中心增加 **非精确进度** UI：
   - 3 段 indeterminate 条或 Linear 式细线扫描（CSS 即可，不必真 %）
   - 阶段切换时 `AnimatePresence` crossfade 文案（屏幕阅读器可见，视觉可极淡或仅 aria）
4. `messages.ts` 增加：
   - `canvas.hydration.phaseFetch`
   - `canvas.hydration.phaseLayout`
   - （中英文各一条）

**文件清单**

| 文件 | 操作 |
|------|------|
| `src/components/canvas/CanvasHydrationOverlay.tsx` | 加 phase UI、`aria-live` 阶段 |
| `src/components/canvas/CanvasWorkbench.tsx` | 计算 phase，传入 overlay |
| `src/components/canvas/CanvasRouteLoader.tsx` | 传默认 `phase="fetch"` |
| `src/i18n/messages.ts` | 新 key |

**验收**

- [ ] 桌面打开大项目：overlay 至少 2 个可感知阶段（或文案变化）
- [ ] `saveState === 'error'` 时 overlay 关闭，不卡住
- [ ] `prefers-reduced-motion`：无循环扫描，保留静态 + 文案
- [ ] 手机画布布局无新增 DOM（或 mobile 不显示阶段条）

---

### M1 — 节点 unwrap 入场（P0）

**参考**

- https://designspells.com/spells/unwrapping-experience-when-opening-an-album-in-untitled  

**改什么**

1. 在 `markCanvasHydrated` **之后**、首帧绘制前，设 `nodesRevealPending = true`（新 state）。
2. 对 `ReactFlow` 的 `displayNodes` 包一层 **仅首屏一次** 的入场：
   - `initial: { opacity: 0, scale: 0.96 }`
   - `animate: { opacity: 1, scale: 1 }`
   - `transition: { staggerChildren: 0.05, delayChildren: 0.08 }`
3. **实现方式二选一**（评审时选）：
   - **A（推荐）**：自定义 `LumenFlowNode` 根元素用 `motion.div`，`onAnimationComplete` 计数，全部完成后 `setNodesRevealPending(false)`
   - **B**：overlay `exit` 完成回调后再 `fitView` + 触发 stagger（与 M0 串联）
4. 节点数 `> 50`：降级为 **仅 opacity**，`stagger` 上限 0.03，总时长 < 400ms

**文件清单**

| 文件 | 操作 |
|------|------|
| `src/components/canvas/CanvasWorkbench.tsx` | state、`LumenFlowNode` 或 wrapper |
| 可选 `src/components/canvas/CanvasNodeReveal.tsx` | 封装 reveal 逻辑 |

**与 M0 时序**

```
用户进入画布 → M0 overlay 显示 → 数据加载+节点 commit → markCanvasHydrated
→ overlay exit 0.32s → M1 stagger 0.3~0.6s → 可交互
```

**验收**

- [ ] 桌面：overlay 淡出后节点错峰出现，非整屏瞬现
- [ ] 再次拖入节点 **不** 触发全画布 stagger（仅首屏）
- [ ] 手机可跳过 stagger（`isMobileCanvas` 直接 reveal）

---

### M2 — 左侧 dock 面板（P1）

**参考**

- https://designspells.com/spells/sidebar-animations-in-roomsmith  

**桌面路径（仅此）**

```tsx
// CanvasWorkbench.tsx — 仅当 !isMobileCanvas
materialPanelOpen ? <MaterialLibraryPanel ... /> : null
historyPanelOpen ? <ProjectHistoryPanel ... /> : null
```

**勿改**：`isMobileCanvas` 分支下的 `MobileSheet`。

**改什么**

1. 用 `AnimatePresence` 包裹 `MaterialLibraryPanel` / `ProjectHistoryPanel`：
   - `initial: { opacity: 0, x: -16 }`
   - `animate: { opacity: 1, x: 0 }`
   - `exit: { opacity: 0, x: -12 }`
   - `transition: PANEL_SPRING`
2. 面板内列表项（素材卡、历史条）`variants` + `staggerChildren: 0.04`
3. `LeftToolbar` 的 `ToolbarButton`：`active` 时 `scale: 1.04`（`whileTap: 0.96`）

**文件**

- `src/components/canvas/CanvasWorkbench.tsx`（`PANEL_DOCK_CLASS`、`MaterialLibraryPanel`、`ProjectHistoryPanel`、`LeftToolbar`、`ToolbarButton`）

**验收**

- [ ] 桌面：开关素材/历史面板有滑入+错峰
- [ ] 手机仍用 `MobileSheet`，行为与改前一致

---

### M3 — 顶栏保存/分享反馈（P1）

**参考**

- https://designspells.com/spells/progress-indicator-animation-in-linear  

**改什么**

1. `CanvasTopbar` 中 `saveState === 'saving'`：徽章内加 **indeterminate 细线**（CSS animation），替代纯文字。
2. `shareState === 'copied'`：`IconCheck` 用 `motion` `initial={{ scale: 0 }}` `animate={{ scale: 1 }}`（spring，200ms）。

**文件**

- `src/components/canvas/CanvasWorkbench.tsx` — `CanvasTopbar`、`getSaveLabel`

**验收**

- [ ] 自动保存时顶栏有微弱动态反馈
- [ ] 分享复制成功有确认动画，不依赖 toast

---

### M4 — Agent 聊天（P1，桌面）

**参考**

- https://designspells.com/spells/chatbox-animations-in-granola  
- https://designspells.com/spells/agent-at-work-indicator-in-paper  

**桌面路径**

- `ChatPanel.tsx`：`isMobile === false` → `motion.aside` 右侧滑入（已有）
- `SessionMenu`：仅 `sessionsOpen && !isMobile`
- `Composer`：`mobile={false}`

**改什么**

1. **Composer**（`mobile === false`）：
   - `busy` 时发送按钮 morph：发送图标 → 停止图标（`layoutId` 或 crossfade）
   - textarea 高度变化用 `layout` transition（Granola 式）
2. **MessageItem**：新消息 `initial={{ opacity: 0, y: 8 }}` `animate={{ opacity: 1, y: 0 }}`（`AnimatePresence` 已有，补 variant）
3. **StatusRing / LumenOrb**（`busy`）：对齐 Paper — **匀速脉冲** 而非狂闪；周期 ~1.2s
4. **SessionMenu**：宽度过渡 `width: 0 → 280` + opacity（Roomsmith 式），避免瞬时 mount

**文件**

- `src/features/agent-chat/ChatPanel.tsx`（`Composer`, `MessageItem`, `SessionMenu`, `StatusRing`, `WelcomeMessage` 无关 M4）

**验收**

- [ ] 桌面宽屏：流式回复时 header 有稳定「工作中」指示
- [ ] 手机聊天（`isMobile`）保持现有 `y: 24` 入场，不强制 SessionMenu 宽度动画

---

### M5 — 节点 running / success（P1）

**参考**

- https://designspells.com/spells/agent-at-work-indicator-in-paper  
- https://designspells.com/spells/achievement-unlocked-animation-in-mymind  

**改什么**

1. **running**：`globals.css` 中 `.lumen-node-card--running` 边框呼吸与 Chat `busy` 环 **同频率**（设计 token）。
2. **success 边沿**：在 `handleNodeStateChange` 或 `LumenFlowNode` 内检测 `status` 从 `running` → `success`：
   - 触发一次性 class `lumen-node-card--success-flash`（scale 1 → 1.02 → 1，300ms）
   - 不用 confetti
3. **error**：短 shake 可选（`x: [0, -4, 4, 0]`），仅桌面、仅一次

**文件**

- `src/components/canvas/CanvasWorkbench.tsx` — `LumenFlowNode`、`handleNodeStateChange`
- `src/app/globals.css` — running / success 关键帧

**验收**

- [ ] 单节点跑完有可读反馈，多节点并发不叠太多动画（可 debounce per node）

---

### M6 — 空状态（P2）

**参考**

- https://designspells.com/spells/interactive-empty-state-graphics-in-basedash  

**改什么**

1. 新建 `src/components/ui/DesktopEmptyIllustration.tsx`（SVG + CSS hover 微动）
2. 替换：
   - `PanelEmptyState`（`CanvasWorkbench.tsx` 内）
   - `MaterialsPage.tsx` 空态
   - `DashboardPage.tsx` — `EmptyState`

**验收**

- [ ] 桌面空素材库 / 空历史 / 空素材页有统一插画
- [ ] 插画可关：`prefers-reduced-motion` 无 hover 动画

---

### M7 — 工作区项目卡（P2）

**参考**

- https://designspells.com/spells/interactive-grid-of-doodle-entires-on-joodle  

**改什么**

- `WorkspacePage.tsx` — `ProjectCard` 缩略图容器：
  - `group-hover:scale-[1.02]` + 光泽 `translateX` 动画（与现有 gradient 叠加）

**验收**

- [ ] 仅 hover 设备有意义；触屏无恶体验

---

### M8 — 快捷键欢迎（P2）

**参考**

- https://designspells.com/spells/keyboard-shortcut-tutorial-in-perplexity-s-onboarding  

**改什么**

- `ChatPanel.tsx` — `WelcomeMessage`：3 张快捷键卡片，顺序 `opacity` + `y`（仅 `!isMobile`）
- 内容建议：画布缩放、运行节点、打开 Agent（需产品确认键位）
- `messages.ts`：`chat.welcome.shortcuts.*`

---

### M9 — 多步授权（P2，产品待定）

**参考**

- https://designspells.com/spells/permissions-flow-in-codex  

**改什么**

- 新建 `components/onboarding/PermissionsFlow.tsx`，供 MCP/工具授权、Codex 预览等复用
- 分步 `AnimatePresence` + slide（`x: 40 → 0`）

---

## 5. 关键文件索引（完整路径）

```
apps/lumen-studio/
├── src/
│   ├── app/
│   │   ├── canvas/[projectId]/loading.tsx      # 路由 loading → CanvasRouteLoader
│   │   ├── canvas/new/loading.tsx
│   │   └── globals.css                         # 节点 running/success 动画
│   ├── components/canvas/
│   │   ├── CanvasHydrationOverlay.tsx          # M0 主视觉
│   │   ├── CanvasRouteLoader.tsx
│   │   └── CanvasWorkbench.tsx                 # M0 M1 M2 M3 M5 核心
│   ├── features/agent-chat/
│   │   └── ChatPanel.tsx                       # M4 M8
│   ├── components/studio/
│   │   ├── WorkspacePage.tsx                   # M7
│   │   ├── MaterialsPage.tsx                   # M6
│   │   └── DashboardPage.tsx                 # M6
│   ├── hooks/use-is-mobile.ts                  # 断点定义
│   └── i18n/messages.ts                        # 文案
└── docs/
    └── DESKTOP_MOTION_IMPLEMENTATION.md        # 本文档
```

**移动路径（本方案不修改）**

- `src/components/mobile/MobileSheet.tsx`
- `CanvasWorkbench.tsx` 内 `isMobileCanvas` 分支、`MobileCanvasBottomToolbar`

---

## 6. 测试计划

| 场景 | 端 | 步骤 | 期望 |
|------|-----|------|------|
| 打开大画布 | 桌面 Chrome | 工作区点项目 | M0 阶段 → overlay 淡出 → M1 stagger |
| 新建画布 | 桌面 | `/canvas/new` | 同上或更短 |
| 开关素材库 | 桌面 | 左侧 Assets | M2 滑入+列表错峰 |
| Agent 流式 | 桌面 | 发送长 prompt | M4 busy 环 + 消息渐入 |
| 跑单节点 | 桌面 | Run | M5 running 条 + success flash |
| 减动效 | 桌面 | OS「减少动态效果」 | 无循环/无 stagger |
| 回归手机 | 375px | 进画布、开 sheet | 与改前一致 |

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| stagger + fitView 打架 | overlay exit 后再 `fitView`，或 fitView 完成后再 stagger |
| WebGL Unicorn 掉帧 | 阶段条用 CSS；减少 overlay 上同时运行的 blur 层 |
| 节点过多卡顿 | M1 节点数阈值降级 |
| a11y | 保留 `role="status"`、`aria-busy`、`aria-live`；减动效尊重系统设置 |

---

## 8. Design Spells 链接速查（仅桌面相关）

| 用途 | URL |
|------|-----|
| Desktop 合集 | https://designspells.com/?tag=desktop |
| Linear 进度 | https://designspells.com/spells/progress-indicator-animation-in-linear |
| Things 进度 | https://designspells.com/spells/progress-indicator-animation-in-things |
| untitled 打开 | https://designspells.com/spells/unwrapping-experience-when-opening-an-album-in-untitled |
| Roomsmith 侧栏 | https://designspells.com/spells/sidebar-animations-in-roomsmith |
| Granola 聊天 | https://designspells.com/spells/chatbox-animations-in-granola |
| Paper Agent 忙碌 | https://designspells.com/spells/agent-at-work-indicator-in-paper |
| Basedash 空状态 | https://designspells.com/spells/interactive-empty-state-graphics-in-basedash |
| Perplexity 快捷键 | https://designspells.com/spells/keyboard-shortcut-tutorial-in-perplexity-s-onboarding |
| Codex 授权 | https://designspells.com/spells/permissions-flow-in-codex |
| mymind 成就 | https://designspells.com/spells/achievement-unlocked-animation-in-mymind |
| Joodle 网格 | https://designspells.com/spells/interactive-grid-of-doodle-entires-on-joodle |
| PamPam 工具栏 | https://designspells.com/spells/skeuomorphic-toolbar-items-in-pampam |
| Button 合集 | https://designspells.com/?tag=button |
| Transition 合集 | https://designspells.com/?tag=transition |

---

## 9. 版本记录

| 日期 | 说明 |
|------|------|
| 2026-06-04 | 初版：桌面专用，含 M0–M9、文件路径、评审清单、测试与链接 |

---

**给其他 AI 的提示词示例**：

> 请阅读 `apps/lumen-studio/docs/DESKTOP_MOTION_IMPLEMENTATION.md`，按「评审清单」评估 M0–M2 在现有 `CanvasWorkbench` hydration 逻辑下是否可行；若有冲突请给出修改后的时序图与具体 diff 建议。不要扩展手机端范围。
