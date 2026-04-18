import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-lg border border-border bg-card shadow-xl shadow-black/5">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-destructive/15 animate-pulse" />
              <AlertCircle className="relative h-16 w-16 text-destructive" />
            </div>
          </div>

          <h1 className="mb-2 text-4xl font-bold text-foreground">404</h1>

          <h2 className="mb-4 text-xl font-semibold text-foreground">
            {t("notFound.title")}
          </h2>

          <p className="mb-8 leading-relaxed text-muted-foreground">
            {t("notFound.description")}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={handleGoHome} className="px-6 py-2.5 rounded-lg">
              <Home className="w-4 h-4 mr-2" />
              {t("notFound.goHome")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
