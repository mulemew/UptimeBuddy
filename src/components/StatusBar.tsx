import { cn } from "@/lib/utils";
import type { Heartbeat } from "@/lib/monitors";

interface Props {
  beats: Heartbeat[];
  size?: "sm" | "md";
  count?: number;
}

export function StatusBar({ beats, size = "sm", count = 30 }: Props) {
  // Beats arrive newest-first; show oldest→newest left→right.
  const slice = beats.slice(0, count).reverse();
  const padding = Math.max(0, count - slice.length);
  return (
    <div className="flex items-center gap-[2px]">
      {Array.from({ length: padding }).map((_, i) => (
        <div
          key={`p-${i}`}
          className={cn(
            "rounded-sm bg-status-pending/30",
            size === "sm" ? "h-6 w-1.5" : "h-8 w-2",
          )}
        />
      ))}
      {slice.map((b) => (
        <div
          key={b.id}
          title={`${new Date(b.checked_at).toLocaleString()} · ${b.status}${b.response_time_ms ? ` · ${b.response_time_ms}ms` : ""}${b.error_message ? ` · ${b.error_message}` : ""}`}
          className={cn(
            "rounded-sm transition-colors",
            size === "sm" ? "h-6 w-1.5" : "h-8 w-2",
            b.status === "up" && "bg-status-up",
            b.status === "down" && "bg-status-down",
            b.status === "pending" && "bg-status-pending",
            b.status === "degraded" && "bg-status-degraded",
          )}
        />
      ))}
    </div>
  );
}
