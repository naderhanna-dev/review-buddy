import { useEffect, useRef } from "react";
import {
  SmartRefreshController,
  FALLBACK_REFRESH_MS,
  NOTIFICATION_FALLBACK_MS,
  REFRESH_FOCUS_COOLDOWN_MS,
} from "@reviewradar/core";

export function useRefreshTick({
  org,
  token,
  isLoadingRef,
  onRefresh,
}: {
  org: string;
  token: string;
  isLoadingRef: React.MutableRefObject<boolean>;
  onRefresh: () => void;
}): void {
  const lastVisibilityRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!token || !org) {
      return;
    }

    const controller = new SmartRefreshController({
      token,
      org,
      onRefresh: () => {
        if (document.visibilityState !== "visible" || isLoadingRef.current) {
          return;
        }
        onRefresh();
      },
      fallbackIntervalMs: FALLBACK_REFRESH_MS,
      degradedIntervalMs: NOTIFICATION_FALLBACK_MS,
    });

    controller.start();

    return () => {
      controller.stop();
    };
  }, [isLoadingRef, onRefresh, org, token]);

  useEffect(() => {
    if (!token || !org) {
      return;
    }

    function triggerFocusRefresh(): void {
      if (document.visibilityState !== "visible" || isLoadingRef.current) {
        return;
      }

      const now = Date.now();
      if (now - lastVisibilityRefreshAtRef.current < REFRESH_FOCUS_COOLDOWN_MS) {
        return;
      }

      lastVisibilityRefreshAtRef.current = now;
      onRefresh();
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        triggerFocusRefresh();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", triggerFocusRefresh);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", triggerFocusRefresh);
    };
  }, [isLoadingRef, onRefresh, org, token]);
}
