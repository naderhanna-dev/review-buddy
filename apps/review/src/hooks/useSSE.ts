import { useEffect, useRef } from "react";

export function useSSE(
  url: string,
  onEvent: (event: unknown) => void,
  enabled = true,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;
    let retryDelay = 1000;

    function connect() {
      es = new EventSource(url);

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current(data);
        } catch {}
      };

      es.onopen = () => {
        retryDelay = 1000;
      };

      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10000);
      };
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, [url, enabled]);
}
