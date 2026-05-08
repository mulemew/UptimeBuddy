import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MonitorStatus } from "@/lib/monitors";

export function StatusBadge({ status, className }: { status: MonitorStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "up" && "bg-status-up/15 text-status-up",
        status === "down" && "bg-status-down/15 text-status-down",
        status === "pending" && "bg-status-pending/15 text-status-pending",
        status === "degraded" && "bg-status-degraded/15 text-status-degraded",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "up" && "bg-status-up",
          status === "down" && "bg-status-down",
          status === "pending" && "bg-status-pending",
          status === "degraded" && "bg-status-degraded",
        )}
      />
      {t(`statusBadge.${status}`)}
    </span>
  );
}
