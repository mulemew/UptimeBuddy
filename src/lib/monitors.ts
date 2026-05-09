import { supabase } from "@/integrations/supabase/client";
import { invokeAuthed } from "@/lib/auth";
import type { Database } from "@/integrations/supabase/types";

export type Monitor = Database["public"]["Tables"]["monitors"]["Row"];
export type MonitorInsert = Database["public"]["Tables"]["monitors"]["Insert"];
export type Heartbeat = Database["public"]["Tables"]["heartbeats"]["Row"];
export type Incident = Database["public"]["Tables"]["incidents"]["Row"];
export type MonitorStatus = "up" | "down" | "pending" | "degraded";
export type MatchMode = "contains" | "not_contains" | "regex";
export type MonitorTypeKey = "http" | "tcp" | "ping" | "dns" | "multistep" | "database" | "push";
export type HttpMethod = "GET" | "POST" | "HEAD" | "PUT" | "PATCH" | "DELETE";
export type HttpBodyType = "json" | "xml" | "text" | "form";
export const httpMethods: HttpMethod[] = ["GET", "POST", "HEAD", "PUT", "PATCH", "DELETE"];

export const intervalOptions = [1, 2, 5, 10, 15, 30, 60];

export const typeLabels: Record<MonitorTypeKey, string> = {
  http: "HTTP / HTTPS",
  tcp: "TCP 端口",
  ping: "Ping (HTTP)",
  dns: "DNS",
  multistep: "Multi-step API",
  database: "Database",
  push: "Push (Heartbeat)",
};

export interface MonitorStep {
  name?: string;
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  body_type?: string | null;
  expected_status_codes?: string;
  extract?: { name: string; from: "json" | "header"; path: string }[];
  assert?: { from?: "json" | "body" | "header"; path?: string; op: "eq" | "contains" | "regex"; value: string }[];
}

export interface MaintenanceWindow {
  id: string;
  monitor_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  recurrence: "none" | "daily" | "weekly";
  weekday: number | null;
  created_at: string;
}

export async function listMonitors(): Promise<Monitor[]> {
  const { data, error } = await supabase
    .from("monitors").select("*").order("created_at", { ascending: true });
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
    .from("heartbeats").select("*").eq("monitor_id", monitorId)
    .order("checked_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function heartbeatsSince(monitorId: string, sinceIso: string): Promise<Heartbeat[]> {
  const { data, error } = await supabase
    .from("heartbeats").select("*").eq("monitor_id", monitorId)
    .gte("checked_at", sinceIso).order("checked_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listIncidents(monitorId: string, limit = 20): Promise<Incident[]> {
  const { data, error } = await supabase
    .from("incidents").select("*").eq("monitor_id", monitorId)
    .order("started_at", { ascending: false }).limit(limit);
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
  return await invokeAuthed("check-now", { monitor_id: monitorId });
}

export async function deleteMonitor(id: string) {
  await invokeAuthed("monitors-admin", { action: "delete", id });
}

export async function toggleMonitor(id: string, enabled: boolean) {
  await invokeAuthed("monitors-admin", { action: "toggle", id, enabled });
}

export async function saveMonitor(payload: Record<string, unknown>, id?: string) {
  if (id) return await invokeAuthed("monitors-admin", { action: "update", id, payload });
  return await invokeAuthed("monitors-admin", { action: "create", payload });
}

export async function regenPushToken(id: string) {
  return await invokeAuthed("monitors-admin", { action: "regen_token", id });
}

export async function listMaintenance(): Promise<MaintenanceWindow[]> {
  const r = await invokeAuthed("monitors-admin", { action: "maintenance.list" }) as { items?: MaintenanceWindow[] };
  return r.items ?? [];
}

export async function saveMaintenance(payload: Partial<MaintenanceWindow>, id?: string) {
  if (id) return await invokeAuthed("monitors-admin", { action: "maintenance.update", id, payload });
  return await invokeAuthed("monitors-admin", { action: "maintenance.create", payload });
}

export async function deleteMaintenance(id: string) {
  return await invokeAuthed("monitors-admin", { action: "maintenance.delete", id });
}

export function pushIngestUrl(token: string): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string)?.replace(/\/$/, "") || "";
  return `${base}/functions/v1/heartbeat-ingest?token=${token}`;
}
