# 方案 C+：checker-core 双运行时

目标：一份检查逻辑，既能在 Cloudflare Workers 跑（0 容器，全球多点），也能在自托管环境跑（保留真 ICMP ping）。用户按需二选一部署。

分支：`feat/checker-core-dual-runtime`（在本次实现开始时创建）。

## 目录结构

```text
packages/
  checker-core/           # 纯逻辑，零运行时依赖
    src/
      types.ts            # Monitor / CheckResult / RuntimeCaps
      checkers/
        http.ts           # fetch-based，两端通用
        tcp.ts            # 用 caps.tcpConnect 抽象
        ping.ts           # 用 caps.icmpPing 抽象（CF 端不注入 => 报错）
        dns.ts            # 用 caps.dnsResolve 抽象
        multistep.ts
        database.ts       # 用 caps.dbQuery（CF 端可选 HTTP 代理或禁用）
      persist.ts          # 通过 caps.db 写 heartbeats/incidents/monitors
      scheduler.ts        # 选出到期 monitors、并发调度、维护窗判定
      maintenance.ts
      lock.ts             # 复用 _uptimebuddy_runtime 的锁
    package.json          # "type": "module"，无 deno/node 专属 import

adapters/
  cloudflare/             # CF Workers 部署包
    src/worker.ts         # scheduled() + fetch() 入口，注入 caps
    src/caps.ts           # tcpConnect: cloudflare:sockets, dns: DoH,
                          # db: postgres.js over Hyperdrive 或 Supabase REST
                          # icmpPing: 抛 "unsupported in CF Workers"
    wrangler.toml         # cron "* * * * *"，secrets: SUPABASE_URL/SRK/CRON_SECRET
    README.md             # 部署步骤
  node-worker/            # 自托管精简 worker（可选替代 edge-runtime）
    src/index.ts          # setInterval 60s，注入 caps
    src/caps.ts           # tcpConnect: net.Socket, icmpPing: 调 /bin/ping,
                          # dns: dns/promises, db: pg
    Dockerfile            # 基于 node:20-slim + iputils-ping + setcap
    package.json
```

## 关键设计

**RuntimeCaps 接口**：核心不 import 任何运行时 API，全部通过注入。
```ts
interface RuntimeCaps {
  fetch: typeof fetch;
  tcpConnect(host: string, port: number, timeoutMs: number): Promise<number>;
  icmpPing?(host: string, timeoutMs: number): Promise<{ rttMs: number }>;
  dnsResolve(host: string, type: string, resolver?: string): Promise<string[]>;
  dbQuery?(kind: string, dsn: string, sql: string, timeoutMs: number): Promise<unknown>;
  now(): number;
  db: { // 用于读 monitors / 写 heartbeats
    from(table: string): QueryBuilder;
  };
}
```
CF 不实现 `icmpPing` → `checkers/ping.ts` 返回 `down` + `"ICMP unavailable in this runtime"`；Node worker 实现它。

**数据库**：
- 自托管：直连 Postgres（`pg`）。
- CF Workers：走 Supabase REST（复用现有 `@supabase/supabase-js`，CF Workers 兼容）或 Hyperdrive+`postgres.js`。默认前者，零额外配置。

**锁与调度**：沿用 `_uptimebuddy_runtime` 表 + `cron_secret`。CF 用 Cron Triggers 每分钟触发 `scheduled()`，Node worker 用 `setInterval`。两者都调用 `packages/checker-core` 的 `scheduler.tick(caps)`。

**现有 edge function 保留**：`supabase/functions/run-checks` 改成薄壳，import `packages/checker-core` 并注入 Deno 版 caps（`Deno.connect` / `Deno.Command("ping")` / `Deno.resolveDns`）。这样 Lovable Cloud 用户零改动继续用；自托管用户可选保留 edge-runtime 或切换到 node-worker。

## 部署矩阵

| 场景 | 部署 | ICMP ping | 容器数 |
|---|---|---|---|
| Lovable Cloud | 现状 edge function（薄壳版） | ❌ | 0（托管） |
| 自托管 + edge-runtime | 现状 docker-compose | ✅ | 7 |
| 自托管 + node-worker | 新增精简 compose（db+app+worker） | ✅ | 3 |
| CF Workers + 云 DB | `wrangler deploy` | ❌ | 0 |

## 实现步骤

1. `git checkout -b feat/checker-core-dual-runtime`
2. 建 `packages/checker-core`，从 `supabase/functions/_shared/checkers.ts` 抽出纯逻辑，把所有 `Deno.*` / `fetch` 替换成 `caps.*`
3. 建 `adapters/cloudflare/`，写 `wrangler.toml`（cron + secrets）、`worker.ts`、CF 版 caps
4. 建 `adapters/node-worker/`，Dockerfile 装 `iputils-ping` + setcap，Node caps 用 `net`/`dgram`/`child_process`
5. 改 `supabase/functions/run-checks/index.ts` 为薄壳，注入 Deno caps；`_shared/checkers.ts` 保留导出以兼容 `check-now`
6. 新增 `docker-compose.slim.yaml`（仅 db+app+node-worker，供想要精简自托管的用户）
7. 更新 `README.md`：三种部署路径的选择指南

## 验收
- `bun run build` 通过；`bunx vitest run` 现有测试通过
- 为 `checker-core` 加最小单测（用 mock caps 跑 http/tcp/ping 三种）
- CF adapter `wrangler deploy --dry-run` 通过
- node-worker Dockerfile 本地 `docker build` 成功，容器内 `ping` 有 cap_net_raw

## 不做的事
- 不删除现有 `docker-compose.yaml` 或 edge function（避免破坏现有用户）
- 不改前端和数据库 schema
- 不做 CF Workers 上的 database 类型 monitor 的复杂 DSN 代理（先直接标记为 "需自托管"）