"""Edit routes run against disposable databases through the real WSGI handler."""
import json
import unittest
from test_online import OnlineTests


class RecordEditTests(unittest.TestCase):
    setUp = OnlineTests.setUp
    request = OnlineTests.request

    def create(self, entity, payload):
        before = json.loads(self.request('/api/bootstrap')['body'])[entity]
        result = self.request('/api/' + entity, 'POST', payload)
        self.assertEqual(result['status'], 201, result['body'])
        return next(r for r in json.loads(result['body'])[entity] if r['id'] not in {old['id'] for old in before})

    def test_orders_adjustments_customer_and_payment_edits(self):
        product = json.loads(self.request('/api/bootstrap')['body'])['products'][0]
        row = self.create('orders', dict(order_date='2026-11-16', product_id=product['id'], quantity=10, rate=100, status='Delivered'))
        changed = self.request(f"/api/orders/{row['id']}", 'PATCH', dict(quantity=20, rate=150, original=row, confirmed=True))
        self.assertEqual(changed['status'], 200, changed['body'])
        self.assertEqual(json.loads(changed['body'])['dashboard']['company_payable'], 3000)
        self.assertEqual(self.request(f"/api/orders/{row['id']}", 'PATCH', dict(quantity=1, original=row, confirmed=True))['status'], 409)
        customer = self.create('customers', {'name': 'Edit fixture'})
        self.assertEqual(self.request(f"/api/customers/{customer['id']}", 'PATCH', dict(name='Renamed fixture', mobile='01700000000', original=customer))['status'], 200)
        payment = self.create('payments', dict(customer_id=customer['id'], payment_date='2026-11-16', amount=100, account='Cash'))
        self.assertEqual(self.request(f"/api/payments/{payment['id']}", 'PATCH', dict(amount=150, original=payment))['status'], 200)
        adjustment = self.create('adjustments', dict(product_id=product['id'], adjust_date='2026-11-16', quantity=2, type='Manual Minus', notes='Count'))
        self.assertEqual(self.request(f"/api/adjustments/{adjustment['id']}", 'PATCH', dict(quantity=21, original=adjustment, confirmed=True))['status'], 409)
        self.assertEqual(self.request(f"/api/adjustments/{adjustment['id']}", 'PATCH', dict(quantity=1, original=adjustment, confirmed=True))['status'], 200)

    def test_transfer_edit_keeps_both_sides_balanced_and_rejects_stale_partner(self):
        self.create('transactions', dict(txn_date='2026-11-16', type='Other Income', amount=1000, account='Cash'))
        row = self.create('transactions', dict(txn_date='2026-11-16', type='Bank Deposit', amount=100, account='Cash'))
        data = json.loads(self.request('/api/bootstrap')['body'])
        partner = next(t for t in data['transactions'] if t['transfer_id'] == row['transfer_id'] and t['id'] != row['id'])
        self.assertEqual(self.request(f"/api/transactions/{row['id']}", 'PATCH', dict(amount=250, original=row, original_transfer=row, confirmed=True))['status'], 409)
        result = self.request(f"/api/transactions/{row['id']}", 'PATCH', dict(amount=250, original=row, original_transfer=partner, confirmed=True))
        self.assertEqual(result['status'], 200, result['body'])
        data = json.loads(result['body'])
        self.assertEqual(data['dashboard']['cash_balance'], 750)
        self.assertEqual(data['dashboard']['bank_balance'], 250)
        latest = next(t for t in data['transactions'] if t['id'] == row['id'])
        self.assertEqual(self.request(f"/api/transactions/{row['id']}", 'PATCH', dict(amount=400, original=latest, original_transfer=partner, confirmed=True))['status'], 409)
        self.assertTrue(all(t['amount'] == 250 for t in json.loads(self.request('/api/bootstrap')['body'])['transactions'] if t['transfer_id'] == row['transfer_id']))

    def test_sale_edit_recalculates_and_invalid_quantities_do_not_change_stock(self):
        product = json.loads(self.request('/api/bootstrap')['body'])['products'][0]
        self.create('orders', dict(order_date='2026-11-16', product_id=product['id'], quantity=10, rate=100, status='Delivered'))
        customer = json.loads(self.request('/api/bootstrap')['body'])['customers'][0]
        row = self.create('sales', dict(sale_date='2026-11-16', product_id=product['id'], customer_id=customer['id'], quantity=2, rate=100, paid_amount=50, account='Cash'))
        path=f"/api/sales/{row['id']}"
        for quantity in [-1, 1.5, 11]:
            self.assertIn(self.request(path, 'PATCH', dict(quantity=quantity, original=row))['status'], (400,409))
        result=self.request(path, 'PATCH', dict(quantity=3, rate=120, original=row))
        self.assertEqual(result['status'],200,result['body'])
        self.assertEqual(json.loads(result['body'])['sales'][0]['total_amount'],360)


if __name__ == '__main__':
    unittest.main()
