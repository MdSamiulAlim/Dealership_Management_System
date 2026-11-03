# Arafat Traders — Material Design 3

The hosted web app and Android WebView share the same UI. `app/material3.css` is the M3 presentation layer, imported after the original structural styles. Native HTML controls, dialogs, existing business logic and offline encryption remain in use; this is a custom web implementation of Material 3, not a native Compose conversion.

- Static green primary and blue tertiary brand scheme, named M3 colour roles, tonal surfaces, readable on-colours and error containers. No wallpaper-driven colours.
- Headline, title, body and label hierarchy using the existing bundled Manrope and Noto Bengali fonts. No external font requests.
- 4/8/12/16/28px shape scale, full-rounded actions, tonal and outlined buttons, focus/hover/pressed/disabled states, reduced motion and forced-colour support.
- Touch controls at least 48 CSS px; outlined form fields 56px high. Table contents scroll inside their containers.
- Up to 760px: bottom navigation and a modal drawer with close button, focus containment, Escape and restored trigger focus. 761–1199px: 96px rail. From 1200px: 280px drawer. Every section stays available.
- Online and offline styles use the same source. `scripts/prepare-offline.mjs` combines both stylesheets and fingerprints static assets; keep its script version in sync with `app/dashboard.tsx` and `public/sw.js`.
- Invoice screen actions follow the UI theme. Printed invoices and generated PDFs retain their business layout and Arafat/AKIJ logos.

Run the existing tests, TypeScript and Sites build after changes. Use an isolated preview database for browser checks; never insert test transactions into the live database.

## Daily workflows

Sales opens with its memo list. New Sale opens a three-part composer (customer/date, products, payment); optional invoice numbers and notes stay in a disclosure. Product search selects an item using the existing change handler and displays its current stock and rate. Full-payment and unpaid shortcuts use the same invoice calculation and input events as manual entry.

`public/usability.js` and `app/usability.css` add active filter counts, compact mobile memo cards, a context-aware mobile save dock, and readable invoice line items. The dock submits the existing form, follows its busy state, hides when the form is out of view or a dialog/keyboard is open, and never writes data itself. Saving prevents duplicate submissions and returns to the memo list with the saved invoice open. Every new static asset is included in offline preparation and the service-worker fingerprint.

Stock rows expose Edit beside the product name, including on narrow screens. The editor changes product metadata and a confirmed Current Bag total through idempotent commands with the original record for conflict detection. Saved invoice item snapshots remain immutable.

Current Bag can be set from the Stock product editor. A changed total requires confirmation and atomically appends Manual Add/Manual Minus with the before/after count and optional note; it never rewrites opening stock. The stock expression joins the original-record guard so intervening sales, deliveries or adjustments produce a conflict rather than being overwritten. Operation replay never creates another adjustment.

Customer editing changes contact details only, preserves monetary balances, and freezes contact snapshots for legacy invoices before updating the customer master. New bag quantities, opening counts, alerts and returns require integers before rounding; prices, payments and bag weight in kg retain decimals. Historical fractional quantities remain intact. Explicitly correcting a historical fractional stock total to an integer records the exact difference as an adjustment.

Brand placement: the Arafat growth logo, including its built-in business name, replaces both duplicate navigation name blocks. A compact copy remains in the top-right app bar on every screen size; the owner display and greeting use Arafat while the Samiul login ID is preserved. A compact bottom-right “Powered by Samiul Alim” credit replaces the full footer bar and its contact details. AKIJ Feed sits in a compact, bordered partner card with its original aspect ratio.

The app header stays at the top during page scrolling. A small fixed developer credit remains above phone bottom navigation; measured header/credit/navigation heights reserve space for content, focused controls, the sale save dock and notifications. Print output excludes the workspace shell.

The live Asia/Dhaka clock sits below the section breadcrumb in the persistent header, with a compact stacked layout on phones. The developer name remains bold italic in the primary theme colour; the requested credit wording stays in English. Sidebar and header spacing is compact while controls retain 48px touch targets.

## Language

`public/i18n-catalog.js` contains the canonical English/Bengali interface catalog and legacy helper aliases. `public/i18n.js` applies it reversibly to text, placeholders, accessible labels and table card labels, including asynchronously rendered controls. Option labels are translated separately from their unchanged submission values. Saved names, contact details, codes, notes and references are marked `translate="no"`; formatted messages interpolate record data without translating it. Numeric template arguments accept numbers only, so a product name ending in kg is never mistaken for a quantity.

The selection persists per device, including offline reopen. Form drafts and enum values survive a switch. Number/date display and validation messages follow the selected language, while input values, command payloads and stored records remain unchanged. Invoice preview, print, share and authenticated PDF downloads use the selected language. Both locale assets are included in the offline cache and its content fingerprint.

The drawer heading places the close action beside the logo on phones, using an 88px logo (96px desktop, 64px rail) instead of a 160px logo below a separate close row. Reduced drawer gutters and 2px destination gaps reveal more menu items while retaining 48px minimum touch targets.

On phones, More and the menu button open the same comfortable modal drawer, capped at 304px with at least 56px of the screen left for outside-click dismissal. Menu labels and backup text wrap naturally, with the same 48px targets, scrolling, outside-click/Escape dismissal and focus restoration. Tablet and desktop navigation widths remain unchanged.

The sidebar AKIJ Feed partner mark is 100px wide with its original aspect ratio, keeping it secondary to the shop branding and reducing its vertical footprint. Invoice partner logos retain their print size.

The persistent header clock includes the full weekday in the selected language and uses Asia/Dhaka for both the day and time. Its date wraps naturally and the header reserves its measured height on narrow screens.

Every workspace menu shares aligned numeric column headers and values, consistent cell gutters, wrapping list toolbars and action groups, and form fields aligned by their control edges. Reports use their column schema to align numeric values even if a server serializes a number as text. Phone sales cards retain their readable label/value layout. Large tables scroll inside their own containers. Stock names and count/status badges form one group beside a vertically centred Edit action; its fixed column proportions keep names, packet codes and counts distinct.

## App account roles and reset

The original `APP_LOGIN_USERNAME` / `APP_LOGIN_PASSWORD_RECORD` account is Admin/Master; the additional `APP_GENERAL_USERNAME` / `APP_GENERAL_PASSWORD_RECORD` account is General. Both password verifiers are configured in the runtime environment, never shipped to the browser. Every business API request verifies authentication independently and assigns the role server-side. Basic authentication keeps the existing Android-compatible realm. Bootstrap and check-login expose only the authenticated user ID and role.

Settings displays the signed-in account and an Admin-only full workspace reset card. Reset requires an internet connection, no pending device work, a distinct typed `RESET ALL DATA` confirmation and an idempotent request ID. It clears products, customers and all dependent business ledgers, resets business settings, and retains login accounts, import markers and increasing record IDs. A small last-reset audit records the Admin, timestamp, operation ID and new workspace epoch. Adding this feature never invokes it against the live database.

Every mutation checks the workspace epoch inside its atomic D1 write. Reset increments that epoch in the same transaction as deletions. Old device commands and legacy requests default only to epoch zero and cannot repopulate a reset workspace. A rejected Offline queue stays encrypted on its device for export/review/removal; it is never silently replayed with a fresh epoch. A reset retry does not delete records created after the first successful reset. The reset itself is online-only and never enters the Offline queue.


## Header account control

The top-right account button always displays the original Arafat Traders growth logo, including when logged out. It retains a 48px touch target, with the logo at 40px on desktop and 32px on phones. Its accessible label identifies Log In or the current account; clicking opens account details, Log Out and Switch Account. The bilingual login form accepts a user ID and password, never a client-selected role. The app shell contains no business records and hides its main workspace while unauthenticated. All private reads, writes and downloads remain authenticated in the API.

Login issues a signed, 12-hour HttpOnly SameSite=Strict cookie (Secure on HTTPS), with roles resolved from current configured accounts. A cookie always takes precedence over legacy Basic credentials. Logout overwrites it with a signed-out sentinel, so cached Android/browser Basic credentials cannot silently restore the previous role. Invalid, expired or password-rotated sessions fail closed. Same-origin JSON checks protect login/logout, and failed login attempts are limited. Neither passwords nor session tokens are stored in JavaScript storage.

Account switching preserves each user's password-encrypted device vault in the existing IndexedDB store, including legacy vaults. It changes the active encrypted record atomically and clears keys, forms, record views, invoice previews and privilege indicators in memory. Unsaved forms require confirmation; unsynced work must be synced before logout or switching. Network responses and queued writes from a previous account are rejected using a session generation. Other open tabs lock their local view when an account changes. Login/logout require connectivity; existing Lock Device and password unlock remain available Offline. Android's automatic vault unlock cannot undo explicit logout or override an already selected account.

## Customer Due

Customer Due is a dedicated drawer destination, available to both account roles and from the page's Receive Payment action. It includes every customer and invoice, with customer/mobile/invoice search and due, settled and credit filters. Positive outstanding balances and customer credits are shown separately; their net matches the existing ledger total.

`public/customer-due.mjs` supplies the same cents-based statement calculation to browser views and authenticated server PDFs: opening balance + net sales after returns - sale payments after refunds - separate customer collections. Cancelled invoices contribute zero, customer IDs keep identically named accounts separate, and running history includes invoice charges, sale payments, return credits/refunds and collections. Device-pending records and cancellations visibly mark the statement as provisional. Any unsynced device command blocks the final server PDF, including an invoice moved away from its former customer, until all pending work is synced.

View opens a customer statement with current contact details, totals and a chronological account history. Edit exposes the linked invoice and collection editors and existing customer contact editor. Financial totals remain derived: collection edits adjust the original customer payment, preserving stock and reconciling Cash/Bank and customer balances atomically with original-record conflict guards and idempotency. New collection forms keep their operation ID across a retry. Customer collections reduce the account balance without rewriting invoice payment snapshots.

The dedicated collection form supports amount, date, account and notes, previews the resulting balance and preserves unsaved changes on cancellation/conflict. Offline creation and edits use the encrypted outbox, including an edit to a newly queued collection whose temporary ID is resolved during sync. Receipt views/print work from the device snapshot. The authenticated PDF endpoint reads customer, invoices, returns and collections in one D1 transaction and reuses the existing bilingual, branded, paginated PDF renderer. Logout/account switch/reset clears statement content, filters and drafts. No database schema migration or live-data rewrite is needed.


Financial integrity: product/customer records with any order, adjustment, sale or collection are retained; deletion returns a conflict and does not cascade away financial history. Unused records can still be deleted. Migration 0004 adds bounded schema-only SQLite triggers and a stock view without changing historical rows. Stock checks run inside the sale transaction, sum duplicate product lines, roll back failed invoice edits/new contacts, and reject stock-reducing receipt/adjustment deletion. Invoice edits release their original quantities in that same transaction. Existing negative/fractional history is not rewritten; stock corrections may restore it. Admin reset bypasses stock-removal guards only inside its atomic reset batch and clears the bypass before commit.

Legacy create endpoints and sync commands share prepareInsert validators for real dates, whole positive quantities, nonnegative rates, positive weights/amounts, account/type/status choices, and calculated totals. Explicit mismatched totals and excess payments are rejected rather than silently clamped. All product edit paths require the full original record and condition the UPDATE on that snapshot. Python applies the matching validators and SQL safeguards from financial_integrity.sql. Both implementations consume the same invalid-record test contract.

Offline stock is checked against the device snapshot, including its pending work. Another device can consume stock before synchronization; the server then rejects the pending operation as a conflict, retains it for review, and does not commit a partial invoice. Legacy unsafe pending deletions are excluded from projection while remaining in the review queue, preserving visible collections and orders. Sync is required before a final customer statement PDF.
