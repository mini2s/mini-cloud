// Enterprise ("大客户") branding for hub items.
//
// DATA SOURCE: on first load we fetch `GET /api/enterprise-customers` (returns
// `{ customers: { ids, name, logo }[] }`, readable by any signed-in user). The
// fetched list replaces the in-memory roster; if the fetch fails or returns
// nothing (e.g. demo mode) we keep the built-in DEMO_FALLBACK roster below.
//
// HOW TO ADD A 大客户 (demo fallback only — real wiring comes from the backend):
//   1. Add (or reuse) a brand logo data URI in `./enterprise-logos.ts`.
//   2. Append one `EnterpriseConfig` entry to `DEMO_FALLBACK` below:
//        - `name`        display name beside the logo
//        - `logo`        logo data URI
//        - `ids`         REAL backend path: the enterprise's stable uploader
//                        account 唯一 ID(s).

import { api } from "@multica/core/api"
import type { EnterpriseCustomer } from "@multica/core/types"
import { CMB_LOGO, ICBC_LOGO, CCB_LOGO } from "./enterprise-logos"

export interface EnterpriseInfo {
  /** Display name shown beside the logo (e.g. 招商银行). */
  name: string
  /** Logo as a base64 data URI to avoid cross-origin canvas tainting when extracting colors. */
  logo: string
}

/** One configurable enterprise customer. */
export interface EnterpriseConfig extends EnterpriseInfo {
  /**
   * Real backend key: the enterprise's stable uploader account 唯一 ID(s). An
   * item is branded when `CapabilityItem.createdBy` matches ANY id here.
   */
  ids?: string[]
  /**
   * Demo fallback key: bind by the item's (stable) display name(s), since mock
   * data authors items with shared placeholder users and so `createdBy` is not
   * enterprise-unique. Real wiring relies on `ids` from the backend.
   */
  matchNames?: string[]
}

/**
 * Built-in roster used until (and unless) the backend responds: demo mode has no
 * `/api/enterprise-customers` endpoint, so these keep 招行/工行/建行 branded.
 */
const DEMO_FALLBACK: EnterpriseConfig[] = [
  { name: "招商银行", logo: CMB_LOGO, matchNames: ["Code Reviewer"] },
  { name: "工商银行", logo: ICBC_LOGO, matchNames: ["Security Scanner"] },
  { name: "建设银行", logo: CCB_LOGO, matchNames: ["Database MCP"] },
]

// Current roster (single source of truth). Initialized to DEMO_FALLBACK so the
// very first render — and demo mode forever — has branding immediately; replaced
// by backend data once it loads.
let customers: EnterpriseConfig[] = DEMO_FALLBACK

function toEnterpriseInfo(config: EnterpriseConfig): EnterpriseInfo {
  return { name: config.name, logo: config.logo }
}

/**
 * Resolve enterprise branding for an item from its uploader account id
 * (`createdBy`). A 大客户 may own multiple account IDs, so we match when
 * `createdBy` is any of a customer's configured ids. Returns `null` when the
 * uploader is not a configured enterprise.
 */
export function matchEnterprise(createdBy: string | undefined): EnterpriseInfo | null {
  if (!createdBy) return null
  const config = customers.find((entry) => entry.ids?.includes(createdBy))
  return config ? toEnterpriseInfo(config) : null
}

/**
 * Demo-only fallback used when `createdBy` is not enterprise-unique (mock data):
 * resolve by the item's display name. Real backend wiring relies on
 * `matchEnterprise(createdBy)` instead.
 */
export function matchEnterpriseByName(name: string | undefined): EnterpriseInfo | null {
  if (!name) return null
  const config = customers.find((entry) => entry.matchNames?.includes(name))
  return config ? toEnterpriseInfo(config) : null
}

function applyFetched(list: EnterpriseCustomer[], allowEmpty: boolean) {
  const fetched = list
    .filter((c) => Array.isArray(c.ids) && c.ids.length > 0 && c.name && c.logo)
    .map<EnterpriseConfig>((c) => ({ name: c.name, logo: c.logo, ids: c.ids }))
  if (fetched.length > 0 || allowEmpty) customers = fetched
}

let loaded = false

export function ensureEnterpriseLoaded() {
  if (loaded) return
  loaded = true
  api.hubListEnterpriseCustomers()
    .then((res) => applyFetched(res, false))
    .catch(() => {
      // Keep current roster on error (demo mode / network failure).
    })
}

/**
 * Force a re-fetch of the backend roster, bypassing the one-shot guard. Used by
 * the admin enterprise-config page after create/update/delete so hub branding
 * reflects changes immediately. Passes `allowEmpty: true` so removing the last
 * customer truly clears branding.
 */
export function refetchEnterprise() {
  loaded = true
  return api.hubListEnterpriseCustomers()
    .then((res) => applyFetched(res, true))
}
