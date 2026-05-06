import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { intervalOptions, type Monitor } from "@/lib/monitors";
import { toast } from "sonner";

const schema = z.object({
  name: z.string().min(1, "请输入名称").max(100),
  type: z.enum(["http", "keyword", "tcp", "ping"]),
  target: z.string().min(1, "请输入目标"),
  interval_minutes: z.coerce.number().int().min(1).max(1440),
  timeout_seconds: z.coerce.number().int().min(1).max(60),
  expected_status_codes: z.string().min(1),
  keyword: z.string().optional(),
  keyword_match: z.enum(["contains", "not_contains"]).optional(),
});

type FormValues = z.infer<typeof schema>;

export function MonitorForm({ initial, onSaved }: { initial?: Monitor; onSaved?: () => void }) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      type: initial?.type ?? "http",
      target: initial?.target ?? "",
      interval_minutes: initial?.interval_minutes ?? 5,
      timeout_seconds: initial?.timeout_seconds ?? 10,
      expected_status_codes: initial?.expected_status_codes ?? "200-299,300-399",
      keyword: initial?.keyword ?? "",
      keyword_match: initial?.keyword_match ?? "contains",
    },
  });

  const type = form.watch("type");

  const targetPlaceholder =
    type === "tcp" ? "example.com:5432"
    : type === "ping" ? "example.com"
    : "https://example.com";

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        keyword: type === "keyword" ? values.keyword || null : null,
        keyword_match: type === "keyword" ? values.keyword_match ?? "contains" : null,
      };
      if (initial) {
        const { error } = await supabase.from("monitors").update(payload as never).eq("id", initial.id);
        if (error) throw error;
        toast.success("已保存");
      } else {
        const { error } = await supabase.from("monitors").insert(payload as never);
        if (error) throw error;
        toast.success("监控已创建");
        navigate("/");
      }
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">名称</Label>
          <Input id="name" {...form.register("name")} placeholder="My Website" />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>类型</Label>
            <Select value={type} onValueChange={(v) => form.setValue("type", v as FormValues["type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP / HTTPS</SelectItem>
                <SelectItem value="keyword">关键字检查</SelectItem>
                <SelectItem value="tcp">TCP 端口</SelectItem>
                <SelectItem value="ping">Ping (基于 HTTP)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval">检查间隔（分钟）</Label>
            <Select
              value={String(form.watch("interval_minutes"))}
              onValueChange={(v) => form.setValue("interval_minutes", Number(v))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {intervalOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} 分钟</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="target">目标</Label>
          <Input id="target" {...form.register("target")} placeholder={targetPlaceholder} />
          {form.formState.errors.target && (
            <p className="text-sm text-destructive">{form.formState.errors.target.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="timeout">超时（秒）</Label>
            <Input id="timeout" type="number" min={1} max={60} {...form.register("timeout_seconds")} />
          </div>
          {(type === "http" || type === "keyword") && (
            <div className="space-y-2">
              <Label htmlFor="codes">期望状态码</Label>
              <Input id="codes" {...form.register("expected_status_codes")} placeholder="200-299,300-399" />
            </div>
          )}
        </div>

        {type === "keyword" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <Label htmlFor="keyword">关键字</Label>
              <Input id="keyword" {...form.register("keyword")} placeholder="例如：欢迎" />
            </div>
            <div className="space-y-2">
              <Label>匹配方式</Label>
              <Select
                value={form.watch("keyword_match") ?? "contains"}
                onValueChange={(v) => form.setValue("keyword_match", v as "contains" | "not_contains")}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">应包含</SelectItem>
                  <SelectItem value="not_contains">不应包含</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>取消</Button>
          <Button type="submit" disabled={submitting}>{initial ? "保存" : "创建监控"}</Button>
        </div>
      </form>
    </Card>
  );
}
