import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AuthScreen } from "@/pages/Auth";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import MonitorNew from "./pages/MonitorNew.tsx";
import MonitorDetail from "./pages/MonitorDetail.tsx";
import StatusPage from "./pages/StatusPage.tsx";
import Settings from "./pages/Settings.tsx";

const queryClient = new QueryClient();

function Gate() {
  const { loading, authenticated } = useAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">加载中…</div>;
  }
  if (!authenticated) return <AuthScreen />;
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/monitors/new" element={<MonitorNew />} />
      <Route path="/monitors/:id" element={<MonitorDetail />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Status page is public */}
            <Route path="/status" element={<StatusPage />} />
            <Route path="*" element={<Gate />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
