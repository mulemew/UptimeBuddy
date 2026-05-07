import { useState } from "react";
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
  const [savingPublic, setSavingPublic] = useState(false);
  const [newUsername, setNewUsername] = useState(username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) return toast.error("请输入当前密码");
    if (newPassword && newPassword !== confirm) return toast.error("两次新密码不一致");
    if (newPassword && newPassword.length < 8) return toast.error("新密码至少 8 位");
    if (newUsername.trim().length < 3) return toast.error("用户名至少 3 位");

    setLoading(true);
    try {
      await changeCredentials({
        current_password: currentPassword,
        new_username: newUsername.trim() !== username ? newUsername.trim() : undefined,
        new_password: newPassword || undefined,
      });
      toast.success(newPassword ? "已更新，请重新登录" : "已更新");
      setCurrentPassword(""); setNewPassword(""); setConfirm("");
    } catch (err) {
      toast.error((err as Error).message || "更新失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-xl py-8">
        <h1 className="mb-6 text-2xl font-bold">账号设置</h1>
        <Card>
          <CardHeader>
            <CardTitle>修改用户名 / 密码</CardTitle>
            <CardDescription>修改密码后将退出当前登录，需要重新登录。</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>用户名</Label>
                <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>当前密码</Label>
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <div className="space-y-2">
                <Label>新密码（留空则不修改）</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              </div>
              {newPassword && (
                <div className="space-y-2">
                  <Label>确认新密码</Label>
                  <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                </div>
              )}
              <Button type="submit" disabled={loading}>{loading ? "保存中…" : "保存"}</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
