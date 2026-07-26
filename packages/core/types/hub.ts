// ── Hub Module Type Definitions ───────────────────────────────────────────
// Capability items, repositories, registries, distributions, security scans,
// enterprise customers, and all supporting types for the Hub feature.

// ── Enums / Union types ──────────────────────────────────────────────────

export type ItemSort = "favoriteCount" | "installCount" | "previewCount" | "experienceScore" | "updatedAt"
export type ItemOrder = "asc" | "desc"

export type SecurityStatus =
  | "unscanned"
  | "pending"
  | "scanning"
  | "clean"
  | "low"
  | "medium"
  | "high"
  | "extreme"
  | "error"
  | "skipped"

export type SecurityRiskGroup = "unknown" | "low" | "medium" | "high"

// ── Core Entities ────────────────────────────────────────────────────────

export interface CapabilityItemAsset {
  relPath: string
  textContent?: string
  mimeType?: string
  fileSize?: number
  contentSha?: string
}

export interface ItemTag {
  id: string
  slug: string
  tagClass: string
  createdBy: string
  createdAt: string
}

export interface CapabilityVersion {
  id: string
  itemId: string
  revision: number
  name?: string
  description?: string
  descriptions?: Record<string, string>
  category?: string
  version?: string
  versionLabel?: string
  content?: string
  contentMd5?: string
  metadata?: Record<string, unknown>
  sourcePath?: string
  assets?: CapabilityItemAsset[]
  commitMsg: string
  createdBy: string
  createdAt: string
}

export interface CapabilityRegistry {
  id: string
  name: string
  description: string
  sourceType: string
  externalUrl: string
  externalBranch: string
  syncEnabled: boolean
  syncInterval: number
  lastSyncedAt?: string
  lastSyncSha: string
  syncStatus: string
  syncConfig?: Record<string, unknown>
  lastSyncLogId?: string
  visibility: string
  repoId: string
  orgId?: string
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface Repository {
  id: string
  name: string
  displayName: string
  description: string
  visibility: "public" | "private"
  repoType: "normal" | "sync"
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface CapabilityArtifact {
  id: string
  itemId: string
  version: string
  filename: string
  storageKey: string
  fileSize: number
  checksum: string
  isLatest: boolean
  downloadCount: number
  uploadedBy: string
  createdAt: string
}

export interface ScanResult {
  id: string
  itemId: string
  itemRevision: number
  riskLevel: string
  verdict: string
  summary: string
  scanModel: string
  triggerType: string
  durationMs: number
  createdAt: string
  finishedAt: string
  permissions: Record<string, unknown>
  recommendations: Record<string, unknown>[]
  redFlags: Record<string, unknown>[]
}

export interface CapabilityItem {
  id: string
  registryId: string
  repoId?: string
  slug: string
  itemType: string
  name: string
  description: string
  descriptions?: Record<string, string>
  category: string
  version: string
  content: string
  visibility: string
  repoVisibility?: string
  status: string
  currentRevision?: number
  sourcePath?: string
  sourceType?: string
  source?: string
  previewCount?: number
  installCount?: number
  favoriteCount?: number
  favorited?: boolean
  securityStatus?: SecurityStatus
  lastScanId?: string
  experienceScore?: number
  repoName?: string
  parentPluginId?: string
  parentPluginName?: string
  parentPluginSlug?: string
  createdBy: string
  forkedFromItemId?: string
  forkedFromOwnerId?: string
  isBuiltIn?: boolean
  forkCount?: number
  myForkItemId?: string
  createdAt: string
  updatedAt: string
  registry?: CapabilityRegistry
  versions?: CapabilityVersion[]
  artifacts?: CapabilityArtifact[]
  assets?: CapabilityItemAsset[]
  tags?: ItemTag[]
  health?: {
    score?: number
    effective_score?: number
    excluded_signals?: string[]
    signals: {
      freshness: number
      popularity: number
      source_trust: number
      manifest_completeness?: number
    }
    freshness_label?: string
    last_commit?: string
  }
  evaluation?: {
    coding_relevance?: number
    doc_completeness?: number
    desc_accuracy?: number
    writing_quality?: number
    specificity?: number
    install_clarity?: number
    content_quality?: number
    final_score: number
    decision?: string
    model_id?: string
    rubric_version?: string
    evaluated_at?: string
  }
  metadata?: Record<string, unknown>
  mcpConfig?: {
    fields: { key: string; hasValue: boolean; secret: boolean; value?: string }[]
  }
}

// ── Sync ─────────────────────────────────────────────────────────────────

export interface SyncJob {
  id: string
  registryId: string
  triggerType: "scheduled" | "manual" | "webhook"
  triggerUser: string
  priority: number
  status: "pending" | "running" | "success" | "failed" | "cancelled"
  retryCount: number
  maxAttempts: number
  lastError: string
  scheduledAt: string
  startedAt?: string
  finishedAt?: string
  syncLogId?: string
  createdAt: string
}

export interface SyncLog {
  id: string
  registryId: string
  triggerType: "scheduled" | "manual" | "webhook"
  triggerUser: string
  status: "running" | "success" | "failed" | "cancelled"
  commitSha: string
  previousSha: string
  totalItems: number
  addedItems: number
  updatedItems: number
  deletedItems: number
  skippedItems: number
  failedItems: number
  errorMessage: string
  durationMs: number
  startedAt: string
  finishedAt?: string
  createdAt: string
}

export interface SyncStatus {
  syncStatus: string
  lastSyncedAt?: string
  lastSyncSha: string
  pendingJobs: number
  lastLog?: SyncLog
}

/**
 * Per-registry sync status entry, returned for repos backed by multiple
 * registries (mirrors the source store project's `RepoRegistryStatus`).
 */
export interface RepoRegistryStatus {
  registryId: string
  name: string
  externalUrl: string
  syncStatus: string
  lastSyncedAt?: string
  lastSyncSha: string
  pendingJobs: number
}

/**
 * `GET /api/repositories/{id}/sync-status` response — a flat `SyncStatus`
 * for single-registry repos, or a per-registry breakdown for multi-registry
 * repos (source syncApi.getRepoSyncStatus union).
 */
export type HubRepoSyncStatusResult = SyncStatus | { registries: RepoRegistryStatus[] }

/** `POST /api/repositories/{id}/sync` response (source syncApi.triggerRepoSync). */
export interface HubRepoSyncTriggerResult {
  jobId?: string
  status?: string
  jobs?: { jobId: string; registryId: string; status: string }[]
}

/** `GET /api/repositories/{id}/sync-logs` response (source syncApi.listRepoSyncLogs). */
export interface HubRepoSyncLogListResult {
  logs: SyncLog[]
  total: number
}

// ── Distribution ─────────────────────────────────────────────────────────

export interface DistributionTarget {
  scopeType: "user" | "department"
  targetId: string
}

/**
 * A department the caller may distribute to, as returned by
 * `/api/distributions/my/authority`. Mirrors the source store project's
 * `AdminDept` shape (dept-sync tree node); `children` nests the subtrees the
 * caller leads.
 */
export interface HubDistributionDepartment {
  deptId: string
  deptName: string
  deptPath?: string
  parentDeptId?: string
  deptLevel?: number
  children?: HubDistributionDepartment[]
}

/**
 * The caller's own distribution reach (`hubMyDistributionAuthority`):
 * `unlimited === true` for platform admins, otherwise `departments` lists the
 * subtrees the caller leads — empty means the caller may not distribute at
 * all. `canDistribute` is honored when the server provides it; consumers
 * otherwise derive it from `unlimited || departments.length > 0`.
 */
export interface HubDistributionAuthority {
  canDistribute?: boolean
  unlimited: boolean
  departments: HubDistributionDepartment[]
}

export interface DistributionResult {
  distribution: {
    id: string
    itemId: string
    distributorId: string
    permissionMode: string
    status: string
    scopeType: string
    targetId: string
    message?: string
    createdAt: string
    item?: CapabilityItem
  }
  recipientCount: number
}

export interface DistributionReceipt {
  id: string
  distributionId: string
  userId: string
  receiptStatus: string
  forkedItemId?: string
  createdAt: string
  distribution?: {
    id: string
    itemId: string
    distributorId: string
    permissionMode: string
    status: string
    scopeType: string
    targetId: string
    message?: string
    createdAt: string
    item?: CapabilityItem
  }
}

// ── Enterprise ───────────────────────────────────────────────────────────

export interface EnterpriseCustomer {
  id: string
  ids: string[]
  name: string
  logo: string
}

export interface EnterpriseMember {
  universalId: string
  subjectId: string
  username: string
  displayName: string
  avatarUrl: string
}

export interface AdminEnterpriseCustomer {
  id: string
  name: string
  logo: string
  universalIds: string[]
  members: EnterpriseMember[]
}

export interface EnterpriseCustomerInput {
  name: string
  logo: string
  ids: string[]
}

// ── Repo Member / User ───────────────────────────────────────────────────

export interface RepoMember {
  id: string
  repoId: string
  userId: string
  username: string
  role: "owner" | "admin" | "member"
  createdAt: string
}

export interface SearchedUser {
  id: string
  name: string
  displayName?: string
  avatarUrl?: string
}

export interface UserBasicInfo {
  id: string
  name: string
  avatarUrl?: string
}

// ── Categories / Tags / Filters ──────────────────────────────────────────

export interface Category {
  id: string
  slug: string
  icon: string
  sortOrder: number
  names: Record<string, string>
  descriptions: Record<string, string>
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface FilterOption {
  value: string
  names: Record<string, string>
}

export interface SourceOption {
  value: string
  label: string
  url: string
}

export interface ItemFilterOptions {
  categories: Category[]
  securityStatuses: FilterOption[]
  securityRiskGroups: FilterOption[]
  sources: SourceOption[]
}

// ── Search ───────────────────────────────────────────────────────────────

export interface SearchRequest {
  query: string
  page?: number
  pageSize?: number
  types?: string[]
  categories?: string[]
  registryIds?: string[]
  minScore?: number
}

export interface SearchResult {
  items: CapabilityItem[]
  total: number
  hasMore: boolean
  query: string
  durationMs: number
}

// ── API Parameter Types ──────────────────────────────────────────────────

export interface HubItemListParams {
  type?: string
  search?: string
  category?: string
  categories?: string[]
  riskGroup?: string
  source?: string[]
  tags?: string[]
  securityStatuses?: string[]
  sort?: ItemSort
  order?: ItemOrder
  page?: number
  pageSize?: number
  hideForks?: boolean
  hideSubItems?: boolean
  registryId?: string
  status?: string
  favorited?: boolean
  /** "created by me" filter (manager tab counts); the upstream store backend
   *  resolves the literal value `"me"` to the caller. */
  createdBy?: string
  includeForks?: boolean
  paginated?: boolean
  parentPluginId?: string
  excludeSubSkills?: boolean
}

export interface HubItemCreateParams {
  itemType: string
  name: string
  description?: string
  category?: string
  tags?: string[]
  version?: string
  content?: string
  visibility?: string
  registryId?: string
  slug?: string
  sourcePath?: string
  assets?: CapabilityItemAsset[]
  createdBy?: string
  file?: File | null
}

export interface HubItemUpdateParams {
  name?: string
  description?: string
  category?: string
  version?: string
  content?: string
  visibility?: string
  commitMsg?: string
  file?: File | null
  tags?: string[]
  status?: string
  /** Built-in flag toggle (source builtin-content-dialog sets this together
   *  with markdown `content` when marking a plugin as built-in). */
  isBuiltIn?: boolean
}

// ── Plugin package upload (SD-05) ────────────────────────────────────────

/** Upload progress snapshot: bytes sent so far / total bytes to send. */
export interface HubUploadPluginProgress {
  loaded: number
  total: number
}

export interface HubUploadPluginParams {
  /** Target repository (registry) id — sent as `repo_id` (source pluginApi.upload). */
  repoId: string
  /** Plugin package archive (.zip). */
  file: File
}

export interface HubDistributionCreateParams {
  targets: DistributionTarget[]
  permissionMode: "readonly" | "dismissible"
  message?: string
}

export interface HubRepoCreateParams {
  name: string
  displayName?: string
  description?: string
  visibility?: string
  /** Optional — the upstream store derives the owner from the caller's
   *  authenticated identity, so create flows never send it. */
  ownerId?: string
  repoType?: "normal" | "sync"
}

export interface HubRepoUpdateParams {
  name?: string
  displayName?: string
  description?: string
  visibility?: string
}

export interface HubRepoMemberAddParams {
  userId: string
  username?: string
  role?: string
}

export interface HubRepoInviteParams {
  inviteeId: string
  inviteeUsername: string
  role: string
}

export interface HubMcpConfigFields {
  [key: string]: string
}

export interface HubBehaviorLogBody {
  action: string
  actionType?: string
  context?: string
  durationMs?: number
  metadata?: Record<string, unknown>
}

export interface HubTagListParams {
  query?: string
  page?: number
  pageSize?: number
  tagClass?: string
}

export interface HubSemanticSearchParams {
  query: string
  page?: number
  pageSize?: number
  types?: string[]
  categories?: string[]
  registryIds?: string[]
  minScore?: number
}

// ── Scan Status ──────────────────────────────────────────────────────────

export interface ScanStatus {
  scanStatus: SecurityStatus
  lastScannedAt?: string
  latestResult?: {
    id: string
    riskLevel: string
    verdict: string
    summary: string
    scanModel: string
  }
}
