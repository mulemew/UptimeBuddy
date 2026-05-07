import { Link } from "react-router-dom";
import { Activity, LogOut, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const { authenticated, logout } = useAuth();
  return (
    <header className="border-b">
      <div className="container flex h-14 items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Activity className="h-5 w-5 text-primary" />
          <span>Uptime</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/" className="px-3 py-1.5 text-muted-foreground hover:text-foreground">仪表盘</Link>
          <Link to="/status" className="px-3 py-1.5 text-muted-foreground hover:text-foreground">状态页</Link>
          {authenticated && (
            <>
              <Link to="/settings">
                <Button variant="ghost" size="icon" aria-label="账号设置"><SettingsIcon className="h-4 w-4" /></Button>
              </Link>
              <Button variant="ghost" size="icon" aria-label="退出登录" onClick={() => logout()}>
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
