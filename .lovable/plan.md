## 目标

为监控系统新增 7 项能力：抖动重试、维护窗口、DNS 监控、多步 API 监控、远程数据库监控、被动心跳（Cron 监控）、历史曲线图断点处理。

---

## 1. 故障重试（防抖）

`monitors` 新增 `retry_count int default 0`、`retry_interval_seconds int default 20`。

`run-checks` / `check-now` 检查到 `down` 时，立即在内存里串行重试 `retry_count` 次（每次间隔 `retry_interval_seconds`）。全部失败才落 `down` 心跳并开事件；任何一次成功则按成功结果落库（不开事件）。`degraded` 不参与重试。

UI：MonitorForm 高级面板新增"失败重试次数"+"重试间隔(秒)"。

---

## 2. 维护窗口

新表 `maintenance_windows`：
- `id, monitor_id (nullable=全局), title, starts_at timestamptz, ends_at timestamptz, recurrence text default 'none'`（none/daily/weekly）, `weekday int null`, `created_at`。
- RLS：public read（状态页展示），写操作走 `monitors-admin` 新增 action `maintenance.*`。

调度时：进入窗口的监控**跳过检查**（不写心跳、不开事件），UI 在 MonitorCard / 状态页显示"维护中"徽章。

新页面 `Settings` 增加"维护窗口"标签页（或独立 `/maintenance` 路由），列表 + 新增/编辑/删除。

---

## 3. DNS 监控

`monitor_type` enum 新增 `dns`。`monitors` 新增：
- `dns_record_type text`（A/AAAA/CNAME/MX/TXT/NS）
- `dns_resolver text null`（默认系统）
- `dns_expected_values text[] null`（任一匹配即 up；空则只校验"能解析"）

`checkers.ts` 新增 `checkDns`，使用 `Deno.resolveDns(host, type, { nameServer })`。匹配模式：所有期望值需出现在结果中（或单个匹配，按 `match_mode`）。失败/超时 → down。

UI：MonitorForm 当 type=dns 时显示记录类型 / 解析器 / 期望值多行输入。

---

## 4. 多步 API 监控

`monitor_type` enum 新增 `multistep`。`monitors` 新增 `steps jsonb default '[]'`，每步：
```
{ name, method, url, headers, body, body_type,
  expected_status_codes, extract: [{name, from:"json"|"header", path}],
  assert: [{path, op:"eq"|"contains"|"regex", value}] }
```
变量替换 `{{var}}` 在 url/headers/body 中生效，由前一步 `extract` 写入上下文。

`checkers.ts` 新增 `checkMultiStep`：顺序执行，任一步失败即 down 并记录步骤名 + 原因；累计耗时为 `response_time_ms`。

UI：新增 `MultiStepEditor` 子组件（步骤增删 + 折叠卡片），仅在 type=multistep 时渲染。

SSRF 守卫复用 `assertSafeUrl`。

---

## 5. 远程数据库监控

`monitor_type` enum 新增 `database`。新增 `db_kind text`（postgres/mysql）、`db_dsn text`（密文存储——存项目 secret 引用名而不是明文：字段存 `db_secret_name`，真实 DSN 在 Supabase Secrets 里）、`db_query text default 'SELECT 1'`。

`checkers.ts` 新增 `checkDatabase`：根据 `db_kind` 用 `npm:postgres` / `npm:mysql2` 连接并执行查询，校验返回行数 ≥ 1。SSRF 守卫校验主机不在私网（与现有 ssrf.ts 复用）。

UI：MonitorForm 当 type=database 时显示 DSN secret 名称选择 + 测试 SQL。文档提示用户先在 Cloud Secrets 添加 `MON_DB_<NAME>` 形式的密钥。

---

## 6. 被动心跳 (Push Monitor)

`monitor_type` enum 新增 `push`。`monitors` 新增：
- `push_token text unique`（创建时自动生成 32 字节 hex）
- `push_grace_seconds int default 60`（在 `interval_minutes*60 + grace` 内未收到即判 down）

新边缘函数 `heartbeat-ingest`（公开，不验 JWT）：`GET/POST /heartbeat-ingest?token=xxx[&status=up|down][&msg=...]` → 写心跳 status=up，更新 `last_checked_at`。

`run-checks` 对 `type=push` 的监控不主动探测，但每轮检查 `now - last_checked_at > interval+grace` 则写入一条 `down` 心跳并开事件（仅当上一状态非 down，避免重复）。

UI：MonitorForm type=push 显示生成的 webhook URL（带复制按钮）+ grace 输入。Detail 页同样展示 URL。

---

## 7. 历史曲线断点

当前 `MonitorDetail` 用 recharts `Line` 直接连点，暂停期会被拉成横线。

修改：在数据准备阶段，按时间排序后扫描相邻点，若 `Δt > interval_minutes * 2`（或监控被禁用 / 在维护窗口内），插入 `{ checked_at, response_time_ms: null }`。recharts `Line` 默认 `connectNulls={false}`，断开渲染。同时在 `Area` 图（如有）做同样处理。

---

## 技术细节小结

- DB 迁移合并为 1 个 SQL：扩 enum、加列、建 `maintenance_windows`、RLS 调整。
- `monitors-admin` 函数扩展 actions：`maintenance.create/update/delete`、`push.regenerate_token`。
- `checkers.ts` 拆分：`http.ts` / `dns.ts` / `db.ts` / `multistep.ts` / `push.ts`，统一 `runCheck` dispatcher。
- 重试逻辑放在 `persist.ts` 调用前的 wrapper 中。
- i18n：新增所有新字段的中英文键。
- 设计系统不变；维护中徽章复用 `--status-degraded` 加斜杠纹理或新 `--status-maintenance` token（蓝灰色）。

## 范围之外

- 多步 API 的 GraphQL / gRPC
- DNS DNSSEC 校验
- 数据库连接池、读写延迟分桶
- 维护窗口的复杂 cron 表达式（仅支持 none/daily/weekly）
- 心跳的签名校验（仅 token）
