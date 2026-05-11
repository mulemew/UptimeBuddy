import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { listMonitors, listMaintenance } from "@/lib/monitors";
import { activeMaintenanceFor } from "@/lib/maintenance";
import { AppHeader } from "@/components/AppHeader";
import { MonitorCard } from "@/components/MonitorCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Activity, Search } from "lucide-react";

type Filter = "all" | "up" | "down" | "pending" | "degraded" | "maintenance" | "paused";

const Index = () => {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const { data: monitors = [], isLoading } = useQuery({
    queryKey: ["monitors"],
    queryFn: listMonitors,
    refetchInterval: 30_000,
  });
  const { data: windows = [] } = useQuery({
    queryKey: ["maintenance-windows"],
    queryFn: listMaintenance,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("monitors-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "monitors" }, () => {
        qc.invalidateQueries({ queryKey: ["monitors"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "heartbeats" }, (payload) => {
        const monitorId = (payload.new as { monitor_id: string }).monitor_id;
        qc.invalidateQueries({ queryKey: ["heartbeats", monitorId, "card"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const inMaint = (id: string) => activeMaintenanceFor(windows, id);
  const upCount = monitors.filter((m) => m.enabled && !inMaint(m.id) && m.last_status === "up").length;
  const downCount = monitors.filter((m) => m.enabled && !inMaint(m.id) && m.last_status === "down").length;
  const maintCount = monitors.filter((m) => m.enabled && inMaint(m.id)).length;
  const pausedCount = monitors.filter((m) => !m.enabled).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return monitors.filter((m) => {
      if (q && !(m.name.toLowerCase().includes(q) || m.target.toLowerCase().includes(q))) return false;
      if (filter === "all") return true;
      if (filter === "maintenance") return inMaint(m.id);
      if (filter === "paused") return !m.enabled;
      return !inMaint(m.id) && m.last_status === filter;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitors, windows, search, filter]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("dashboard.summary", { total: monitors.length, up: upCount, down: downCount })}
              {maintCount > 0 ? ` · ${t("dashboard.maintenance", { n: maintCount })}` : ""}
            </p>
          </div>
          <Link to="/monitors/new">
            <Button><Plus className="mr-1 h-4 w-4" />{t("dashboard.addMonitor")}</Button>
          </Link>
        </div>

        {monitors.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("dashboard.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("dashboard.filter.all")}</SelectItem>
                <SelectItem value="up">{t("statusBadge.up")}</SelectItem>
                <SelectItem value="down">{t("statusBadge.down")}</SelectItem>
                <SelectItem value="degraded">{t("statusBadge.degraded")}</SelectItem>
                <SelectItem value="pending">{t("statusBadge.pending")}</SelectItem>
                <SelectItem value="maintenance">{t("common.maintenance")}</SelectItem>
                <SelectItem value="paused">{t("common.paused")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {isLoading ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : monitors.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">{t("dashboard.empty")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.emptyDesc")}</p>
            <Link to="/monitors/new">
              <Button className="mt-4"><Plus className="mr-1 h-4 w-4" />{t("dashboard.addMonitor")}</Button>
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            {t("dashboard.noMatch")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((m) => <MonitorCard key={m.id} monitor={m} maintenance={inMaint(m.id)} />)}
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
