// Data hooks for the efficiency dimension. useUserNameMap resolves raw
// user_id values (UUID-style in production, "u-2xx" in mock) to the display
// string "真名(工号)" via the /v2/user-names roster. The hook mirrors the
// source: a stable nameMap (Record<user_id, display>) memoized on data, and a
// stable resolveName callback that falls back to the raw id when no roster
// entry exists (so unknown ids still render something legible).
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "../hooks";
import { userNamesOptions } from "./queries";

export function useUserNameMap() {
  const wsId = useWorkspaceId();
  const q = useQuery(userNamesOptions(wsId));
  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of q.data ?? []) {
      if (u.user_id && u.real_name && !m[u.user_id]) {
        m[u.user_id] = u.emp_no ? `${u.real_name}(${u.emp_no})` : u.real_name;
      }
    }
    return m;
  }, [q.data]);
  const resolveName = useCallback(
    (userId?: string): string => {
      if (!userId) return "-";
      return nameMap[userId] ?? userId;
    },
    [nameMap],
  );
  return { resolveName, isLoading: q.isLoading };
}
