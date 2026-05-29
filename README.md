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
| `lumen-engine` | `lumen_engine` | flow / run 状态 |

- **MongoDB**：Atlas Cluster0
- **Redis**：Redis Cloud（Stream 任务队列 + Pub/Sub 事件）
- **LLM**：豆包（火山方舟，OpenAI 兼容）/ Anthropic / Vertex Gemini

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
