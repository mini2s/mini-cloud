"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getApi } from "../api";
import { useAuthStore } from "../auth";
import { isEmbeddedInCostrict } from "./costrict-bridge";

interface CostrictIdentityMessage {
  type?: unknown;
  casdoorUniversalId?: unknown;
}

function parseCostrictIdentityMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const message = data as CostrictIdentityMessage;
  if (message.type !== "costrict:identity") return null;
  if (typeof message.casdoorUniversalId !== "string") return null;
  const universalID = message.casdoorUniversalId.trim();
  return universalID || null;
}

export function CostrictIdentityBridge() {
  const queryClient = useQueryClient();
  const handledUniversalIDs = useRef(new Set<string>());

  useEffect(() => {
    if (!isEmbeddedInCostrict()) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const universalID = parseCostrictIdentityMessage(event.data);
      if (!universalID) return;
      if (handledUniversalIDs.current.has(universalID)) return;
      handledUniversalIDs.current.add(universalID);

      void getApi()
        .associateDeptIdentity({ casdoor_universal_id: universalID })
        .then(() => useAuthStore.getState().refreshMe())
        .catch((error) => {
          console.warn("[costrict-identity] association failed", error);
        })
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
        });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [queryClient]);

  return null;
}
