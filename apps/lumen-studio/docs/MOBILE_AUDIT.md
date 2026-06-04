# Lumen Studio 移动端审计（基线）

审计方式：代码结构审查 + 断点逻辑梳理（2026-06-04）。线上需在 390×844 / 430×932 / 768×1024 / 1440×900 实机复验。

| 页面 | 横向溢出 | 固定宽度裁切 | h-screen 锁滚动 | 触控区 <44px | 顶栏挤压 | 弹窗超屏 | 软键盘 | 重动画卡顿 | ReactFlow | Agent Chat |
|------|----------|--------------|-----------------|-------------|----------|----------|--------|------------|-----------|------------|
| `/` Landing | 低 | 低 | 粒子区 sticky+overflow | 部分 CTA | 中（单行 nav） | 低 | N/A | 高（canvas 粒子） | N/A | N/A |
| `/home` | 低 | 低 | 可滚动 | 登录按钮 sm 隐藏 | 底栏 OK | 通知 popover 760px | 输入区一般 | 中 | N/A | N/A |
| `/canvas/projects` | 低 | 项目卡 OK | min-h-screen | 菜单项 | 底栏 OK | 下拉菜单 | N/A | 低 | N/A | N/A |
| `/canvas/new` | — | — | 同 canvas | — | — | — | — | — | 见 canvas | 见 canvas |
| `/canvas/:id` | **高** | 左栏 left-24 | **h-screen overflow-hidden** | 工具栏 44 边缘 | 顶栏文字+分享挤 | 侧栏 left-24 | **高** | 中 | **未专门适配** | 右侧面板挡画布 |
| `/materials` | 中 | 弹窗/预览 | min-h-screen | 部分 | 底栏 | 大图预览 | 表单 | 中 | N/A | N/A |
| `/hot-videos` | 中 | 详情双栏 | 部分 overflow | 部分 | 底栏 | 详情 lg 双栏 | 搜索 | 视频多 | N/A | N/A |
| `/dashboard` | **高** | 宽表格 | 可滚动 | 密集按钮 | 筛选一行挤 | 无 sheet | 搜索 | 图表多 | N/A | N/A |
| `/sign-in` | 低 | Clerk 默认 | OK | Clerk | N/A | N/A | OK | 低 | N/A | N/A |
| `/share/:id` | 低 | — | — | — | — | — | — | — | 只读 | N/A |

**优先修复顺序**：基础设施 → 内容页 → Dashboard → ChatPanel → Canvas 分支。
