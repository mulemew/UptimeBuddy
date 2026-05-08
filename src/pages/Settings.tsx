import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function Settings() {
  const { username, publicStatusPage, changeCredentials, updateSettings } = useAuth();
  const { t } = useTranslation();
  const [savingPublic, setSavingPublic] = useState(false);
  const [newUsername, setNewUsername] = useState(username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) return toast.error(t("settings.currentPasswordRequired"));
    if (newPassword && newPassword !== confirm) return toast.error(t("settings.newPasswordMismatch"));
    if (newPassword && newPassword.length < 8) return toast.error(t("settings.newPasswordTooShort"));
    if (newUsername.trim().length < 3) return toast.error(t("settings.usernameTooShort"));

    setLoading(true);
    try {
      await changeCredentials({
        current_password: currentPassword,
        new_username: newUsername.trim() !== username ? newUsername.trim() : undefined,
        new_password: newPassword || undefined,
      });
      toast.success(newPassword ? t("settings.savedRelogin") : t("settings.saved"));
      setCurrentPassword(""); setNewPassword(""); setConfirm("");
    } catch (err) {
      toast.error((err as Error).message || t("settings.updateFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-xl py-8">
        <h1 className="mb-6 text-2xl font-bold">{t("settings.title")}</h1>
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.credCardTitle")}</CardTitle>
            <CardDescription>{t("settings.credCardDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("auth.username")}</Label>
                <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("settings.currentPassword")}</Label>
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <div className="space-y-2">
                <Label>{t("settings.newPasswordOptional")}</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              </div>
              {newPassword && (
                <div className="space-y-2">
                  <Label>{t("settings.confirmNewPassword")}</Label>
                  <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                </div>
              )}
              <Button type="submit" disabled={loading}>{loading ? t("settings.saving") : t("common.save")}</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("settings.statusTitle")}</CardTitle>
            <CardDescription>{t("settings.statusDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <Label htmlFor="public-status" className="cursor-pointer">{t("settings.allowPublic")}</Label>
              <Switch
                id="public-status"
                checked={publicStatusPage}
                disabled={savingPublic}
                onCheckedChange={async (v) => {
                  setSavingPublic(true);
                  try {
                    await updateSettings({ public_status_page: v });
                    toast.success(t("settings.saved"));
                  } catch (err) {
                    toast.error((err as Error).message || t("settings.updateFailed"));
                  } finally {
                    setSavingPublic(false);
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
