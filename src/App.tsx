import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthScreen } from "@/pages/Auth";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import MonitorNew from "./pages/MonitorNew.tsx";
import MonitorDetail from "./pages/MonitorDetail.tsx";
import StatusPage from "./pages/StatusPage.tsx";
import Settings from "./pages/Settings.tsx";
import Maintenance from "./pages/Maintenance.tsx";

const queryClient = new QueryClient();

function Gate() {
  const { loading, authenticated } = useAuth();
  const { t } = useTranslation();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">{t("common.loading")}</div>;
  }
  if (!authenticated) return <AuthScreen />;
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/monitors/new" element={<MonitorNew />} />
      <Route path="/monitors/:id" element={<MonitorDetail />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/maintenance" element={<Maintenance />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function StatusGate() {
  const { loading, authenticated, publicStatusPage } = useAuth();
  const { t } = useTranslation();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">{t("common.loading")}</div>;
  }
  if (!publicStatusPage && !authenticated) return <AuthScreen />;
  return <StatusPage />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/status" element={<StatusGate />} />
              <Route path="*" element={<Gate />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
