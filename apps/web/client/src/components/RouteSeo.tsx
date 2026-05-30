import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { usePageSeo } from "@/lib/page-seo";

export function RouteSeo() {
  const [location] = useLocation();
  const { i18n } = useTranslation();

  usePageSeo({
    language: i18n.resolvedLanguage || i18n.language || "zh",
    pathname: location || "/",
  });

  return null;
}
