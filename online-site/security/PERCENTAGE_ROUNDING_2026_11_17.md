# Percentage discounts: exact half-up rounding

Before the fix, 5000 cents × 0.57 / 100 could become 28.499999999999996 in binary
floating point and round down to 28 cents. New math converts the normalized
percentage to integer basis points (0.57% → 57), then computes:

`discountCents = (subtotalCents × basisPoints + 5000) / 10000` using BigInt and
integer division. The result is 29 cents and the final invoice is 49.71.

The server and browser/Offline mode share the same helper. Flutter uses the
equivalent BigInt calculation. Invoice create/edit, line allocation, customer
due and persisted totals are covered by regression tests, including exact
operation replay. Percentages over 100 are rejected on free invoices too.

No historical business records are rewritten. The schema stores the discount
amount rather than its original percentage, so intent cannot be inferred safely
from old invoices. Re-enter the percentage in an editable invoice to correct it.

`findProduct` remains available across classic scripts through an explicit global
export. The unused collection-date helper and unused fixture argument were
removed. Strict ESLint uses `--max-warnings=0`; no rule was disabled to hide these
warnings. The dependency updates and exposure review are in `SECURITY_REVIEW.md`.
