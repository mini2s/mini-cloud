"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  isEmbeddedInCostrict,
  parseParentRouteCommand,
  postLocationToParent,
} from "@multica/core/platform/costrict-bridge";

/**
 * When multica runs embedded inside the costrict-web platform, keep the parent's
 * URL in sync with the page the user is on:
 *  - report the current pathname to the parent on mount and on every route
 *    change (the parent mirrors it in its own URL);
 *  - honour inbound `multica:route` commands from the parent (browser
 *    back/forward/manual URL edits) by navigating here without a full reload.
 * No-op when standalone. Mounted once from the root layout.
 */
export function CostrictEmbedSync() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isEmbeddedInCostrict()) return;
    if (pathname) postLocationToParent(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!isEmbeddedInCostrict()) return;
    const onMessage = (event: MessageEvent) => {
      const cmd = parseParentRouteCommand(event);
      if (cmd && cmd.path !== pathname) router.push(cmd.path);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, pathname]);

  return null;
}
