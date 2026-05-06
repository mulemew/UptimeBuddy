import { cn } from "@/lib/utils";
import type { MonitorStatus } from "@/lib/monitors";

const labels: Record<MonitorStatus, string> = {
  up: "正常",
  down: "宕机",
  pending: "等待中",
};

export function StatusBadge({ status, className }: { status: MonitorStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "up" && "bg-status-up/15 text-status-up",
        status === "down" && "bg-status-down/15 text-status-down",
        status === "pending" && "bg-status-pending/15 text-status-pending",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "up" && "bg-status-up",
          status === "down" && "bg-status-down",
          status === "pending" && "bg-status-pending",
        )}
      />
      {labels[status]}
    </span>
  );
}
