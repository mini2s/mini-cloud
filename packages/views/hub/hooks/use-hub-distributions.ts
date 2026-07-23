import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@multica/core/api"
import type {
  DistributionResult,
  HubDistributionCreateParams,
  HubBehaviorLogBody,
  CapabilityItem,
} from "@multica/core/types"

export function useHubMySentDistributions() {
  const { data, isLoading } = useQuery({
    queryKey: ["hub", "distributions", "sent"],
    queryFn: () => api.hubMySentDistributions(),
  })
  return { distributions: data ?? [], isLoading }
}

export function useHubMyReceivedDistributions() {
  const { data, isLoading } = useQuery({
    queryKey: ["hub", "distributions", "received"],
    queryFn: () => api.hubMyReceivedDistributions(),
  })
  return { receipts: data ?? [], isLoading }
}

export function useHubDistributeMutation() {
  const qc = useQueryClient()
  return useMutation<DistributionResult, Error, { id: string; data: HubDistributionCreateParams }>({
    mutationFn: ({ id, data }) => api.hubDistributeItem(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "distributions"] })
    },
  })
}

export function useHubRevokeDistributionMutation() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.hubRevokeDistribution(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "distributions"] })
    },
  })
}

export function useHubDismissDistributionMutation() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.hubDismissDistribution(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "distributions"] })
    },
  })
}

export function useHubMarkDistributionReadMutation() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.hubMarkDistributionRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "distributions"] })
    },
  })
}

export function useHubForkDistributionMutation() {
  const qc = useQueryClient()
  return useMutation<CapabilityItem, Error, string>({
    mutationFn: (id) => api.hubForkDistribution(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "distributions"] })
      qc.invalidateQueries({ queryKey: ["hub", "items"] })
    },
  })
}

export function useHubDistributionAuthority() {
  const { data, isLoading } = useQuery({
    queryKey: ["hub", "distributions", "authority"],
    queryFn: () => api.hubMyDistributionAuthority(),
    staleTime: 10 * 60 * 1000,
  })
  return { authority: data, isLoading }
}

export function useHubLogBehaviorMutation() {
  return useMutation<void, Error, { id: string; body: HubBehaviorLogBody }>({
    mutationFn: ({ id, body }) => api.hubLogBehavior(id, body),
  })
}
