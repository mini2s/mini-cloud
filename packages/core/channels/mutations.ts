import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ChannelConfig, ChannelUpdateInput } from "../types/channels";
import { channelKeys } from "./queries";

// ── Mutations ────────────────────────────────────────────────────────────
// All mutations invalidate the channel list so the UI re-fetches after a
// change. Optimistic updates (the source page does them for toggle/delete) are
// left to the view layer via setQueryData, since they need toast-on-error
// rollback that is tightly coupled to the component.

/** Toggle / rename / reconfigure a channel. */
export function useUpdateChannelMutation() {
  const qc = useQueryClient();
  return useMutation<ChannelConfig, Error, { id: string; input: ChannelUpdateInput }>({
    mutationFn: ({ id, input }) => api.channelUpdate(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list() });
    },
  });
}

/** Delete a channel. */
export function useDeleteChannelMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.channelDelete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list() });
    },
  });
}

/** Send a test notification through a channel. */
export function useTestChannelMutation() {
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.channelTest(id),
  });
}
