## 目标

扩展现有 HTTP/HTTPS 监控能力，从简单 GET + 状态码 + 关键字检查，升级为生产级 HTTP 探测器，覆盖请求方法、自定义 Headers/Body、SSL 校验、正则匹配、响应时间降级等。

## 数据库变更

`monitors` 表新增字段：

- `http_method` text default `'GET'`（GET/POST/HEAD/PUT/PATCH/DELETE）
- `http_body` text nullable（请求体原文）
- `http_body_type` text nullable（json/xml/text/form）
- `http_headers` jsonb default `'{}'`（键值对）
- `follow_redirects` boolean default `true`
- `ignore_tls_errors` boolean default `false`
- `cert_expiry_warn_days` integer default `14`（0 表示不监控证书）
- `match_mode` text default `'contains'`（contains / not_contains / regex）—— 取代旧的 `keyword_match`，并对 regex 复用同一字段
- `degraded_threshold_ms` integer nullable（>0 时启用降级判定）

`heartbeats` 表新增：

- `cert_days_remaining` integer nullable
- 状态枚举从 `up/down` 扩展为 `up/down/degraded`（新增 enum 值）

`monitors.last_status` 同样支持 `degraded`。

迁移策略：保留旧 `keyword_match` 字段，初始化时把数据复制到新 `match_mode`；前端不再写旧字段。

## 边缘函数变更（`supabase/functions/_shared/checkers.ts`）

`checkHttp` 重构：

1. 用 `monitor.http_method`（HEAD 时不读 body；GET 视 keyword 是否存在再决定读 body）
2. 注入 `monitor.http_headers` 与 `monitor.http_body`（按 body_type 设置 Content-Type 默认值，用户显式 header 优先）
3. `redirect: monitor.follow_redirects ? 'follow' : 'manual'`；非 follow 时 3xx 视为正常状态码
4. TLS 忽略：Deno fetch 不支持禁用证书校验，因此 `ignore_tls_errors` 仅在错误信息含 `certificate` / `TLS` 时把 down 转 up（标注降级原因）—— UI 中说明限制
5. 证书到期：HTTPS 目标每次检查时通过 `Deno.connectTls` 抓取 `peerCertificates`，计算剩余天数；少于 `cert_expiry_warn_days` 标记 degraded
6. 匹配：`match_mode` = contains / not_contains / regex（regex 用 `new RegExp(keyword)`，编译失败 → down）
7. 响应时间降级：状态码与关键字均通过，但 `elapsed > degraded_threshold_ms` → status = degraded

`persist.ts` 调整：incident 仅在 `down` 时开/关，`degraded` 不开 incident 但记录心跳；`monitors.last_status` 存 up/down/degraded。

## 前端变更

**`MonitorForm.tsx`**：HTTP / Keyword 类型下展开"高级"折叠面板（shadcn `Accordion`）：

- Method 下拉
- Headers 编辑器（动态键值对行，新增/删除按钮）
- Body 编辑器（Textarea + body_type 下拉），HEAD/GET 隐藏
- 跟随重定向开关
- 忽略 TLS 错误开关 + 证书预警天数输入
- 匹配模式下拉（contains / not_contains / regex）替换原 keyword_match
- 响应时间降级阈值输入

Zod 校验：headers 不超 30 项、键非空；regex 模式下尝试编译；body 限制 32KB。

**状态色**：`index.css` / `tailwind.config.ts` 新增 `--status-degraded`（琥珀色）。`StatusBadge`、`StatusBar`、`MonitorCard` 支持新状态。

**`MonitorDetail.tsx`**：心跳列表展示证书剩余天数（HTTPS）；事件列表保持原样（degraded 不计入）。

## 范围之外

POST 文件上传、mTLS 客户端证书、Cookie Jar、HTTP/2 帧级指标。

## 实施顺序

1. 数据库迁移（字段 + degraded enum 值）
2. 重写 checkers.ts 的 HTTP 分支 + 证书检查逻辑 + persist 状态写入
3. 设计系统加 degraded 色 token
4. 重构 MonitorForm 加高级面板
5. 更新 StatusBadge / StatusBar / MonitorCard / MonitorDetail 渲染 degraded 与证书天数
6. 端到端验证（http://httpbin.org 测 POST/Headers/Status；过期证书测试可选）
