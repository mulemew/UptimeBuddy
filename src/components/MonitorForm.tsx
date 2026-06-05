import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { saveMonitor, regenPushToken, pushIngestUrl } from "@/lib/monitors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { intervalOptions, httpMethods, type Monitor, type MonitorTypeKey, type MonitorStep } from "@/lib/monitors";
import { Trash2, Plus, RefreshCw, Copy } from "lucide-react";
import { toast } from "sonner";

const allTypes: MonitorTypeKey[] = ["http", "tcp", "ping", "dns", "multistep", "database", "push"];
const dnsRecordTypes = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;

function buildSchema(t: (k: string, opts?: Record<string, unknown>) => string) {
  const headerRow = z.object({ key: z.string().max(200).default(""), value: z.string().max(2000).default("") });
  return z.object({
    name: z.string().min(1, t("monitorForm.nameRequired")).max(100),
    type: z.enum(allTypes as unknown as [MonitorTypeKey, ...MonitorTypeKey[]]),
    target: z.string().max(2000).optional().default(""),
    interval_minutes: z.coerce.number().int().min(1).max(1440),
    timeout_seconds: z.coerce.number().int().min(1).max(60),
    expected_status_codes: z.string().min(1).default("200-299,300-399"),
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
    retry_count: z.coerce.number().int().min(0).max(10),
    retry_interval_seconds: z.coerce.number().int().min(1).max(600),
    dns_record_type: z.enum(dnsRecordTypes),
    dns_resolver: z.string().max(200).optional(),
    dns_expected_values_text: z.string().max(2000).optional(),
    steps: z.array(z.object({
      name: z.string().max(120).optional().default(""),
      method: z.string().max(10).default("GET"),
      url: z.string().min(1).max(2000),
      headers_text: z.string().max(8000).optional().default(""),
      body: z.string().max(32_000).optional().default(""),
      body_type: z.enum(["json", "xml", "text", "form"]).default("json"),
      expected_status_codes: z.string().max(200).default("200-299"),
      extract_text: z.string().max(4000).optional().default(""),
      assert_text: z.string().max(4000).optional().default(""),
    })).max(20),
    db_kind: z.enum(["postgres", "mysql"]),
    db_secret_name: z.string().max(120).optional(),
    db_query: z.string().max(2000).optional(),
    push_grace_seconds: z.coerce.number().int().min(5).max(86400),
  }).superRefine((v, ctx) => {
    if (v.match_mode === "regex" && v.keyword) {
      try { new RegExp(v.keyword); } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["keyword"], message: t("monitorForm.regexInvalid", { msg: (e as Error).message }) });
      }
    }
    if (["http", "tcp", "ping", "dns"].includes(v.type) && !v.target) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target"], message: t("monitorForm.targetRequired") });
    }
    if (v.type === "database") {
      if (!v.db_secret_name) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["db_secret_name"], message: "Required" });
      } else if (!/^MON_[A-Z0-9_]+$/.test(v.db_secret_name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["db_secret_name"], message: "Must start with MON_ (e.g. MON_PROD_DB)" });
      }
    }
    if (v.type === "multistep" && v.steps.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps"], message: t("monitorForm.stepsRequired") });
    }
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

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

function parseLines(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean);
}

function parseHeadersText(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of parseLines(s)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function headersObjToText(h: Record<string, string> | undefined): string {
  if (!h) return "";
  return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n");
}

// extract: "name=json:path" or "name=header:Header-Name" per line
function parseExtract(s: string): MonitorStep["extract"] {
  return parseLines(s).map((line) => {
    const m = line.match(/^([\w.-]+)\s*=\s*(json|header):(.+)$/);
    if (!m) return null;
    return { name: m[1], from: m[2] as "json" | "header", path: m[3].trim() };
  }).filter(Boolean) as MonitorStep["extract"];
}

function extractToText(arr: MonitorStep["extract"]): string {
  return (arr ?? []).map((e) => `${e.name}=${e.from}:${e.path}`).join("\n");
}

// assert: "from:path op value" e.g. "json:$.status eq ok" or "body contains hello"
function parseAssert(s: string): MonitorStep["assert"] {
  return parseLines(s).map((line) => {
    const m = line.match(/^(?:(json|header|body)(?::([^\s]+))?\s+)?(eq|contains|regex)\s+(.+)$/);
    if (!m) return null;
    return { from: (m[1] as "json" | "header" | "body") || "body", path: m[2] || "", op: m[3] as "eq" | "contains" | "regex", value: m[4] };
  }).filter(Boolean) as MonitorStep["assert"];
}

function assertToText(arr: MonitorStep["assert"]): string {
  return (arr ?? []).map((a) => {
    const head = a.from && a.from !== "body" ? `${a.from}${a.path ? ":" + a.path : ""} ` : (a.from === "body" ? "body " : "");
    return `${head}${a.op} ${a.value}`;
  }).join("\n");
}

export function MonitorForm({ initial, onSaved }: { initial?: Monitor; onSaved?: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(initial?.push_token ?? null);
  const schema = useMemo(() => buildSchema(t), [t]);

  const initialSteps = ((initial?.steps as unknown as MonitorStep[]) ?? []).map((s) => ({
    name: s.name ?? "",
    method: s.method ?? "GET",
    url: s.url ?? "",
    headers_text: headersObjToText(s.headers),
    body: s.body ?? "",
    body_type: (s.body_type as "json" | "xml" | "text" | "form") ?? "json",
    expected_status_codes: s.expected_status_codes ?? "200-299",
    extract_text: extractToText(s.extract),
    assert_text: assertToText(s.assert),
  }));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      name: initial?.name ?? "",
      type: (initial?.type as MonitorTypeKey) ?? "http",
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
      retry_count: initial?.retry_count ?? 0,
      retry_interval_seconds: initial?.retry_interval_seconds ?? 20,
      dns_record_type: ((initial?.dns_record_type as typeof dnsRecordTypes[number]) ?? "A"),
      dns_resolver: initial?.dns_resolver ?? "",
      dns_expected_values_text: (initial?.dns_expected_values ?? []).join("\n"),
      steps: initialSteps,
      db_kind: ((initial?.db_kind as "postgres" | "mysql") ?? "postgres"),
      db_secret_name: initial?.db_secret_name ?? "",
      db_query: initial?.db_query ?? "SELECT 1",
      push_grace_seconds: initial?.push_grace_seconds ?? 60,
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "http_headers" });
  const stepsFA = useFieldArray({ control: form.control, name: "steps" });
  const type = form.watch("type") as MonitorTypeKey;
  const method = form.watch("http_method");
  const isHttp = type === "http";
  const hasBody = isHttp && method !== "GET" && method !== "HEAD";

  const targetPlaceholder =
    type === "tcp" ? "example.com:5432"
    : type === "ping" ? "example.com"
    : type === "dns" ? "example.com"
    : type === "http" ? "https://example.com"
    : "";

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: values.name,
        type: values.type,
        target: values.target || "",
        interval_minutes: values.interval_minutes,
        timeout_seconds: values.timeout_seconds,
        expected_status_codes: values.expected_status_codes,
        retry_count: values.retry_count,
        retry_interval_seconds: values.retry_interval_seconds,
        degraded_threshold_ms: values.degraded_threshold_ms || null,
      };

      if (values.type === "http") {
        Object.assign(payload, {
          keyword: values.keyword?.trim() || null,
          match_mode: values.match_mode,
          keyword_match: values.match_mode === "regex" ? "contains" : values.match_mode,
          http_method: values.http_method,
          http_body: hasBody ? (values.http_body || null) : null,
          http_body_type: hasBody ? values.http_body_type : null,
          http_headers: headersArrToObj(values.http_headers),
          follow_redirects: values.follow_redirects,
          ignore_tls_errors: values.ignore_tls_errors,
          cert_expiry_warn_days: values.cert_expiry_warn_days,
        });
      }
      if (values.type === "dns") {
        Object.assign(payload, {
          dns_record_type: values.dns_record_type,
          dns_resolver: values.dns_resolver || null,
          dns_expected_values: parseLines(values.dns_expected_values_text || ""),
        });
      }
      if (values.type === "multistep") {
        payload.steps = values.steps.map((s) => ({
          name: s.name || undefined,
          method: s.method || "GET",
          url: s.url,
          headers: parseHeadersText(s.headers_text || ""),
          body: s.body || null,
          body_type: s.body_type,
          expected_status_codes: s.expected_status_codes,
          extract: parseExtract(s.extract_text || ""),
          assert: parseAssert(s.assert_text || ""),
        }));
      }
      if (values.type === "database") {
        Object.assign(payload, {
          db_kind: values.db_kind,
          db_secret_name: values.db_secret_name,
          db_query: values.db_query || "SELECT 1",
        });
      }
      if (values.type === "push") {
        payload.push_grace_seconds = values.push_grace_seconds;
      }

      if (initial) {
        await saveMonitor(payload, initial.id);
        toast.success(t("monitorForm.savedOk"));
      } else {
        const r = await saveMonitor(payload) as { push_token?: string };
        if (r?.push_token) setPushToken(r.push_token);
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

  async function onRegenToken() {
    if (!initial) return;
    const r = await regenPushToken(initial.id) as { push_token?: string };
    if (r?.push_token) {
      setPushToken(r.push_token);
      toast.success(t("monitorForm.tokenRegenerated"));
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={form.handleSubmit(onSubmit as never)} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">{t("monitorForm.nameLabel")}</Label>
          <Input id="name" {...form.register("name")} placeholder="My Website" />
          {form.formState.errors.name && <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("monitorForm.type")}</Label>
            <Select value={type} onValueChange={(v) => form.setValue("type", v as MonitorTypeKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allTypes.map((tt) => <SelectItem key={tt} value={tt}>{t(`monitorTypes.${tt}`)}</SelectItem>)}
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
                {intervalOptions.map((n) => <SelectItem key={n} value={String(n)}>{n} {t("common.minutes")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {type !== "multistep" && type !== "database" && type !== "push" && (
          <div className="space-y-2">
            <Label htmlFor="target">{t("monitorForm.target")}</Label>
            <Input id="target" {...form.register("target")} placeholder={targetPlaceholder} />
            {form.formState.errors.target && <p className="text-sm text-destructive">{String(form.formState.errors.target.message)}</p>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="timeout">{t("monitorForm.timeout")}</Label>
            <Input id="timeout" type="number" min={1} max={60} {...form.register("timeout_seconds")} />
          </div>
          {(type === "http" || type === "multistep") && (
            <div className="space-y-2">
              <Label htmlFor="degraded">{t("monitorForm.degradedThreshold")}</Label>
              <Input id="degraded" type="number" min={0} {...form.register("degraded_threshold_ms")} />
            </div>
          )}
          {isHttp && (
            <div className="space-y-2">
              <Label htmlFor="codes">{t("monitorForm.expectedCodes")}</Label>
              <Input id="codes" {...form.register("expected_status_codes")} placeholder="200-299,300-399" />
            </div>
          )}
        </div>

        {/* Retry settings — apply to all active checks */}
        {type !== "push" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-md border p-3">
            <div className="space-y-2">
              <Label>{t("monitorForm.retryCount")}</Label>
              <Input type="number" min={0} max={10} {...form.register("retry_count")} />
              <p className="text-xs text-muted-foreground">{t("monitorForm.retryCountDesc")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("monitorForm.retryInterval")}</Label>
              <Input type="number" min={1} max={600} {...form.register("retry_interval_seconds")} />
            </div>
          </div>
        )}

        {/* DNS */}
        {type === "dns" && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("monitorForm.dnsRecord")}</Label>
                <Select
                  value={form.watch("dns_record_type")}
                  onValueChange={(v) => form.setValue("dns_record_type", v as typeof dnsRecordTypes[number])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{dnsRecordTypes.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("monitorForm.dnsResolver")}</Label>
                <Input {...form.register("dns_resolver")} placeholder="8.8.8.8 or 1.1.1.1:53" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("monitorForm.dnsExpected")}</Label>
              <Textarea rows={3} {...form.register("dns_expected_values_text")} placeholder={t("monitorForm.dnsExpectedPh")} />
              <p className="text-xs text-muted-foreground">{t("monitorForm.dnsExpectedDesc")}</p>
            </div>
          </div>
        )}

        {/* Database */}
        {type === "database" && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("monitorForm.dbHint")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("monitorForm.dbKind")}</Label>
                <Select
                  value={form.watch("db_kind")}
                  onValueChange={(v) => form.setValue("db_kind", v as "postgres" | "mysql")}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postgres">PostgreSQL</SelectItem>
                    <SelectItem value="mysql">MySQL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("monitorForm.dbSecret")}</Label>
                <Input {...form.register("db_secret_name")} placeholder="MON_DB_MAIN" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("monitorForm.dbQuery")}</Label>
              <Input {...form.register("db_query")} placeholder="SELECT 1" />
            </div>
          </div>
        )}

        {/* Push */}
        {type === "push" && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("monitorForm.pushDesc")}</p>
            <div className="space-y-2">
              <Label>{t("monitorForm.pushGrace")}</Label>
              <Input type="number" min={5} max={86400} {...form.register("push_grace_seconds")} />
            </div>
            {pushToken && (
              <div className="space-y-2">
                <Label>{t("monitorForm.pushUrl")}</Label>
                <div className="flex gap-2">
                  <Input readOnly value={pushIngestUrl(pushToken)} />
                  <Button type="button" variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(pushIngestUrl(pushToken)); toast.success(t("common.copied")); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  {initial && (
                    <Button type="button" variant="outline" size="icon" onClick={onRegenToken}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Multistep */}
        {type === "multistep" && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label>{t("monitorForm.steps")}</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => stepsFA.append({ name: "", method: "GET", url: "", headers_text: "", body: "", body_type: "json", expected_status_codes: "200-299", extract_text: "", assert_text: "" })}>
                <Plus className="mr-1 h-3.5 w-3.5" />{t("monitorForm.addStep")}
              </Button>
            </div>
            {stepsFA.fields.length === 0 && <p className="text-xs text-muted-foreground">{t("monitorForm.noSteps")}</p>}
            <Accordion type="multiple" className="w-full">
              {stepsFA.fields.map((f, idx) => (
                <AccordionItem key={f.id} value={`s-${idx}`}>
                  <AccordionTrigger>
                    <div className="flex w-full items-center justify-between pr-2">
                      <span className="text-sm">#{idx + 1} {form.watch(`steps.${idx}.name`) || form.watch(`steps.${idx}.url`) || "—"}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-2">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px_140px_auto]">
                      <Input placeholder={t("monitorForm.stepName")} {...form.register(`steps.${idx}.name`)} />
                      <Controller control={form.control} name={`steps.${idx}.method`} render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{httpMethods.map((mm) => <SelectItem key={mm} value={mm}>{mm}</SelectItem>)}</SelectContent>
                        </Select>
                      )} />
                      <Input placeholder={t("monitorForm.expectedCodes")} {...form.register(`steps.${idx}.expected_status_codes`)} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => stepsFA.remove(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    <Input placeholder="https://api.example.com/{{var}}" {...form.register(`steps.${idx}.url`)} />
                    <Textarea rows={2} placeholder={t("monitorForm.stepHeadersPh")} {...form.register(`steps.${idx}.headers_text`)} />
                    <Textarea rows={3} placeholder={t("monitorForm.stepBodyPh")} {...form.register(`steps.${idx}.body`)} />
                    <Textarea rows={2} placeholder={t("monitorForm.stepExtractPh")} {...form.register(`steps.${idx}.extract_text`)} />
                    <Textarea rows={2} placeholder={t("monitorForm.stepAssertPh")} {...form.register(`steps.${idx}.assert_text`)} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}

        {/* HTTP advanced */}
        {isHttp && (
          <Accordion type="single" collapsible>
            <AccordionItem value="adv">
              <AccordionTrigger>{t("monitorForm.advHttp")}</AccordionTrigger>
              <AccordionContent className="space-y-5 pt-2">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("monitorForm.method")}</Label>
                    <Select value={method} onValueChange={(v) => form.setValue("http_method", v as FormValues["http_method"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{httpMethods.map((mm) => <SelectItem key={mm} value={mm}>{mm}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label className="text-sm">{t("monitorForm.followRedirects")}</Label>
                      <p className="text-xs text-muted-foreground">{t("monitorForm.followRedirectsDesc")}</p>
                    </div>
                    <Switch checked={form.watch("follow_redirects")} onCheckedChange={(v) => form.setValue("follow_redirects", v)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{t("monitorForm.headers")}</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => append({ key: "", value: "" })}>
                      <Plus className="mr-1 h-3.5 w-3.5" />{t("monitorForm.addHeader")}
                    </Button>
                  </div>
                  {fields.length === 0 && <p className="text-xs text-muted-foreground">{t("monitorForm.noHeaders")}</p>}
                  <div className="space-y-2">
                    {fields.map((f, idx) => (
                      <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <Input placeholder={t("monitorForm.headerName")} {...form.register(`http_headers.${idx}.key` as const)} />
                        <Input placeholder={t("monitorForm.headerValue")} {...form.register(`http_headers.${idx}.value` as const)} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    ))}
                  </div>
                </div>

                {hasBody && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
                    <div className="space-y-2">
                      <Label>{t("monitorForm.bodyType")}</Label>
                      <Select value={form.watch("http_body_type")} onValueChange={(v) => form.setValue("http_body_type", v as FormValues["http_body_type"])}>
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
                      <Label htmlFor="body">{t("monitorForm.body")}</Label>
                      <Textarea id="body" rows={6} {...form.register("http_body")} placeholder='{"key":"value"}' />
                    </div>
                  </div>
                )}

                <div className="space-y-2 rounded-md border p-3">
                  <Label className="text-sm">{t("monitorForm.keywordTitle")}</Label>
                  <p className="text-xs text-muted-foreground">{t("monitorForm.keywordDesc")}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
                    <div className="space-y-1">
                      <Input {...form.register("keyword")} placeholder={t("monitorForm.keywordPlaceholder")} />
                      {form.formState.errors.keyword && <p className="text-sm text-destructive">{form.formState.errors.keyword.message}</p>}
                    </div>
                    <Select value={form.watch("match_mode")} onValueChange={(v) => form.setValue("match_mode", v as FormValues["match_mode"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contains">{t("monitorForm.matchContains")}</SelectItem>
                        <SelectItem value="not_contains">{t("monitorForm.matchNotContains")}</SelectItem>
                        <SelectItem value="regex">{t("monitorForm.matchRegex")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label className="text-sm">{t("monitorForm.ignoreTls")}</Label>
                      <p className="text-xs text-muted-foreground">{t("monitorForm.ignoreTlsDesc")}</p>
                    </div>
                    <Switch checked={form.watch("ignore_tls_errors")} onCheckedChange={(v) => form.setValue("ignore_tls_errors", v)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cert">{t("monitorForm.certWarn")}</Label>
                    <Input id="cert" type="number" min={0} max={365} {...form.register("cert_expiry_warn_days")} />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={submitting}>{initial ? t("common.save") : t("monitorForm.create")}</Button>
        </div>
      </form>
    </Card>
  );
}
