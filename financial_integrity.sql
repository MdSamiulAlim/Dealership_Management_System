-- Atomic stock and parent-history safeguards; existing records are unchanged.
CREATE VIEW IF NOT EXISTS inventory_guard_stock AS SELECT p.id,
 ROUND(p.opening_stock
 +COALESCE((SELECT SUM(quantity) FROM company_orders o WHERE o.product_id=p.id AND o.status='Delivered'),0)
 -COALESCE((SELECT SUM(quantity) FROM sales s WHERE s.product_id=p.id),0)
 +COALESCE((SELECT SUM(CASE WHEN type IN ('Return','Manual Add') THEN quantity ELSE -quantity END) FROM stock_adjustments a WHERE a.product_id=p.id),0),2) AS available
 FROM products p;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_sale_stock_insert BEFORE INSERT ON sales WHEN EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id) AND NEW.quantity>0 AND NEW.quantity>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=NEW.product_id),0)
 BEGIN SELECT RAISE(ABORT,'insufficient_stock'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_sale_stock_update BEFORE UPDATE OF product_id,quantity ON sales WHEN EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id) AND (NEW.product_id<>OLD.product_id OR NEW.quantity>OLD.quantity) AND NEW.quantity>0 AND NEW.quantity>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=NEW.product_id),0)+CASE WHEN NEW.product_id=OLD.product_id THEN OLD.quantity ELSE 0 END
 BEGIN SELECT RAISE(ABORT,'insufficient_stock'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_product_history BEFORE DELETE ON products WHEN EXISTS(SELECT 1 FROM company_orders WHERE product_id=OLD.id) OR EXISTS(SELECT 1 FROM stock_adjustments WHERE product_id=OLD.id) OR EXISTS(SELECT 1 FROM sales WHERE product_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'linked_record'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_customer_history BEFORE DELETE ON customers WHEN EXISTS(SELECT 1 FROM customer_payments WHERE customer_id=OLD.id) OR EXISTS(SELECT 1 FROM sales WHERE customer_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'linked_record'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_received_stock_delete BEFORE DELETE ON company_orders WHEN NOT EXISTS(SELECT 1 FROM app_meta WHERE key='integrity_reset') AND OLD.status='Delivered' AND OLD.quantity>0 AND OLD.quantity>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=OLD.product_id),0)
 BEGIN SELECT RAISE(ABORT,'insufficient_stock'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_adjustment_stock_insert BEFORE INSERT ON stock_adjustments WHEN NEW.type NOT IN ('Return','Manual Add') AND NEW.quantity>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=NEW.product_id),0)
 BEGIN SELECT RAISE(ABORT,'insufficient_stock'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_adjustment_stock_delete BEFORE DELETE ON stock_adjustments WHEN NOT EXISTS(SELECT 1 FROM app_meta WHERE key='integrity_reset') AND OLD.type IN ('Return','Manual Add') AND OLD.quantity>0 AND OLD.quantity>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=OLD.product_id),0)
 BEGIN SELECT RAISE(ABORT,'insufficient_stock'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_received_stock_update BEFORE UPDATE ON company_orders WHEN OLD.status='Delivered' AND (NEW.product_id<>OLD.product_id OR NEW.status<>'Delivered' OR NEW.quantity<OLD.quantity) AND OLD.quantity-CASE WHEN NEW.product_id=OLD.product_id AND NEW.status='Delivered' THEN NEW.quantity ELSE 0 END>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=OLD.product_id),0)
 BEGIN SELECT RAISE(ABORT,'insufficient_stock'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS guard_product_stock_update BEFORE UPDATE OF opening_stock ON products WHEN NEW.opening_stock<OLD.opening_stock AND OLD.opening_stock-NEW.opening_stock>COALESCE((SELECT available FROM inventory_guard_stock WHERE id=OLD.id),0)
 BEGIN SELECT RAISE(ABORT,'insufficient_stock'); END;

--> statement-breakpoint
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
