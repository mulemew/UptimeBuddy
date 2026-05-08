import { zhCN, enUS } from "date-fns/locale";
import i18n from "@/i18n";

export function dfLocale() {
  const lang = (i18n.resolvedLanguage || i18n.language || "en").toLowerCase();
  return lang.startsWith("zh") ? zhCN : enUS;
}
