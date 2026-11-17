-- Replacing an adjustment must first restore its old stock effect, including
-- when it moves to a different product. Enforce the check inside SQLite.
CREATE TRIGGER IF NOT EXISTS guard_adjustment_stock_update BEFORE UPDATE ON stock_adjustments
WHEN
  (NEW.product_id<>OLD.product_id AND (
    (OLD.type IN ('Return','Manual Add') AND OLD.quantity>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=OLD.product_id),0)) OR
    (NEW.type NOT IN ('Return','Manual Add') AND NEW.quantity>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=NEW.product_id),0))
  )) OR
  (NEW.product_id=OLD.product_id AND
    (CASE WHEN OLD.type IN ('Return','Manual Add') THEN OLD.quantity ELSE -OLD.quantity END)-
    (CASE WHEN NEW.type IN ('Return','Manual Add') THEN NEW.quantity ELSE -NEW.quantity END)>
    COALESCE((SELECT available FROM inventory_guard_stock WHERE id=OLD.product_id),0))
BEGIN SELECT RAISE(ABORT,'insufficient_stock'); END;
