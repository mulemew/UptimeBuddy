## 目标

打造一个类似 Uptime Kuma 的网站监控工具：用户添加监控目标 → 后端定时检查 → 记录每次结果 → 前端展示在线率、响应时间、最近事件，并提供一个公开状态页。单用户使用，无需登录。

## 功能范围

**监控类型**
- HTTP/HTTPS：请求 URL，校验状态码（默认 2xx/3xx 视为正常），记录响应时间
- TCP 端口：通过 Deno `Deno.connect` 测试主机+端口连通性
- Ping (ICMP)：边缘函数无法发 ICMP，**用 HTTP HEAD 请求到主机 80/443 端口模拟**，UI 中明确标注"HTTP-based ping"
- 关键字检查：HTTP 请求后检查响应正文是否包含/不包含指定关键字

**每项监控可配置**
- 名称、类型、目标（URL / host:port）
- 检查间隔：1 / 2 / 5 / 10 / 15 / 30 / 60 分钟
- 超时时间（秒，默认 10）
- 关键字（仅关键字类型）：文本 + 包含/不包含
- 启用/暂停开关

**展示**
- Dashboard：监控卡片网格，显示当前状态（绿/红/灰）、最近 30 次检查的小色块条、24h 在线率、平均响应时间
- 详情页：响应时间折线图（最近 24h / 7d / 30d）、状态时间线、事件列表（宕机开始/恢复时间、持续时长）
- 公开状态页 `/status`：精简版总览，可分享

## 技术方案（技术细节）

**后端：Lovable Cloud**

数据库表：
- `monitors`：id, name, type(http/tcp/ping/keyword), target, interval_minutes, timeout_seconds, keyword, keyword_match(contains/not_contains), expected_status_codes, enabled, created_at
- `heartbeats`：id, monitor_id, checked_at, status(up/down), response_time_ms, status_code, error_message —— 索引 (monitor_id, checked_at desc)
- `incidents`：id, monitor_id, started_at, ended_at, duration_seconds, reason

单用户模式：所有表无 user_id，但仍启用 RLS 并允许 anon 读写（明确标注单用户）。

**Edge Functions**
- `run-checks`：被 cron 每分钟触发。读取所有 enabled 监控，按 `last_checked_at + interval` 判断是否到点；对到点的监控并发执行检查，写入 heartbeats，并维护 incidents（状态翻转时开/闭事件）。使用 `Promise.allSettled` + `AbortController` 控制超时
- `check-now`：手动触发单个监控立即检查（前端"立即检查"按钮）

**Cron 调度**：通过 `pg_cron` + `pg_net` 在数据库迁移中创建一个每分钟调用 `run-checks` 函数的 job。

**前端**
- 路由：`/`（Dashboard）、`/monitors/new`、`/monitors/:id`（详情）、`/status`（公开状态页）
- 组件：MonitorCard、StatusBar（30 格心跳条）、ResponseTimeChart（recharts，已有）、IncidentList、MonitorForm
- 数据：使用 `@tanstack/react-query`（已安装）+ Supabase client；详情页通过 Realtime 订阅 heartbeats 实时刷新
- 设计系统：扩展 `index.css` 加入语义化状态色 `--status-up`（绿）、`--status-down`（红）、`--status-pending`（灰），全部 HSL；卡片采用现有 shadcn Card

## 实施步骤

1. 启用 Lovable Cloud
2. 创建数据库表 + RLS + pg_cron 调度迁移
3. 编写 `run-checks` 与 `check-now` 边缘函数（含四种检查器）
4. 扩展设计系统（状态色 token）
5. 构建前端：Dashboard、监控表单、详情页、状态页、路由接入
6. 端到端验证：添加几个真实站点，确认 cron 落库、UI 实时更新

## 范围之外（可后续添加）

告警通知（邮件/Webhook）、多用户、SSL 证书到期监控、维护窗口、数据保留策略 UI。