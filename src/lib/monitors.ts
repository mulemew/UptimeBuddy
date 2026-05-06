import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Monitor = Database["public"]["Tables"]["monitors"]["Row"];
export type MonitorInsert = Database["public"]["Tables"]["monitors"]["Insert"];
export type Heartbeat = Database["public"]["Tables"]["heartbeats"]["Row"];
export type Incident = Database["public"]["Tables"]["incidents"]["Row"];
export type MonitorStatus = "up" | "down" | "pending" | "degraded";
export type MatchMode = "contains" | "not_contains" | "regex";
export type HttpMethod = "GET" | "POST" | "HEAD" | "PUT" | "PATCH" | "DELETE";
export type HttpBodyType = "json" | "xml" | "text" | "form";
export const httpMethods: HttpMethod[] = ["GET", "POST", "HEAD", "PUT", "PATCH", "DELETE"];

export const intervalOptions = [1, 2, 5, 10, 15, 30, 60];

export const typeLabels: Record<Monitor["type"], string> = {
  http: "HTTP / HTTPS",
  keyword: "关键字",
  tcp: "TCP 端口",
  ping: "Ping (HTTP)",
};

export async function listMonitors(): Promise<Monitor[]> {
  const { data, error } = await supabase
    .from("monitors")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getMonitor(id: string): Promise<Monitor | null> {
  const { data, error } = await supabase.from("monitors").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function recentHeartbeats(monitorId: string, limit = 50): Promise<Heartbeat[]> {
  const { data, error } = await supabase
    .from("heartbeats")
    .select("*")
    .eq("monitor_id", monitorId)
    .order("checked_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function heartbeatsSince(monitorId: string, sinceIso: string): Promise<Heartbeat[]> {
  const { data, error } = await supabase
    .from("heartbeats")
    .select("*")
    .eq("monitor_id", monitorId)
    .gte("checked_at", sinceIso)
    .order("checked_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listIncidents(monitorId: string, limit = 20): Promise<Incident[]> {
  const { data, error } = await supabase
    .from("incidents")
    .select("*")
    .eq("monitor_id", monitorId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export function uptimePercent(beats: Heartbeat[]): number {
  if (!beats.length) return 0;
  const ups = beats.filter((b) => b.status === "up").length;
  return Math.round((ups / beats.length) * 1000) / 10;
}

export function avgResponse(beats: Heartbeat[]): number | null {
  const arr = beats.filter((b) => b.response_time_ms != null && b.status === "up").map((b) => b.response_time_ms!);
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

export async function checkNow(monitorId: string) {
  const { data, error } = await supabase.functions.invoke("check-now", { body: { monitor_id: monitorId } });
  if (error) throw error;
  return data;
}

export async function deleteMonitor(id: string) {
  const { error } = await supabase.from("monitors").delete().eq("id", id);
  if (error) throw error;
}

export async function toggleMonitor(id: string, enabled: boolean) {
  const { error } = await supabase.from("monitors").update({ enabled }).eq("id", id);
  if (error) throw error;
}
