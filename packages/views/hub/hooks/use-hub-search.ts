import { useRef, useCallback } from "react"
import { api } from "@multica/core/api"
import type { CapabilityItem } from "@multica/core/types"

export function useHubSemanticSearch() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(
    (query: string): Promise<CapabilityItem[]> => {
      return new Promise((resolve, reject) => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(async () => {
          try {
            const trimmed = query.trim()
            if (!trimmed) {
              resolve([])
              return
            }
            const items = await api.hubSemanticSearch({ query: trimmed })
            resolve(items ?? [])
          } catch (err) {
            reject(err)
          }
        }, 300)
      })
    },
    [],
  )

  return { search }
}
