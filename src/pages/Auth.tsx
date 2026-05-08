import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LangToggle, ThemeToggle } from "@/components/HeaderActions";
import { Activity } from "lucide-react";
import { toast } from "sonner";

export function AuthScreen() {
  const { initialized, setup, login } = useAuth();
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const isSetup = !initialized;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim().length < 3) return toast.error(t("auth.usernameTooShort"));
    if (password.length < 8) return toast.error(t("auth.passwordTooShort"));
    if (isSetup && password !== confirm) return toast.error(t("auth.passwordMismatch"));
    setLoading(true);
    try {
      if (isSetup) {
        await setup(username.trim(), password);
        toast.success(t("auth.setupOk"));
      } else {
        await login(username.trim(), password);
        toast.success(t("auth.loginOk"));
      }
    } catch (err) {
      toast.error((err as Error).message || t("auth.opFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LangToggle />
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <CardTitle>{isSetup ? t("auth.setupTitle") : t("auth.loginTitle")}</CardTitle>
          <CardDescription>{isSetup ? t("auth.setupDesc") : t("auth.loginDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u">{t("auth.username")}</Label>
              <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p">{t("auth.password")}</Label>
              <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSetup ? "new-password" : "current-password"} required />
            </div>
            {isSetup && (
              <div className="space-y-2">
                <Label htmlFor="c">{t("auth.confirmPassword")}</Label>
                <Input id="c" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("auth.processing") : isSetup ? t("auth.submitSetup") : t("auth.submitLogin")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
