import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { Languages, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("nav.toggleTheme")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

export function LangToggle() {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || "en").startsWith("zh") ? "zh" : "en";
  const next = current === "zh" ? "en" : "zh";
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t("nav.toggleLang")}
      onClick={() => i18n.changeLanguage(next)}
      className="gap-1 px-2"
    >
      <Languages className="h-4 w-4" />
      <span className="text-xs font-medium">{current === "zh" ? "中" : "EN"}</span>
    </Button>
  );
}
