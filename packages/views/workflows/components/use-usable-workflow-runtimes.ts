"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { AgentRuntime } from "@multica/core/types";
import { myRuntimePermissionOptions } from "@multica/core/runtimes/queries";

export function useUsableWorkflowRuntimes(runtimes: AgentRuntime[]) {
  const privateRuntimes = useMemo(
    () => runtimes.filter((runtime) => runtime.visibility !== "public"),
    [runtimes],
  );
  const permissionQueries = useQueries({
    queries: privateRuntimes.map((runtime) => myRuntimePermissionOptions(runtime.id)),
  });

  const usableRuntimes = useMemo(() => {
    const controllablePrivateRuntimeIds = new Set(
      privateRuntimes
        .filter((_, index) => permissionQueries[index]?.data?.can_control)
        .map((runtime) => runtime.id),
    );
    return runtimes.filter(
      (runtime) =>
        runtime.provider === "csc" &&
        (runtime.visibility === "public" || controllablePrivateRuntimeIds.has(runtime.id)),
    );
  }, [permissionQueries, privateRuntimes, runtimes]);

  return {
    runtimes: usableRuntimes,
    isLoading: permissionQueries.some((query) => query.isLoading),
  };
}
