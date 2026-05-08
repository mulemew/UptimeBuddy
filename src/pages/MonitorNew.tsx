import { useTranslation } from "react-i18next";
import { AppHeader } from "@/components/AppHeader";
import { MonitorForm } from "@/components/MonitorForm";

export default function MonitorNew() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-2xl py-8">
        <h1 className="mb-6 text-2xl font-bold">{t("monitorForm.addTitle")}</h1>
        <MonitorForm />
      </main>
    </div>
  );
}
