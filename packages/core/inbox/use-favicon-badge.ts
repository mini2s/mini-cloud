import { useEffect, useRef } from "react";
import { useInboxUnreadCount } from "./queries";

/**
 * Draws a red dot on the favicon when there are unread inbox items. Uses
 * canvas API to load the existing favicon, draw a red circle in the top-right
 * corner, and set the result as a data URL on <link rel="icon">.
 *
 * Restores the original favicon href when count drops to zero. No-op during
 * SSR (typeof document guard).
 */
export function useFaviconBadge(wsId: string | null | undefined): void {
  const unreadCount = useInboxUnreadCount(wsId);
  const originalHrefRef = useRef<string | null>(null);
  const wasBadgedRef = useRef(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const link =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
      document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
    if (!link) return;

    // Store original href on first run (never overwrite — it may already
    // be a data URL from a previous badge application).
    if (originalHrefRef.current === null) {
      originalHrefRef.current = link.href;
    }

    if (unreadCount === 0 && wasBadgedRef.current) {
      link.href = originalHrefRef.current;
      wasBadgedRef.current = false;
      return;
    }

    if (unreadCount === 0) return;

    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.naturalWidth || 32, 32);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, size, size);

      // Red dot in top-right corner
      const dotX = size * 0.85;
      const dotY = size * 0.15;
      const dotRadius = size * 0.18;

      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();

      // White ring for contrast against dark backgrounds
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, size * 0.04);
      ctx.stroke();

      link.href = canvas.toDataURL();
      wasBadgedRef.current = true;
    };
    // Load the original (unbadged) favicon so we always draw on the clean
    // base. If the current link already points to a data URL from a previous
    // badge, we use the stored original instead.
    img.src = originalHrefRef.current ?? link.href;
  }, [unreadCount]);

  // Restore original favicon on unmount
  useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      if (!wasBadgedRef.current) return;
      const link =
        document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
        document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
      if (link && originalHrefRef.current) {
        link.href = originalHrefRef.current;
      }
    };
  }, []);
}
