import { Link } from "react-router-dom";
import { Activity } from "lucide-react";

export function AppHeader() {
  return (
    <header className="border-b">
      <div className="container flex h-14 items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Activity className="h-5 w-5 text-primary" />
          <span>Uptime</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/" className="text-muted-foreground hover:text-foreground">仪表盘</Link>
          <Link to="/status" className="text-muted-foreground hover:text-foreground">状态页</Link>
        </nav>
      </div>
    </header>
  );
}
