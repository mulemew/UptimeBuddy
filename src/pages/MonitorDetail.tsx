import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import {
  getMonitor, recentHeartbeats, listIncidents, heartbeatsSince,
  uptimePercent, avgResponse, checkNow, deleteMonitor, toggleMonitor,
} from "@/lib/monitors";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusBar } from "@/components/StatusBar";
import { MonitorForm } from "@/components/MonitorForm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Trash2, RefreshCw } from "lucide-react";
import { formatDistanceToNow, formatDistanceStrict } from "date-fns";
import { dfLocale } from "@/lib/dateLocale";
import { toast } from "sonner";

const RANGES = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 } as const;
type RangeKey = keyof typeof RANGES;

export default function MonitorDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeKey>("24h");
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);

  const { data: monitor } = useQuery({
    queryKey: ["monitor", id],
    queryFn: () => getMonitor(id),
    refetchInterval: 30_000,
  });

  const sinceIso = useMemo(
    () => new Date(Date.now() - RANGES[range] * 60 * 60 * 1000).toISOString(),
    [range],
  );

  const { data: rangeBeats = [] } = useQuery({
    queryKey: ["heartbeats", id, range],
    queryFn: () => heartbeatsSince(id, sinceIso),
    refetchInterval: 30_000,
  });

  const { data: latestBeats = [] } = useQuery({
    queryKey: ["heartbeats", id, "latest"],
    queryFn: () => recentHeartbeats(id, 60),
    refetchInterval: 30_000,
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ["incidents", id],
    queryFn: () => listIncidents(id, 20),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel(`monitor-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "heartbeats", filter: `monitor_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["heartbeats", id] });
        qc.invalidateQueries({ queryKey: ["monitor", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents", filter: `monitor_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["incidents", id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  if (!monitor) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container py-8 text-muted-foreground">{t("common.loading")}</main>
      </div>
    );
  }

  const uptime = uptimePercent(rangeBeats);
  const avg = avgResponse(rangeBeats);
  const chartData = rangeBeats
    .filter((b) => b.response_time_ms != null)
    .map((b) => ({ t: new Date(b.checked_at).getTime(), ms: b.response_time_ms, status: b.status }));

  async function onCheckNow() {
    setChecking(true);
    try { await checkNow(id); toast.success(t("detail.triggerOk")); }
    catch (e) { toast.error(e instanceof Error ? e.message : t("detail.checkFailed")); }
    finally { setChecking(false); }
  }

  async function onDelete() {
    if (!confirm(t("detail.deleteConfirm"))) return;
    await deleteMonitor(id);
    toast.success(t("detail.deletedOk"));
    navigate("/");
  }

  const rangeLabel = t(`detail.range${range === "24h" ? "24h" : range === "7d" ? "7d" : "30d"}` as const);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{monitor.name}</h1>
              <StatusBadge status={monitor.last_status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t(`monitorTypes.${monitor.type}`)} · {monitor.target}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-2">
              <span className="text-sm text-muted-foreground">{t("common.enabled")}</span>
              <Switch
                checked={monitor.enabled}
                onCheckedChange={async (v) => { await toggleMonitor(id, v); qc.invalidateQueries({ queryKey: ["monitor", id] }); }}
              />
            </div>
            <Button variant="outline" onClick={onCheckNow} disabled={checking}>
              <RefreshCw className={`mr-1 h-4 w-4 ${checking ? "animate-spin" : ""}`} />{t("detail.checkNow")}
            </Button>
            <Button variant="outline" onClick={() => setEditing((v) => !v)}>{editing ? t("common.back") : t("common.edit")}</Button>
            <Button variant="ghost" size="icon" onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        </div>

        {editing ? (
          <div className="max-w-2xl">
            <MonitorForm initial={monitor} onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: ["monitor", id] }); }} />
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card className="p-4">
                <div className="text-xs text-muted-foreground">{t("detail.uptimeRange", { range: rangeLabel })}</div>
                <div className="mt-1 text-2xl font-bold">{uptime}%</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted-foreground">{t("detail.avgResponse")}</div>
                <div className="mt-1 text-2xl font-bold">{avg != null ? `${avg} ms` : "—"}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted-foreground">{t("detail.checkCount")}</div>
                <div className="mt-1 text-2xl font-bold">{rangeBeats.length}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted-foreground">{t("detail.lastCheck")}</div>
                <div className="mt-1 text-sm font-medium">
                  {monitor.last_checked_at
                    ? formatDistanceToNow(new Date(monitor.last_checked_at), { locale: dfLocale(), addSuffix: true })
                    : "—"}
                </div>
              </Card>
            </div>

            <Card className="mb-6 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t("detail.recentBeats")}</h2>
                {(() => {
                  const last = latestBeats.find((b) => b.cert_days_remaining != null);
                  return last ? (
                    <span
                      className="text-xs text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: t("detail.certRemaining", { n: last.cert_days_remaining }) }}
                    />
                  ) : null;
                })()}
              </div>
              <StatusBar beats={latestBeats} count={60} size="md" />
            </Card>

            <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <TabsList>
                <TabsTrigger value="24h">{t("detail.range24h")}</TabsTrigger>
                <TabsTrigger value="7d">{t("detail.range7d")}</TabsTrigger>
                <TabsTrigger value="30d">{t("detail.range30d")}</TabsTrigger>
              </TabsList>
              <TabsContent value={range} className="mt-4">
                <Card className="p-5">
                  <h2 className="mb-4 text-sm font-semibold">{t("detail.responseTime")}</h2>
                  <div className="h-64 w-full">
                    {chartData.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("detail.noData")}</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis
                            dataKey="t"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                          />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} unit="ms" />
                          <RTooltip
                            labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                            formatter={(v: number) => [`${v} ms`, t("detail.responseTooltip")]}
                            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                          />
                          <Line type="monotone" dataKey="ms" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
              </TabsContent>
            </Tabs>

            <Card className="mt-6 p-5">
              <h2 className="mb-4 text-sm font-semibold">{t("detail.recentIncidents")}</h2>
              {incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("detail.noIncidents")}</p>
              ) : (
                <ul className="divide-y">
                  {incidents.map((i) => (
                    <li key={i.id} className="flex items-center justify-between py-3">
                      <div>
                        <div className="text-sm font-medium">{i.reason ?? t("detail.downReason")}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(i.started_at).toLocaleString()}
                          {i.ended_at ? ` → ${new Date(i.ended_at).toLocaleString()}` : t("detail.ongoingSuffix")}
                        </div>
                      </div>
                      <div className="text-sm">
                        {i.ended_at && i.duration_seconds != null
                          ? formatDistanceStrict(0, i.duration_seconds * 1000, { locale: dfLocale() })
                          : <span className="text-status-down">{t("detail.ongoing")}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
