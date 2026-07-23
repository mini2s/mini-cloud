import { useState, useCallback } from "react"

const STORAGE_KEY = "hub:pageSize"
const DEFAULT_PAGE_SIZE = 15

function loadPageSize(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const n = Number(stored)
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_PAGE_SIZE
}

function savePageSize(size: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(size))
  } catch {
    // localStorage unavailable
  }
}

interface HubPagination {
  page: number
  pageSize: number
  setPage: (page: number) => void
  setPageSize: (size: number) => void
}

export function useHubPagination(): HubPagination {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(loadPageSize)

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size)
    savePageSize(size)
    setPage(1)
  }, [])

  return { page, pageSize, setPage, setPageSize }
}
