import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { listMonitors } from "@/lib/monitors";
import { AppHeader } from "@/components/AppHeader";
import { MonitorCard } from "@/components/MonitorCard";
import { Button } from "@/components/ui/button";
import { Plus, Activity } from "lucide-react";

const Index = () => {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { data: monitors = [], isLoading } = useQuery({
    queryKey: ["monitors"],
    queryFn: listMonitors,
    refetchInterval: 30_000,
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

  const upCount = monitors.filter((m) => m.last_status === "up").length;
  const downCount = monitors.filter((m) => m.last_status === "down").length;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("dashboard.summary", { total: monitors.length, up: upCount, down: downCount })}
            </p>
          </div>
          <Link to="/monitors/new">
            <Button><Plus className="mr-1 h-4 w-4" />{t("dashboard.addMonitor")}</Button>
          </Link>
        </div>

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
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {monitors.map((m) => <MonitorCard key={m.id} monitor={m} />)}
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
