import { useCallback, useEffect, useRef } from "react";

const focusSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusable(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(focusSelector)].filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
}

/** Gives every modal the same initial focus, keyboard boundary and return focus. */
export function useDialogManager(onEscape: (label: string) => void): (dialog: HTMLElement, trigger: HTMLElement) => void {
  const onEscapeRef = useRef(onEscape);
  const triggersRef = useRef(new WeakMap<HTMLElement, HTMLElement | null>());
  onEscapeRef.current = onEscape;
  useEffect(() => {
    let current: HTMLElement | null = null;
    const triggers = triggersRef.current;
    let restore: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
    const clearInert = () => {
      for (const { element, inert, ariaHidden } of restore) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      restore = [];
    };
    const reconcile = () => {
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')];
      const next = dialogs.at(-1) ?? null;
      if (next === current) return;
      const previous = current;
      clearInert();
      current = next;
      if (next) {
        if (!triggers.has(next)) triggers.set(next, document.activeElement instanceof HTMLElement ? document.activeElement : null);
        let branch: HTMLElement = next;
        while (branch.parentElement && branch.parentElement !== document.body) {
          for (const sibling of branch.parentElement.children) {
            if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
            restore.push({ element: sibling, inert: sibling.inert, ariaHidden: sibling.getAttribute("aria-hidden") });
            sibling.inert = true;
            sibling.setAttribute("aria-hidden", "true");
          }
          branch = branch.parentElement;
        }
        const previousTrigger = previous ? triggers.get(previous) : null;
        if (previousTrigger?.isConnected && next.contains(previousTrigger)) previousTrigger.focus();
        if (!next.contains(document.activeElement)) {
          const target = next.querySelector<HTMLElement>("[data-dialog-initial-focus], [autofocus]") ?? focusable(next)[0] ?? next;
          if (target === next) next.tabIndex = -1;
          target.focus();
        }
      } else if (previous) {
        const trigger = triggers.get(previous);
        if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onEscapeRef.current(current.getAttribute("aria-label") ?? "");
      } else if (event.key === "Tab") {
        const elements = focusable(current);
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) { event.preventDefault(); current.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !current.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !current.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (current && event.target instanceof Node && !current.contains(event.target)) (focusable(current)[0] ?? current).focus();
    };
    const observer = new MutationObserver(reconcile);
    observer.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocus);
    reconcile();
    return () => { observer.disconnect(); clearInert(); document.removeEventListener("keydown", onKeyDown, true); document.removeEventListener("focusin", onFocus); };
  }, []);
  return useCallback((dialog, trigger) => { triggersRef.current.set(dialog, trigger); }, []);
}
