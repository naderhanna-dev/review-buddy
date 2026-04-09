import { useEffect } from "react";
import { useStore } from "../store";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't capture when typing in inputs
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const state = useStore.getState();

      switch (e.key) {
        case "j": {
          // Next file
          e.preventDefault();
          const next = Math.min(state.activeFileIndex + 1, state.files.length - 1);
          state.setActiveFile(next);
          break;
        }
        case "k": {
          // Previous file
          e.preventDefault();
          const prev = Math.max(state.activeFileIndex - 1, 0);
          state.setActiveFile(prev);
          break;
        }
        case "1": {
          e.preventDefault();
          state.setRightTab("comments");
          break;
        }
        case "2": {
          e.preventDefault();
          state.setRightTab("analysis");
          break;
        }
        case "3": {
          e.preventDefault();
          state.setRightTab("chat");
          break;
        }
        case "s": {
          e.preventDefault();
          const current = state.diffViewMode;
          state.setDiffViewMode(current === "unified" ? "split" : "unified");
          break;
        }
        case "?": {
          e.preventDefault();
          useStore.setState((s) => ({ showShortcuts: !s.showShortcuts }));
          break;
        }
        case "Escape": {
          if (state.showShortcuts) {
            e.preventDefault();
            useStore.setState({ showShortcuts: false });
          }
          break;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
