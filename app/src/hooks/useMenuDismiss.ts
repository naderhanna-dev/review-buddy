import { useEffect, useState } from "react";
import type { SectionKey } from "../types";

export type MenuDismissState = {
  openRowMenuKey: string | null;
  openSectionMenuKey: SectionKey | null;
  handleToggleRowMenu: (menuKey: string) => void;
  handleCloseRowMenu: () => void;
  handleToggleSectionMenu: (sectionKey: SectionKey) => void;
  handleCloseSectionMenu: () => void;
};

export function useMenuDismiss(): MenuDismissState {
  const [openRowMenuKey, setOpenRowMenuKey] = useState<string | null>(null);
  const [openSectionMenuKey, setOpenSectionMenuKey] = useState<SectionKey | null>(null);

  useEffect(() => {
    function handleGlobalClick(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (!target.closest(".row-menu") && !target.closest(".row-menu-toggle")) {
        setOpenRowMenuKey(null);
      }

      if (
        !target.closest(".section-menu") &&
        !target.closest(".section-menu-toggle")
      ) {
        setOpenSectionMenuKey(null);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpenRowMenuKey(null);
        setOpenSectionMenuKey(null);
      }
    }

    document.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function handleToggleRowMenu(menuKey: string): void {
    setOpenRowMenuKey((current) => (current === menuKey ? null : menuKey));
  }

  function handleCloseRowMenu(): void {
    setOpenRowMenuKey(null);
  }

  function handleToggleSectionMenu(sectionKey: SectionKey): void {
    setOpenSectionMenuKey((current) =>
      current === sectionKey ? null : sectionKey,
    );
  }

  function handleCloseSectionMenu(): void {
    setOpenSectionMenuKey(null);
  }

  return {
    openRowMenuKey,
    openSectionMenuKey,
    handleToggleRowMenu,
    handleCloseRowMenu,
    handleToggleSectionMenu,
    handleCloseSectionMenu,
  };
}
