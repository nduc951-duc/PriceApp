import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useModalFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => element.getClientRects().length > 0);

    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    (focusable()[0] ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === controls[0] || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) (focusable()[0] ?? dialog).focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      if (previousFocus?.isConnected) {
        queueMicrotask(() => {
          if (previousFocus.isConnected) previousFocus.focus();
        });
      }
    };
  }, [open]);

  return dialogRef;
}
