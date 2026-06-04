# Lumen

AIGC 带货短视频生成系统。

## 项目结构

monorepo（pnpm workspace）。

```
lumen/
├── apps/
│   ├── lumen-studio/    Next.js 15 前端 + 工作流 WebSocket gateway
│   ├── lumen-agent/     Hono SSE Agent 服务
│   └── lumen-engine/    工作流执行引擎
└── packages/
    ├── shared/          跨服务的 zod schema / 协议
    └── db/              MongoDB / Redis 连接和仓储
```

## 运行时拓扑

```
Frontend ──── WebSocket ────► lumen-studio :3000
                                   │
                                   ▼ XADD lumen:flow:tasks
                              Redis Stream
                                   │
                                   ▼ XREADGROUP
                              lumen-engine :3002
                                   │
                                   ▼ PUBLISH flow:events:{connId}
                              Redis Pub/Sub
                                   ▲
Frontend ──── WebSocket ────► lumen-studio  ─┘

Frontend ──── SSE ──────────► lumen-agent  :3001  （对话）
```

工作流通信走 studio 自己的 WebSocket（`/ws/flow`），agent 只负责 SSE 对话，两条管道完全解耦。

## 工作流运行方式

系统有三条独立的工作流执行链路，共用同一套 Engine handler，但任务派发、编排模型和结果回推各不相同。

### 1. 画布（Canvas）

用户在前端画布点击运行，走 WebSocket 全双工通信。

```
浏览器
  │  WebSocket 发送 run 消息
  ▼
lumen-studio /ws/flow  (flow-gateway.ts)
  │  StreamPublisher.publish()
  ▼
Redis Stream  lumen:flow:tasks  ← XADD
  │
  ▼  XREADGROUP（Engine 阻塞轮询）
lumen-engine  →  WorkflowExecutor 按 DAG 跑节点
  │  PUBLISH flow:events:{connId}
  ▼
Redis PubSub
  │  EventSubscriber 订阅
  ▼
lumen-studio  →  WebSocket push  →  浏览器实时更新
```

编排模型：**DAG**，一次提交整个 workflow，Engine 按节点依赖顺序执行。

---

### 2. Agent

用户在 Agent 对话框里请求生成，Agent AI 自主决定调用哪些节点、以什么顺序执行。

```
浏览器
  │  POST /api/agent/runs
  ▼
lumen-studio  →  HTTP 转发
  ▼
lumen-agent  （AI 推理循环）
  │  决定调用 run_canvas_node tool
  │  1. SUBSCRIBE flow:events:agent:{runId}  ← 先订阅
  │  2. XADD lumen:flow:tasks               ← 与画布共享同一条 Stream
  │  3. await 阻塞等待（最长 10 分钟）
  ▼
lumen-engine  →  执行节点  →  PUBLISH 到上面那个 channel
  │
  └─► Agent 收到 node:done → tool result 返回 → 继续 AI 推理
          │
          ▼
      浏览器  ←  SSE  ←  lumen-agent 流式推送对话事件
```

编排模型：**AI 逐节点调用**，每次 tool call 只跑一个节点，AI 根据结果决定下一步。

---

### 3. 爆款复刻（Remake）

独立于画布和 Agent，有自己的 Redis Stream，前端每秒轮询 HTTP 接口获取状态。

```
浏览器
  │  POST /api/remake/jobs
  ▼
lumen-studio
  │  Gemini 分析参考视频 + 商品图 + 生成复刻计划
  │  XADD lumen:remake:tasks  ← 独立 Stream，每个 task 单独派发
  ▼
lumen-engine（独立 Redis 连接，RemakeStreamConsumer）
  │  执行 handler（与画布共用同一套 executeNode）
  │  PUBLISH lumen:remake:task-results
  ▼
lumen-studio  eventMirror.ts  （常驻订阅）
  └─► 更新 MongoDB

浏览器  每秒  GET /api/remake/jobs/:id  ← 直接读 MongoDB
```

编排模型：**状态机**，拓扑写死在 `stages.ts`，Gate 1/2 让用户在关键节点确认后再触发下游。

## 基础设施

| 服务 | DB 名 | 用途 |
|---|---|---|
| `lumen-agent` | `lumen_agent` | 会话、消息、工具 trace |
| `lumen-studio` | `lumen_app` | 项目 / 素材 / 模板 / 爆款 |
| `lumen-engine` | `lumen_engine` | workflow run / node result |

- **MongoDB**：Atlas Cluster0
- **Redis**：Redis Cloud（Stream 任务队列 + Pub/Sub 事件）
- **Cloudflare R2/CDN**：工作流图片、视频、音频结果先上传 R2，再把 CDN URL 写入 MongoDB 和画布节点 output
- **LLM**：豆包（火山方舟，OpenAI 兼容）/ Anthropic / Vertex Gemini

### 工作流持久化

Engine 会在 `lumen_engine` 里维护两张 collection：

| Collection | 粒度 | 关键字段 |
|---|---|---|
| `workflow_runs` | 一次工作流运行 | `_id`/`runId`、`project_id`、`status`、`requested_node_ids`、`node_ids`、`graph`、`summary`、`started_at`、`completed_at` |
| `workflow_node_results` | 一次运行中的单个节点 | `run_id`、`project_id`、`node_id`、`node_type`、`status`、`model`、`input`、`output_type`、`output_value`、`asset`、`error`、`duration_ms` |

`output_value` 是最终可回放的结果。文本节点直接存文本；图片、视频、音频节点会先上传到 Cloudflare R2，`output_value` 存 CDN URL，`asset` 存 R2 key、content type、size、原始 URL 等元信息。Studio 收到的 WebSocket `node:done.output` 也是这个 CDN URL，因此项目画布自动保存后，下次打开同一个项目还能看到节点结果。

## 开发

要求 Node 20+，pnpm 9+。

```bash
pnpm install

# 配置环境变量（每个服务一份）
cp apps/lumen-studio/.env.example apps/lumen-studio/.env.local
cp apps/lumen-agent/.env.example  apps/lumen-agent/.env.local
cp apps/lumen-engine/.env.example apps/lumen-engine/.env.local
# 填入 MongoDB / Redis / API keys

# 起服务（三个终端）
pnpm dev:studio   # http://localhost:3000
pnpm dev:agent    # http://localhost:3001
pnpm dev:engine   # 后台消费

# Lint & format
pnpm check
```

## 代码约定

- TypeScript 严格模式
- ESM-only
- 配置全部通过 zod 校验，禁止裸读 `process.env`
- biome 管理 format + lint

## 技术方案

这里记录已经落地或准备持续迭代的核心技术方案，后续新能力可以继续追加小节。

### 找灵感：官方灵感图库 + 标签向量搜索

找灵感不是实时联网搜图，而是先维护一套 Lumen 自己的官方灵感图库。离线脚本会按分类准备素材元数据，用 OpenAI 图片模型生成参考图，上传到 Cloudflare R2，并把 CDN URL、标题、描述、标签、分类、年代、场景、风格、画幅等信息写入 MongoDB。生成时会把声明的画幅映射到图片模型实际支持的尺寸，保证入库的画幅和真实图片一致。

运行时 Agent 调用 `find_inspiration` tool：把用户需求提炼成视觉搜索 query，用 `text-embedding-3-small` 生成 query embedding，然后在 MongoDB Atlas Vector Search 里搜索预先写入的标签向量。低于相似度地板 `INSPIRATION_MIN_SCORE`（默认 0.3，可调）的结果会被丢弃，避免返回不相关的图。返回结果只包含可展示的 CDN URL 和元信息，前端通过 tool event 渲染成右侧 Agent 面板里的灵感图片网格。

关键落点：

| 模块 | 位置 / 名称 | 说明 |
|---|---|---|
| 种子脚本 | `apps/lumen-agent/scripts/seed-inspiration-assets.ts` | 生成图片、上传 R2、写入 Mongo、创建向量索引 |
| Agent tool | `apps/lumen-agent/src/adapters/outbound/tools/inspirationSearch.ts` | 执行 query embedding 和向量检索 |
| Mongo collection | `lumen_app.inspiration_assets` | 存图库元数据、R2 CDN URL、标签 embedding |
| 向量索引 | `inspiration_tags_vector_index` | Atlas Vector Search，搜索字段为 `embedding_tags` |
| 前端展示 | `apps/lumen-studio/src/features/agent-chat/ChatPanel.tsx` | 展示 tool 调用状态、思考状态和灵感图片网格 |

当前图库按 `automotive`、`people`、`accessories`、`fashion`、`beauty`、`food`、`electronics`、`home/lifestyle` 等分类设计。图片本体都在 R2，数据库只保存 CDN URL；搜索只向量化标签和 facet，不向量化图片本体。

## License

Private.
