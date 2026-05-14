import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type GuidedTourStep = {
  id: string;
  selector: string;
  title: string;
  body: string;
  placement?: "top" | "right" | "bottom" | "left";
};

type GuidedTourProps = {
  storageKey: string;
  steps: GuidedTourStep[];
  autoStart?: boolean;
  allowUnresolvedSteps?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onStepChange?: (step: GuidedTourStep, index: number) => void;
  onComplete?: () => void;
  className?: string;
  nextLabel?: string;
  finishLabel?: string;
  skipLabel?: string;
  pauseLabel?: string;
};

type TargetBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const GUIDED_TOUR_OPEN_EVENT = "oneceo-guided-tour-open";

function readCompleted(storageKey: string) {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(storageKey) === "completed";
}

function markCompleted(storageKey: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, "completed");
}

function resolveTarget(selector: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(selector),
  );
  return (
    candidates.find((item) => {
      const rect = item.getBoundingClientRect();
      const style = window.getComputedStyle(item);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    }) || null
  );
}

export function isGuidedTourInteraction(event: Event) {
  const target = event.target;
  return (
    target instanceof Element &&
    Boolean(target.closest("[data-guided-tour-root]"))
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function GuidedTour({
  storageKey,
  steps,
  autoStart = false,
  allowUnresolvedSteps = false,
  open,
  onOpenChange,
  onStepChange,
  onComplete,
  className,
  nextLabel = "下一步",
  finishLabel = "完成",
  skipLabel = "跳过",
  pauseLabel = "稍后再看",
}: GuidedTourProps) {
  const tourInstanceId = useId();
  const controlled = typeof open === "boolean";
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);
  const isOpen = controlled ? Boolean(open) : internalOpen;
  const activeStep = steps[activeIndex] || null;

  const setOpenState = useCallback(
    (nextOpen: boolean) => {
      if (!controlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlled, onOpenChange],
  );

  useEffect(() => {
    const handleOtherTourOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (!detail?.id || detail.id === tourInstanceId) return;
      setOpenState(false);
    };
    window.addEventListener(GUIDED_TOUR_OPEN_EVENT, handleOtherTourOpen);
    return () => {
      window.removeEventListener(GUIDED_TOUR_OPEN_EVENT, handleOtherTourOpen);
    };
  }, [setOpenState, tourInstanceId]);

  useEffect(() => {
    if (!isOpen) return;
    window.dispatchEvent(
      new CustomEvent(GUIDED_TOUR_OPEN_EVENT, {
        detail: { id: tourInstanceId },
      }),
    );
  }, [isOpen, tourInstanceId]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveIndex(0);
  }, [isOpen, steps]);

  useEffect(() => {
    if (!isOpen || !activeStep) return;
    onStepChange?.(activeStep, activeIndex);
  }, [activeIndex, activeStep, isOpen, onStepChange]);

  const updateTarget = useCallback(() => {
    if (!isOpen || !activeStep) return;
    const target = resolveTarget(activeStep.selector);
    if (!target) {
      setTargetBox(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setTargetBox({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, [activeStep, isOpen]);

  useEffect(() => {
    if (!isOpen || !activeStep) return;
    const target = resolveTarget(activeStep.selector);
    target?.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
    const timer = window.setTimeout(updateTarget, 120);
    return () => window.clearTimeout(timer);
  }, [activeIndex, activeStep, isOpen, updateTarget]);

  useEffect(() => {
    if (!autoStart || controlled || readCompleted(storageKey)) return;
    const timer = window.setTimeout(() => {
      const firstAvailable = steps.findIndex((step) =>
        resolveTarget(step.selector),
      );
      if (firstAvailable < 0) return;
      setActiveIndex(firstAvailable);
      setInternalOpen(true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [autoStart, controlled, steps, storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [isOpen, updateTarget]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenState(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, setOpenState]);

  const complete = useCallback(() => {
    markCompleted(storageKey);
    setOpenState(false);
    onComplete?.();
  }, [onComplete, setOpenState, storageKey]);

  const skip = useCallback(() => {
    markCompleted(storageKey);
    setOpenState(false);
    onComplete?.();
  }, [onComplete, setOpenState, storageKey]);

  const goNext = useCallback(() => {
    const nextIndex = activeIndex + 1;
    const nextAvailable = steps.findIndex(
      (step, index) => index >= nextIndex && resolveTarget(step.selector),
    );
    if (nextAvailable < 0) {
      if (allowUnresolvedSteps && nextIndex < steps.length) {
        setActiveIndex(nextIndex);
        return;
      }
      complete();
      return;
    }
    setActiveIndex(nextAvailable);
  }, [activeIndex, allowUnresolvedSteps, complete, steps]);

  const spotlightStyle = useMemo(() => {
    if (!targetBox) return undefined;
    const padding = 8;
    return {
      top: `${targetBox.top - padding}px`,
      left: `${targetBox.left - padding}px`,
      width: `${targetBox.width + padding * 2}px`,
      height: `${targetBox.height + padding * 2}px`,
    };
  }, [targetBox]);

  const cardStyle = useMemo(() => {
    if (!targetBox) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };
    }
    const gap = 16;
    const cardWidth = Math.min(340, window.innerWidth - 32);
    const placement = activeStep?.placement || "bottom";
    let left = targetBox.left + targetBox.width / 2 - cardWidth / 2;
    let top = targetBox.top + targetBox.height + gap;

    if (placement === "top") {
      top = targetBox.top - 210;
    }
    if (placement === "left") {
      left = targetBox.left - cardWidth - gap;
      top = targetBox.top + targetBox.height / 2 - 92;
    }
    if (placement === "right") {
      left = targetBox.left + targetBox.width + gap;
      top = targetBox.top + targetBox.height / 2 - 92;
    }

    return {
      width: `${cardWidth}px`,
      left: `${clamp(left, 16, window.innerWidth - cardWidth - 16)}px`,
      top: `${clamp(top, 16, window.innerHeight - 220)}px`,
    };
  }, [activeStep?.placement, targetBox]);

  if (!isOpen || !activeStep || !steps.length) return null;

  const isLast = activeIndex >= steps.length - 1;

  const content = (
    <div
      data-guided-tour-root
      className={cn("fixed inset-0 z-[80] pointer-events-none", className)}
    >
      <div className="absolute inset-0 bg-[#1f2328]/50" />
      {spotlightStyle ? (
        <div
          className="absolute rounded-[14px] border border-blue-500 bg-transparent shadow-[0_0_0_9999px_rgba(31,35,40,0.50),0_0_0_4px_rgba(9,105,218,0.18),0_14px_36px_rgba(9,105,218,0.20)]"
          style={spotlightStyle}
        />
      ) : null}
      <section
        className="pointer-events-auto absolute rounded-xl border border-border bg-background p-4 text-foreground shadow-[0_28px_80px_rgba(31,35,40,0.18),0_4px_14px_rgba(31,35,40,0.10)]"
        style={cardStyle}
        aria-live="polite"
      >
        <div className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
          {activeIndex + 1} / {steps.length}
        </div>
        <h2 className="text-[14px] font-extrabold leading-5">
          {activeStep.title}
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          {activeStep.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={skip}
          >
            {skipLabel}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setOpenState(false)}
            >
              {pauseLabel}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={isLast ? complete : goNext}
            >
              {isLast ? finishLabel : nextLabel}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}

export function resetGuidedTour(storageKey: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey);
}
