# Spreadsheet data model

Spreadsheet: `1wOtMKqOqx-92Dj7ThAKQOkQ0cZ-XznJlSLTxG7NQEhg` ("Inventory and Distribution System").
All timestamps are ISO 8601 strings; dates are `yyyy-mm-dd`; booleans are `TRUE`/`FALSE`; all new worksheets are
formatted as plain text so values are stored exactly as written. IDs are generated (`itm_…`, `req_…`), never row
numbers. Columns are only ever appended, never reordered (`ensureSchema()` adds missing columns).

## Pre-existing worksheets (read-only for the backend)

| Worksheet | Columns (verified 2026-10-20) | Rows | Use |
|-----------|-------------------------------|------|-----|
| `East_Inventory` | Literature Code, Literature Name, Total, Date | 30 (Jan–Jun 2026, 5 codes) | Monthly stock snapshots. Exposed as the "Legacy: East_Inventory" report; optional one-time source for opening balances. |
| `Distribution` | Literature Code, Literature Name, Total, Date, Congregation | 10 (Apr 2026) | Legacy distribution log. Exposed as the "Legacy: Distribution" report. |

No formulas were visible through public access; the backend never writes to these sheets, so existing formulas
and records are preserved regardless.

## Managed worksheets

| Worksheet | ID column | Columns |
|-----------|-----------|---------|
| `LiteratureItems` | itemId | sku, name, description, category, unit, minStock, active, createdAt, createdBy, updatedAt, updatedBy |
| `Congregations` | congregationId | code, name, type (`coordinator`/`member`/`supplier`), active, notes, createdAt, updatedAt |
| `InventoryTransactions` (ledger) | txnId | timestamp, type (`OPENING_BALANCE`/`DELIVERY_IN`/`DISTRIBUTION_OUT`/`ADJUSTMENT`), itemId, quantity (±), holderCongregationId, refType, refId, counterpartyCongregationId, actor, notes, requestKey |
| `InventoryBalances` (cache) | itemId | physicalQty, lastTxnId, updatedAt |
| `Deliveries` | deliveryId | reference (`DLV-yyyy-nnnn`), deliveryDate, sourceType, sourceCongregationId, sourceName, receivedBy, status, notes, createdAt, createdBy, confirmedAt, confirmedBy, updatedAt, updatedBy |
| `DeliveryItems` | deliveryItemId | deliveryId, itemId, quantity |
| `Requests` | requestId | requestNumber (`REQ-yyyy-nnnn`), congregationId, requestDate, requestedBy, approvedBy, status, notes, decisionNotes, createdAt, createdBy, submittedAt, decidedAt, updatedAt, updatedBy |
| `RequestItems` | requestItemId | requestId, itemId, requestedQty, approvedQty, fulfilledQty |
| `Distributions` | distributionId | reference (`DST-yyyy-nnnn`), requestId, destinationCongregationId, releasedBy, receivedBy, status, notes, createdAt, createdBy, receivedAt, receivedConfirmedBy, updatedAt |
| `DistributionItems` | distributionItemId | distributionId, itemId, quantity, requestItemId |
| `AuthorizedUsers` | userId | email, name, role, congregationId, active, createdAt, createdBy, updatedAt, updatedBy, lastLoginAt |
| `AuditLogs` | auditId | timestamp, actor, action, entityType, entityId, summary, requestId, details |
| `AppSettings` | key | value, description, updatedAt, updatedBy |
| `IdempotencyKeys` | key (`actor:requestId`) | action, actor, createdAt, responseJson |

## Stock rules

```
physicalQty  (East)  = SUM(InventoryTransactions.quantity WHERE itemId)      -- cached in InventoryBalances
reservedQty          = SUM(approvedQty - fulfilledQty) over RequestItems of requests in
                       Approved / Partially Fulfilled                           -- only if reserveOnApproval = true
availableQty         = physicalQty - reservedQty
```

- Only **Confirmed** deliveries post `DELIVERY_IN`; confirmation is idempotent (checked by `refType=DELIVERY, refId`).
- Distributions post `DISTRIBUTION_OUT` once, update `fulfilledQty`, then the request status, then mark `Released`.
- Member congregations never hold "physical stock" in this model. Their overview shows **confirmed received**
  (status `Received`), **released but unconfirmed** (`Released`) and **approved but not released**. East physical +
  all released = everything ever received into the system, so consolidated reports do not double count.
- Opening balances and manual corrections are explicit ledger rows (`OPENING_BALANCE`, `ADJUSTMENT`) with actor and reason.

## Status transitions

Deliveries: `Pending → Confirmed | Cancelled`. Confirmed is terminal (fix with an adjustment).

Requests:
```
Draft ──submit──▶ Pending ──approve──▶ Approved ──release──▶ Partially Fulfilled ──release──▶ Fulfilled
  │                 │  └─reject──▶ Rejected       └──────────────cancel (releases reservation)──▶ Cancelled
  └──cancel──▶ Cancelled ◀──cancel──┘
```
Congregation users may cancel only Draft/Pending requests of their own congregation.

Distributions: `Processing → Released → Received` (`Failed` is set by reconcile when a run died before the ledger write).

## Settings (`AppSettings`)

| Key | Default | Effect |
|-----|---------|--------|
| reserveOnApproval | true | approvals reserve stock and are capped by available stock |
| allowAdHocDistribution | false | allow releases without an approved request |
| defaultLowStockThreshold | 10 | low-stock level for items with minStock = 0 |
| requestNumberPrefix / deliveryReferencePrefix / distributionReferencePrefix | REQ / DLV / DST | reference formats |

## Recovery procedure (partial multi-sheet writes)

1. Symptoms: a distribution stuck in `Processing`, an item whose balance disagrees with its history, a request whose
   fulfilled quantity does not match its distributions.
2. User Management → Maintenance → **Reconcile → Dry run**. Review the three lists.
3. **Apply fixes**: balances are rebuilt from the ledger, `fulfilledQty` recomputed from Released/Received
   distribution lines, Processing distributions finalized (ledger present) or marked Failed (no ledger).
4. If a Failed distribution should have happened, release it again from the request; the stock was never deducted.
5. Everything is recorded in `AuditLogs`.
