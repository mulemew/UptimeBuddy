import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listMaintenance, saveMaintenance, deleteMaintenance, listMonitors, type MaintenanceWindow, type Monitor } from "@/lib/monitors";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Maintenance() {
  const { t } = useTranslation();
  const [items, setItems] = useState<MaintenanceWindow[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [editing, setEditing] = useState<Partial<MaintenanceWindow> | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [a, m] = await Promise.all([listMaintenance(), listMonitors()]);
      setItems(a); setMonitors(m);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Load failed"); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  function newWindow() {
    const now = new Date();
    const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);
    setEditing({
      title: "",
      monitor_id: null,
      starts_at: now.toISOString(),
      ends_at: inAnHour.toISOString(),
      recurrence: "none",
      weekday: null,
    });
  }

  async function save() {
    if (!editing?.title || !editing.starts_at || !editing.ends_at) {
      toast.error(t("maintenance.fillAll"));
      return;
    }
    try {
      const payload = {
        title: editing.title,
        monitor_id: editing.monitor_id ?? null,
        starts_at: new Date(editing.starts_at).toISOString(),
        ends_at: new Date(editing.ends_at).toISOString(),
        recurrence: editing.recurrence ?? "none",
        weekday: editing.recurrence === "weekly" ? (editing.weekday ?? 0) : null,
      };
      await saveMaintenance(payload, editing.id);
      toast.success(t("common.saved"));
      setEditing(null);
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
  }

  async function onDelete(id: string) {
    if (!confirm(t("maintenance.deleteConfirm"))) return;
    await deleteMaintenance(id);
    refresh();
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-4xl py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("maintenance.title")}</h1>
          <Button onClick={newWindow}><Plus className="mr-1 h-4 w-4" />{t("maintenance.add")}</Button>
        </div>

        {editing && (
          <Card className="mb-6 p-5 space-y-3">
            <div className="space-y-2">
              <Label>{t("maintenance.titleField")}</Label>
              <Input value={editing.title ?? ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("maintenance.scope")}</Label>
              <Select
                value={editing.monitor_id ?? "__all__"}
                onValueChange={(v) => setEditing({ ...editing, monitor_id: v === "__all__" ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("maintenance.allMonitors")}</SelectItem>
                  {monitors.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("maintenance.startsAt")}</Label>
                <Input type="datetime-local" value={editing.starts_at ? toLocalInput(editing.starts_at) : ""}
                  onChange={(e) => setEditing({ ...editing, starts_at: new Date(e.target.value).toISOString() })} />
              </div>
              <div className="space-y-2">
                <Label>{t("maintenance.endsAt")}</Label>
                <Input type="datetime-local" value={editing.ends_at ? toLocalInput(editing.ends_at) : ""}
                  onChange={(e) => setEditing({ ...editing, ends_at: new Date(e.target.value).toISOString() })} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("maintenance.recurrence")}</Label>
                <Select value={editing.recurrence ?? "none"} onValueChange={(v) => setEditing({ ...editing, recurrence: v as "none" | "daily" | "weekly" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("maintenance.recurrenceNone")}</SelectItem>
                    <SelectItem value="daily">{t("maintenance.recurrenceDaily")}</SelectItem>
                    <SelectItem value="weekly">{t("maintenance.recurrenceWeekly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editing.recurrence === "weekly" && (
                <div className="space-y-2">
                  <Label>{t("maintenance.weekday")}</Label>
                  <Select value={String(editing.weekday ?? 0)} onValueChange={(v) => setEditing({ ...editing, weekday: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4, 5, 6].map((d) => <SelectItem key={d} value={String(d)}>{t(`maintenance.weekdays.${d}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button onClick={save}>{t("common.save")}</Button>
            </div>
          </Card>
        )}

        <Card className="p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("maintenance.empty")}</p>
          ) : (
            <ul className="divide-y">
              {items.map((it) => {
                const monitor = monitors.find((m) => m.id === it.monitor_id);
                return (
                  <li key={it.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium">{it.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {it.monitor_id ? (monitor?.name ?? it.monitor_id) : t("maintenance.allMonitors")} · {it.recurrence}
                        {it.recurrence === "weekly" && it.weekday != null ? ` · ${t(`maintenance.weekdays.${it.weekday}`)}` : ""}
                        {" · "}
                        {new Date(it.starts_at).toLocaleString()} → {new Date(it.ends_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => setEditing(it)}>{t("common.edit")}</Button>
                      <Button variant="ghost" size="icon" onClick={() => onDelete(it.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}
