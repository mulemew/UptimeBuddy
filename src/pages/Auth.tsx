import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { toast } from "sonner";

export function AuthScreen() {
  const { initialized, setup, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const isSetup = !initialized;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim().length < 3) return toast.error("用户名长度至少 3 位");
    if (password.length < 8) return toast.error("密码长度至少 8 位");
    if (isSetup && password !== confirm) return toast.error("两次输入的密码不一致");
    setLoading(true);
    try {
      if (isSetup) {
        await setup(username.trim(), password);
        toast.success("初始化完成");
      } else {
        await login(username.trim(), password);
        toast.success("登录成功");
      }
    } catch (err) {
      toast.error((err as Error).message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <CardTitle>{isSetup ? "初始化管理员" : "管理员登录"}</CardTitle>
          <CardDescription>
            {isSetup ? "首次部署，请设置管理员账号" : "请输入管理员账号继续"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u">用户名</Label>
              <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p">密码</Label>
              <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSetup ? "new-password" : "current-password"} required />
            </div>
            {isSetup && (
              <div className="space-y-2">
                <Label htmlFor="c">确认密码</Label>
                <Input id="c" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "处理中…" : isSetup ? "完成初始化" : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
