import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { StatusBar } from "@/components/StatusBar";
import { StatusBadge } from "@/components/StatusBadge";
import { recentHeartbeats, uptimePercent, avgResponse, type Monitor } from "@/lib/monitors";
import { formatDistanceToNow } from "date-fns";
import { dfLocale } from "@/lib/dateLocale";

export function MonitorCard({ monitor, maintenance = false }: { monitor: Monitor; maintenance?: boolean }) {
  const { t } = useTranslation();
  const { data: beats = [] } = useQuery({
    queryKey: ["heartbeats", monitor.id, "card"],
    queryFn: () => recentHeartbeats(monitor.id, 30),
    refetchInterval: 30_000,
  });

  const uptime = uptimePercent(beats);
  const avg = avgResponse(beats);

  return (
    <Link to={`/monitors/${monitor.id}`}>
      <Card className="p-5 transition-colors hover:bg-accent/40">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold">{monitor.name}</h3>
              {!monitor.enabled ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("common.paused")}</span>
              ) : maintenance ? (
                <span className="rounded-full bg-status-pending/15 px-2 py-0.5 text-xs font-medium text-status-pending">
                  {t("common.maintenance")}
                </span>
              ) : (
                <StatusBadge status={monitor.last_status} />
              )}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {t(`monitorTypes.${monitor.type}`)} · {monitor.target}
            </p>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">{uptime}%</div>
            <div className="text-xs text-muted-foreground">
              {avg != null ? `${avg} ms` : "—"}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <StatusBar beats={beats} count={30} />
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("monitorCard.intervalLabel", { n: monitor.interval_minutes })}</span>
          <span>
            {monitor.last_checked_at
              ? formatDistanceToNow(new Date(monitor.last_checked_at), { locale: dfLocale(), addSuffix: true })
              : t("monitorCard.neverChecked")}
          </span>
        </div>
      </Card>
    </Link>
  );
}
