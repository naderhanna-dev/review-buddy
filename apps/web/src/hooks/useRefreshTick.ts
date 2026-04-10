import { useEffect, useRef } from "react";
import {
  MultiOrgRefreshController,
  rateLimitTracker,
  FALLBACK_REFRESH_MS,
  NOTIFICATION_FALLBACK_MS,
  REFRESH_FOCUS_COOLDOWN_MS,
} from "@reviewradar/core";
import type { OrgConfig } from "@reviewradar/core";

export function useRefreshTick({
  orgConfigs,
  isLoadingRef,
  onRefresh,
}: {
  orgConfigs: OrgConfig[];
  isLoadingRef: React.MutableRefObject<boolean>;
  onRefresh: () => void;
}): void {
  const lastVisibilityRefreshAtRef = useRef(0);

  // Stable serialized key for detecting orgConfigs changes
  const orgConfigsKey = JSON.stringify(orgConfigs.map((c) => `${c.id}:${c.org}:${c.token}`));

  useEffect(() => {
    if (orgConfigs.length === 0) {
      return;
    }

    const controller = new MultiOrgRefreshController(
      orgConfigs,
      () => {
        if (document.visibilityState !== "visible" || isLoadingRef.current) {
          return;
        }
        onRefresh();
      },
      {
        fallbackIntervalMs: FALLBACK_REFRESH_MS,
        degradedIntervalMs: NOTIFICATION_FALLBACK_MS,
      },
    );

    controller.start();

    return () => {
      controller.stop();
    };
  }, [isLoadingRef, onRefresh, orgConfigsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (orgConfigs.length === 0) {
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

      const anyTokenLimited = orgConfigs.some((c) => rateLimitTracker.isRateLimited(c.token));
      if (anyTokenLimited) {
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
  }, [isLoadingRef, onRefresh, orgConfigsKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
