/**
 * Shared API contract between the Vue frontend and the Apps Script backend (apps-script/src/20_Api.js).
 */

export interface ApiEnvelope<T = unknown> {
  success: boolean
  data: T
  message: string
  error: { code: string; message: string } | null
  requestId: string | null
}

export interface RequestEnvelope {
  action: string
  token?: string
  requestId?: string
  params?: Record<string, unknown>
}

export type Role = 'admin' | 'literature_servant' | 'congregation_user' | 'read_only'

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  literature_servant: 'Congregation Literature Servant',
  congregation_user: 'Congregation User',
  read_only: 'Read-Only User',
}

export interface User {
  userId: string
  email: string
  name: string
  role: Role
  congregationId: string
  congregationName: string
  congregationCode: string
  active: boolean
  lastLoginAt: string
  permissions: string[]
}

export interface LoginResponse {
  token: string
  user: User
  expiresInSeconds: number
}

export interface Paged<T> {
  rows: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ListParams {
  page?: number
  pageSize?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  query?: string
  from?: string
  to?: string
  [key: string]: unknown
}

export interface Congregation {
  congregationId: string
  code: string
  name: string
  type: 'coordinator' | 'member' | 'supplier'
  active: boolean
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Item {
  itemId: string
  sku: string
  name: string
  description: string
  category: string
  unit: string
  minStock: number
  lowStockThreshold: number
  active: boolean
  physicalQty: number
  reservedQty: number
  availableQty: number
  isLowStock: boolean
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  lastMovementAt: string
  recentTransactions?: LedgerEntry[]
}

export interface ItemsPage extends Paged<Item> {
  categories: string[]
}

export type TxnType = 'OPENING_BALANCE' | 'DELIVERY_IN' | 'DISTRIBUTION_OUT' | 'ADJUSTMENT'

export interface LedgerEntry {
  txnId: string
  timestamp: string
  type: TxnType
  quantity: number
  balanceAfter?: number
  itemId?: string
  sku?: string
  itemName?: string
  refType: string
  refId: string
  counterpartyCongregationId: string
  counterpartyName: string
  actor: string
  notes: string
}

export type DeliveryStatus = 'Pending' | 'Confirmed' | 'Cancelled'

export interface DeliveryLine {
  deliveryItemId?: string
  itemId: string
  sku: string
  itemName: string
  unit: string
  quantity: number
}

export interface Delivery {
  deliveryId: string
  reference: string
  deliveryDate: string
  sourceType: 'supplier' | 'congregation'
  sourceCongregationId: string
  sourceName: string
  receivedBy: string
  status: DeliveryStatus
  notes: string
  createdAt: string
  createdBy: string
  confirmedAt: string
  confirmedBy: string
  updatedAt: string
  itemCount: number
  totalQty: number
  items?: DeliveryLine[]
  ledgerPosted?: boolean
}

export type RequestStatus = 'Draft' | 'Pending' | 'Approved' | 'Partially Fulfilled' | 'Fulfilled' | 'Rejected' | 'Cancelled'

export const REQUEST_STATUSES: RequestStatus[] = ['Draft', 'Pending', 'Approved', 'Partially Fulfilled', 'Fulfilled', 'Rejected', 'Cancelled']

export interface RequestLine {
  requestItemId: string
  itemId: string
  sku: string
  itemName: string
  unit: string
  requestedQty: number
  approvedQty: number
  fulfilledQty: number
  remainingQty: number
  physicalQty?: number
  reservedQty?: number
  availableQty?: number
}

export interface LiteratureRequest {
  requestId: string
  requestNumber: string
  congregationId: string
  congregationName: string
  congregationCode: string
  requestDate: string
  requestedBy: string
  approvedBy: string
  status: RequestStatus
  notes: string
  decisionNotes: string
  createdAt: string
  createdBy: string
  submittedAt: string
  decidedAt: string
  updatedAt: string
  updatedBy: string
  itemCount: number
  requestedTotal: number
  approvedTotal: number
  fulfilledTotal: number
  remainingTotal: number
  items?: RequestLine[]
  distributions?: { distributionId: string; reference: string; status: DistributionStatus; createdAt: string; releasedBy: string }[]
}

export type DistributionStatus = 'Processing' | 'Released' | 'Received' | 'Failed'

export interface DistributionLine {
  distributionItemId: string
  itemId: string
  sku: string
  itemName: string
  unit: string
  quantity: number
  requestItemId: string
}

export interface Distribution {
  distributionId: string
  reference: string
  requestId: string
  requestNumber: string
  destinationCongregationId: string
  destinationName: string
  destinationCode: string
  releasedBy: string
  receivedBy: string
  status: DistributionStatus
  notes: string
  createdAt: string
  createdBy: string
  receivedAt: string
  receivedConfirmedBy: string
  updatedAt: string
  itemCount: number
  totalQty: number
  items?: DistributionLine[]
  receipt?: {
    appName: string
    issuedBy: string
    issuedByCode: string
    reference: string
    requestNumber: string
    destination: string
    releasedBy: string
    receivedBy: string
    releasedAt: string
    status: string
    notes: string
    items: DistributionLine[]
    totalQty: number
  }
}

export interface DashboardSummary {
  generatedAt: string
  from: string
  to: string
  congregationId: string
  coordinator: { congregationId: string; name: string; code: string }
  stock: {
    uniqueItems: number
    physicalQty: number | null
    reservedQty: number | null
    availableQty: number | null
    lowStockCount: number | null
    lowStockItems: { itemId: string; sku: string; name: string; physicalQty: number; availableQty: number; minStock: number }[]
  }
  deliveries: { pending: number | null; confirmed: number | null; cancelled: number | null; confirmedQty: number | null }
  requests: { draft: number; pending: number; approved: number; partiallyFulfilled: number; fulfilled: number; rejected: number; cancelled: number; awaitingFulfilment: number }
  distributions: { released: number; received: number; totalQty: number }
  distributionByCongregation: { congregationId: string; name: string; distributions: number; releasedQty: number; receivedQty: number }[]
  recentTransactions: LedgerEntry[]
  reserveOnApproval: boolean
}

export interface StockOverview {
  congregation: Congregation
  isCoordinator: boolean
  from: string
  to: string
  items: {
    itemId: string; sku: string; name: string; unit: string
    physicalQty?: number; reservedQty?: number; availableQty?: number; receivedQty: number; releasedQty?: number; adjustedQty?: number
    periodReceivedQty?: number; inTransitQty?: number; outstandingQty?: number
  }[]
  requests: LiteratureRequest[]
  distributions: Distribution[]
  totals: Record<string, number>
}

export interface ReportColumn { key: string; label: string }

export interface Report {
  type: string
  title: string
  columns: ReportColumn[]
  rows: Record<string, unknown>[]
  generatedAt: string
  generatedBy: string
  filters: { from: string; to: string; congregationId: string }
}

export interface Setting { key: string; value: string; description: string }

export interface AuditEntry {
  auditId: string
  timestamp: string
  actor: string
  action: string
  entityType: string
  entityId: string
  summary: string
  requestId: string
  details: string
}

export interface ReconcileReport {
  applied: boolean
  balanceFixes: { itemId: string; cached: number | null; ledger: number }[]
  fulfilledFixes: { requestItemId: string; requestId: string; cached: number; computed: number }[]
  processingDistributions: { distributionId: string; reference: string; ledgerWritten: boolean; action: string }[]
}

export interface LegacyImportReport {
  month: string
  apply: boolean
  planned: { itemId: string; sku: string; name: string; quantity: number }[]
  unmatched: { sku: string; name: string; quantity: number }[]
  created: string[]
}
