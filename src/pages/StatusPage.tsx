import { useQuery } from "@tanstack/react-query";
import { listMonitors, recentHeartbeats, uptimePercent, type Monitor } from "@/lib/monitors";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusBar } from "@/components/StatusBar";
import { Card } from "@/components/ui/card";

function StatusRow({ monitor }: { monitor: Monitor }) {
  const { data: beats = [] } = useQuery({
    queryKey: ["heartbeats", monitor.id, "status"],
    queryFn: () => recentHeartbeats(monitor.id, 30),
    refetchInterval: 60_000,
  });
  return (
    <div className="flex items-center justify-between gap-4 border-b py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium">{monitor.name}</h3>
          <StatusBadge status={monitor.last_status} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{uptimePercent(beats)}% 在线</p>
      </div>
      <StatusBar beats={beats} count={30} />
    </div>
  );
}

export default function StatusPage() {
  const { data: monitors = [] } = useQuery({
    queryKey: ["monitors"],
    queryFn: listMonitors,
    refetchInterval: 60_000,
  });

  const enabled = monitors.filter((m) => m.enabled);
  const allUp = enabled.length > 0 && enabled.every((m) => m.last_status === "up");
  const anyDown = enabled.some((m) => m.last_status === "down");

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-3xl py-10">
        <Card className={`p-6 text-center ${anyDown ? "bg-status-down/10" : allUp ? "bg-status-up/10" : ""}`}>
          <h1 className="text-2xl font-bold">
            {anyDown ? "部分服务异常" : allUp ? "所有服务运行正常" : "状态未知"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            最后更新：{new Date().toLocaleString()}
          </p>
        </Card>

        <Card className="mt-6 p-6">
          <h2 className="mb-2 text-sm font-semibold">服务状态</h2>
          {enabled.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">尚未配置任何监控。</p>
          ) : (
            <div>
              {enabled.map((m) => <StatusRow key={m.id} monitor={m} />)}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
