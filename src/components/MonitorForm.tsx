import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { intervalOptions, httpMethods, type Monitor } from "@/lib/monitors";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

function buildSchema(t: (k: string, opts?: Record<string, unknown>) => string) {
  const headerRow = z.object({
    key: z.string().max(200).default(""),
    value: z.string().max(2000).default(""),
  });
  return z.object({
    name: z.string().min(1, t("monitorForm.nameRequired")).max(100),
    type: z.enum(["http", "tcp", "ping"]),
    target: z.string().min(1, t("monitorForm.targetRequired")),
    interval_minutes: z.coerce.number().int().min(1).max(1440),
    timeout_seconds: z.coerce.number().int().min(1).max(60),
    expected_status_codes: z.string().min(1),
    keyword: z.string().max(500).optional(),
    match_mode: z.enum(["contains", "not_contains", "regex"]),
    http_method: z.enum(["GET", "POST", "HEAD", "PUT", "PATCH", "DELETE"]),
    http_body: z.string().max(32_000).optional(),
    http_body_type: z.enum(["json", "xml", "text", "form"]),
    http_headers: z.array(headerRow).max(30),
    follow_redirects: z.boolean(),
    ignore_tls_errors: z.boolean(),
    cert_expiry_warn_days: z.coerce.number().int().min(0).max(365),
    degraded_threshold_ms: z.coerce.number().int().min(0).max(120_000),
  }).superRefine((v, ctx) => {
    if (v.match_mode === "regex" && v.keyword) {
      try { new RegExp(v.keyword); } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["keyword"], message: t("monitorForm.regexInvalid", { msg: (e as Error).message }) });
      }
    }
  });
}

type FormValues = {
  name: string;
  type: "http" | "tcp" | "ping";
  target: string;
  interval_minutes: number;
  timeout_seconds: number;
  expected_status_codes: string;
  keyword?: string;
  match_mode: "contains" | "not_contains" | "regex";
  http_method: "GET" | "POST" | "HEAD" | "PUT" | "PATCH" | "DELETE";
  http_body?: string;
  http_body_type: "json" | "xml" | "text" | "form";
  http_headers: { key: string; value: string }[];
  follow_redirects: boolean;
  ignore_tls_errors: boolean;
  cert_expiry_warn_days: number;
  degraded_threshold_ms: number;
};

function headersObjToArr(h: unknown): { key: string; value: string }[] {
  if (!h || typeof h !== "object") return [];
  return Object.entries(h as Record<string, unknown>).map(([k, v]) => ({ key: k, value: String(v ?? "") }));
}

function headersArrToObj(arr: { key?: string; value?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of arr) {
    const k = (key ?? "").trim();
    if (k) out[k] = value ?? "";
  }
  return out;
}

export function MonitorForm({ initial, onSaved }: { initial?: Monitor; onSaved?: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => buildSchema(t), [t]);

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
      match_mode: (initial?.match_mode as "contains" | "not_contains" | "regex") ?? "contains",
      http_method: (initial?.http_method as FormValues["http_method"]) ?? "GET",
      http_body: initial?.http_body ?? "",
      http_body_type: (initial?.http_body_type as FormValues["http_body_type"]) ?? "json",
      http_headers: headersObjToArr(initial?.http_headers),
      follow_redirects: initial?.follow_redirects ?? true,
      ignore_tls_errors: initial?.ignore_tls_errors ?? false,
      cert_expiry_warn_days: initial?.cert_expiry_warn_days ?? 14,
      degraded_threshold_ms: initial?.degraded_threshold_ms ?? 0,
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "http_headers" });
  const type = form.watch("type");
  const method = form.watch("http_method");
  const isHttp = type === "http";
  const hasBody = isHttp && method !== "GET" && method !== "HEAD";

  const targetPlaceholder =
    type === "tcp" ? "example.com:5432"
    : type === "ping" ? "example.com"
    : "https://example.com";

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const payload = {
        name: values.name,
        type: values.type,
        target: values.target,
        interval_minutes: values.interval_minutes,
        timeout_seconds: values.timeout_seconds,
        expected_status_codes: values.expected_status_codes,
        keyword: isHttp ? (values.keyword?.trim() || null) : null,
        match_mode: values.match_mode,
        keyword_match: values.match_mode === "regex" ? "contains" : values.match_mode,
        http_method: isHttp ? values.http_method : "GET",
        http_body: hasBody ? (values.http_body || null) : null,
        http_body_type: hasBody ? values.http_body_type : null,
        http_headers: isHttp ? headersArrToObj(values.http_headers) : {},
        follow_redirects: values.follow_redirects,
        ignore_tls_errors: values.ignore_tls_errors,
        cert_expiry_warn_days: values.cert_expiry_warn_days,
        degraded_threshold_ms: values.degraded_threshold_ms || null,
      };
      if (initial) {
        const { error } = await supabase.from("monitors").update(payload as never).eq("id", initial.id);
        if (error) throw error;
        toast.success(t("monitorForm.savedOk"));
      } else {
        const { error } = await supabase.from("monitors").insert(payload as never);
        if (error) throw error;
        toast.success(t("monitorForm.createdOk"));
        navigate("/");
      }
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("monitorForm.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">{t("monitorForm.nameLabel")}</Label>
          <Input id="name" {...form.register("name")} placeholder="My Website" />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("monitorForm.type")}</Label>
            <Select value={type} onValueChange={(v) => form.setValue("type", v as FormValues["type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="http">{t("monitorTypes.http")}</SelectItem>
                <SelectItem value="tcp">{t("monitorTypes.tcp")}</SelectItem>
                <SelectItem value="ping">{t("monitorTypes.ping")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("monitorForm.intervalLabel")}</Label>
            <Select
              value={String(form.watch("interval_minutes"))}
              onValueChange={(v) => form.setValue("interval_minutes", Number(v))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {intervalOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} {t("common.minutes")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="target">{t("monitorForm.target")}</Label>
          <Input id="target" {...form.register("target")} placeholder={targetPlaceholder} />
          {form.formState.errors.target && (
            <p className="text-sm text-destructive">{form.formState.errors.target.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="timeout">{t("monitorForm.timeout")}</Label>
            <Input id="timeout" type="number" min={1} max={60} {...form.register("timeout_seconds")} />
          </div>
          {isHttp && (
            <>
              <div className="space-y-2">
                <Label htmlFor="codes">{t("monitorForm.expectedCodes")}</Label>
                <Input id="codes" {...form.register("expected_status_codes")} placeholder="200-299,300-399" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="degraded">{t("monitorForm.degradedThreshold")}</Label>
                <Input id="degraded" type="number" min={0} {...form.register("degraded_threshold_ms")} />
              </div>
            </>
          )}
        </div>

        {isHttp && (
          <Accordion type="single" collapsible>
            <AccordionItem value="adv">
              <AccordionTrigger>{t("monitorForm.advHttp")}</AccordionTrigger>
              <AccordionContent className="space-y-5 pt-2">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>请求方法</Label>
                    <Select
                      value={method}
                      onValueChange={(v) => form.setValue("http_method", v as FormValues["http_method"])}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {httpMethods.map((mm) => <SelectItem key={mm} value={mm}>{mm}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label className="text-sm">跟随重定向</Label>
                      <p className="text-xs text-muted-foreground">关闭后 3xx 视为正常</p>
                    </div>
                    <Switch
                      checked={form.watch("follow_redirects")}
                      onCheckedChange={(v) => form.setValue("follow_redirects", v)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>请求头 (Headers)</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => append({ key: "", value: "" })}>
                      <Plus className="mr-1 h-3.5 w-3.5" />添加
                    </Button>
                  </div>
                  {fields.length === 0 && (
                    <p className="text-xs text-muted-foreground">暂无自定义请求头</p>
                  )}
                  <div className="space-y-2">
                    {fields.map((f, idx) => (
                      <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <Input placeholder="Header 名称" {...form.register(`http_headers.${idx}.key` as const)} />
                        <Input placeholder="值" {...form.register(`http_headers.${idx}.value` as const)} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(idx)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {hasBody && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
                    <div className="space-y-2">
                      <Label>Body 类型</Label>
                      <Select
                        value={form.watch("http_body_type")}
                        onValueChange={(v) => form.setValue("http_body_type", v as FormValues["http_body_type"])}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="json">JSON</SelectItem>
                          <SelectItem value="xml">XML</SelectItem>
                          <SelectItem value="form">Form</SelectItem>
                          <SelectItem value="text">Text</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="body">Body</Label>
                      <Textarea id="body" rows={6} {...form.register("http_body")} placeholder='{"key":"value"}' />
                    </div>
                  </div>
                )}

                <div className="space-y-2 rounded-md border p-3">
                  <Label className="text-sm">关键字判定（可选）</Label>
                  <p className="text-xs text-muted-foreground">填写后会读取响应正文进行匹配；留空则跳过</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
                    <div className="space-y-1">
                      <Input
                        {...form.register("keyword")}
                        placeholder="例如：欢迎 或 ^OK$"
                      />
                      {form.formState.errors.keyword && (
                        <p className="text-sm text-destructive">{form.formState.errors.keyword.message}</p>
                      )}
                    </div>
                    <Select
                      value={form.watch("match_mode")}
                      onValueChange={(v) => form.setValue("match_mode", v as FormValues["match_mode"])}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contains">应包含</SelectItem>
                        <SelectItem value="not_contains">不应包含</SelectItem>
                        <SelectItem value="regex">正则匹配</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label className="text-sm">忽略 TLS 证书错误</Label>
                      <p className="text-xs text-muted-foreground">运行时受限：会标记为降级</p>
                    </div>
                    <Switch
                      checked={form.watch("ignore_tls_errors")}
                      onCheckedChange={(v) => form.setValue("ignore_tls_errors", v)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cert">证书过期预警（天，0=关闭）</Label>
                    <Input id="cert" type="number" min={0} max={365} {...form.register("cert_expiry_warn_days")} />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>取消</Button>
          <Button type="submit" disabled={submitting}>{initial ? "保存" : "创建监控"}</Button>
        </div>
      </form>
    </Card>
  );
}
