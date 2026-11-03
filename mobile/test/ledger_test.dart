import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/ledger.dart';
import 'package:arafat_traders/core/types.dart';
import 'support.dart';

void main() {
  test(
    'transfer creates and deletes both sides without changing combined balance',
    () {
      final base = fixture();
      base['transactions'] = [
        {
          'id': 1,
          'txn_date': '2026-10-28',
          'type': 'Other Income',
          'account': 'Cash',
          'amount': 1000,
        },
      ];
      final s = state(base);
      s['queue'] = [
        op('POST', '/api/transactions', {
          'txn_date': '2026-10-29',
          'type': 'Bank Deposit',
          'account': 'Cash',
          'amount': 100,
        }),
      ];
      final view = Ledger.project(s, strict: true);
      expect(view['dashboard']['cash_balance'], 900);
      expect(view['dashboard']['bank_balance'], 100);
      s['queue'].add(op('DELETE', '/api/transactions/-1', {}, id: 'delete'));
      final restored = Ledger.project(s, strict: true);
      expect(restored['dashboard']['cash_balance'], 1000);
      expect(restored['dashboard']['bank_balance'], 0);
    },
  );
  test(
    'invoice discount and partial payment allocation retains exact cents',
    () {
      final a = Ledger.amounts({
        'items': [
          {'quantity': 1, 'rate': .05},
          {'quantity': 1, 'rate': .05},
          {'quantity': 1, 'rate': .05},
        ],
        'discount_type': 'amount',
        'discount_value': .01,
        'paid_amount': .07,
      });
      expect(a['total_amount'], .14);
      expect(
        rows(a, 'items').fold<int>(0, (s, r) => s + cents(r['line_total'])),
        14,
      );
      expect(
        rows(a, 'items').fold<int>(0, (s, r) => s + cents(r['paid_amount'])),
        7,
      );
    },
  );
  test(
    'return uses its own day and refunds only overpayment; customer IDs remain distinct',
    () {
      final s = state();
      s['queue'] = [
        op('POST', '/api/invoices', {
          'id': 'inv',
          'sale_date': '2026-10-28',
          'customer_id': 1,
          'items': [
            {'product_id': 1, 'quantity': 2, 'rate': 100},
          ],
          'discount_type': 'amount',
          'discount_value': 0,
          'paid_amount': 150,
          'account': 'Cash',
        }),
      ];
      final first = Ledger.project(s, strict: true);
      final item = rows(rows(first, 'invoices').first, 'items').first;
      s['queue'].add(
        op('POST', '/api/invoices/inv/return', {
          'return_date': '2026-10-29',
          'reason': 'Return',
          'restock': true,
          'items': [
            {'id': item['id'], 'quantity': 1},
          ],
        }, id: 'return'),
      );
      final v = Ledger.project(s, strict: true),
          daily = rows(object(v['reports']), 'daily_sales');
      expect(daily.firstWhere((r) => r['date'] == '2026-10-28')['sales'], 200);
      expect(
        daily.firstWhere((r) => r['date'] == '2026-10-28')['received'],
        150,
      );
      expect(
        daily.firstWhere((r) => r['date'] == '2026-10-29')['return_credit'],
        100,
      );
      expect(daily.firstWhere((r) => r['date'] == '2026-10-29')['refunds'], 50);
      expect(v['dashboard']['cash_balance'], 100);
      expect(rows(v, 'products').first['current_stock'], 99);
      expect(rows(v, 'customers').first['current_due'], 0);
      s['queue'].add(
        op('POST', '/api/invoices', {
          'id': 'inv2',
          'sale_date': '2026-10-29',
          'customer_id': 2,
          'items': [
            {'product_id': 1, 'quantity': 1, 'rate': 100},
          ],
          'paid_amount': 0,
          'account': 'Cash',
        }, id: 'sale2'),
      );
      expect(
        rows(
          object(Ledger.project(s, strict: true)['reports']),
          'customer_sales',
        ).length,
        2,
      );
    },
  );
  test(
    'stock, quantity, product metadata, dates and parent history are validated before queueing',
    () {
      final base = fixture();
      for (final payload in [
        {
          'items': [
            {'product_id': 1, 'quantity': 101, 'rate': 100},
          ],
        },
        {
          'items': [
            {'product_id': 1, 'quantity': 1.2, 'rate': 100},
          ],
        },
        {
          'items': [
            {'product_id': 1, 'quantity': 1, 'rate': -1},
          ],
        },
      ]) {
        expect(
          () => Ledger.project({
            ...state(base),
            'queue': [
              op('POST', '/api/invoices', {
                'id': 'i',
                'sale_date': '2026-10-29',
                'customer_id': 1,
                'paid_amount': 0,
                'account': 'Cash',
                ...payload,
              }),
            ],
          }, strict: true),
          throwsA(anything),
        );
      }
      expect(
        () => Ledger.validate(
          base,
          op('POST', '/api/products', {
            'name': 'Bad',
            'bag_weight': -5,
            'default_rate': -100,
          }),
        ),
        throwsA(isA<AppFailure>()),
      );
      expect(
        () => Ledger.validate(
          base,
          op('POST', '/api/payments', {
            'payment_date': '2026-02-30',
            'customer_id': 1,
            'amount': 1,
            'account': 'Cash',
          }),
        ),
        throwsA(isA<AppFailure>()),
      );
      base['payments'] = [
        {'id': 3, 'customer_id': 1, 'amount': 100},
      ];
      expect(
        () => Ledger.validate(base, op('DELETE', '/api/customers/1', {})),
        throwsA(isA<AppFailure>()),
      );
    },
  );
  test(
    'zero-price return remains a real return; plain cancel reverses balances',
    () {
      final s = state();
      s['queue'] = [
        op('POST', '/api/invoices', {
          'id': 'free',
          'sale_date': '2026-10-29',
          'customer_id': 1,
          'items': [
            {'product_id': 1, 'quantity': 1, 'rate': 0},
          ],
          'paid_amount': 0,
          'account': 'Cash',
        }),
      ];
      final invoice = rows(Ledger.project(s), 'invoices').first;
      s['queue'].add(
        op('POST', '/api/invoices/free/return', {
          'return_date': '2026-10-29',
          'reason': 'free return',
          'restock': true,
          'items': [
            {'id': rows(invoice, 'items').first['id'], 'quantity': 1},
          ],
        }, id: 'r'),
      );
      final view = Ledger.project(s, strict: true);
      expect(rows(view, 'returns').length, 1);
      expect(rows(view, 'products').first['current_stock'], 100);
      s['queue'] = [
        s['queue'][0],
        op('DELETE', '/api/invoices/free', {}, id: 'cancel'),
      ];
      final cancelled = Ledger.project(s, strict: true);
      expect(rows(cancelled, 'products').first['current_stock'], 100);
      expect(rows(cancelled, 'returns'), isEmpty);
    },
  );
}
