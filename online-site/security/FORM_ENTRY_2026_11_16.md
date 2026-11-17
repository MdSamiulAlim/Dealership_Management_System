# User-entered values start blank

New business-entry forms no longer select the first customer/product, copy the
catalog price/pack weight, choose an account/status/type, or fill dates and
numeric inputs with 0/1/5/25/50. Creation/reset, first login and ordinary replica
renders retain an empty selection until the owner chooses a value. Calculated
totals, the header clock, report filters and generated IDs are not manual inputs.

New Sale customer contact fields are blank and browser profile autofill is
disabled. Explicitly choosing an existing customer loads that customer's saved
details; choosing New Customer leaves details blank. The form does not pick a
customer by itself. Edit forms load the existing record, preserving prices,
alert levels and invoice values. Product field names/order and catalog data are
unchanged. A new product's Low Stock Alert must be entered by the owner.

Blank sale rate remains missing rather than becoming an implicit free sale.
Discount is optional; a positive discount requires the owner to select its
type. Paid amount can be entered as 0 or filled with the owner's Pay Later action.
Return date/quantities are blank and restocking is an explicit Yes/No choice.
Collection forms no longer choose the first/outstanding customer, date or Cash.

Both web and sibling local Python forms follow this policy. Regression checks
use disposable browser/database fixtures. Existing business records, product
catalog files, schema, passwords, stock and stored prices are not migrated.
