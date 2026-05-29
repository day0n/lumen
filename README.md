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

## License

Private.
