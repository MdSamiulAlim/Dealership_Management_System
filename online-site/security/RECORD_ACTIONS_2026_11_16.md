# Record editing and deletion

Orders, customer collections, every money type and stock adjustments have
shared bilingual editors. Stock includes searchable, paginated adjustment
history. Stock product rows and due statements also expose deletion actions.
Invoices use cancellation for Delete and preserve invoice/return history.

The command API reuses creation validation, original-record conflict checks,
operation IDs, epoch guards and the existing audit/replica journals. Orders
recompute their total. Order and adjustment changes check stock in SQLite;
0011 adds the missing adjustment UPDATE guard, including moving products.

Transfers update both accounts in one conditional SQL statement. Both originals
must match, including the counterpart ID. Stale data or an error on either side
changes neither entry. A single transaction cannot become a one-sided transfer.
Online outbox and encrypted Offline projections use the corresponding stock
and paired-transfer rules, including lost-response reconciliation.

Delete confirmations, pending-Sync restrictions, linked-parent protection and
immutable returned/cancelled invoice amounts remain in force. Report totals and
append-only audit/return journals are derived records, not editable transactions.
Editors retain failed input, confirm unsaved close and clear on session lock.

Tests use disposable databases/browser profiles; no live dealership data is reset
or modified during verification. The sibling Python local app has corresponding
edit routes and controls and the same adjustment stock trigger.
