import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/ledger.dart';
import 'package:arafat_traders/core/types.dart';
import 'support.dart';

void main() {
  for (final raw
      in jsonDecode(
            File('test/fixtures/allocation-cases.json').readAsStringSync(),
          )
          as List) {
    final c = object(raw);
    test('exact allocation ${c['total']} cents', () {
      expect(
        Ledger.allocate(c['total'] as int, (c['weights'] as List).cast<int>()),
        c['expected'],
      );
    }, timeout: const Timeout(Duration(seconds: 2)));
  }
  test('111 invoice and 37 payment agree with server to the last paisa', () {
    final a = Ledger.amounts({
      'items': [
        for (final rate in [1, 10, 100])
          {'product_id': 1, 'quantity': 1, 'rate': rate},
      ],
      'paid_amount': 37,
    });
    expect(rows(a, 'items').map((i) => i['paid_amount']).toList(), [
      .34,
      3.33,
      33.33,
    ]);
  });
  test(
    'large supported invoices calculate immediately; oversized arithmetic fails before allocation',
    () {
      final a = Ledger.amounts({
        'items': [
          {'product_id': 1, 'quantity': 1, 'rate': 5e11},
          {'product_id': 1, 'quantity': 1, 'rate': 5e11},
        ],
        'paid_amount': 1e12,
      });
      expect(rows(a, 'items').map((r) => r['paid_amount']).toList(), [
        5e11,
        5e11,
      ]);
      for (final items in [
        [
          {'product_id': 1, 'quantity': 1e12, 'rate': 1e12},
        ],
        [
          {'product_id': 1, 'quantity': 1, 'rate': 1e12},
          {'product_id': 1, 'quantity': 1, 'rate': 1e12},
        ],
      ]) {
        expect(
          () => Ledger.amounts({'items': items}),
          throwsA(isA<AppFailure>()),
        );
      }
    },
    timeout: const Timeout(Duration(seconds: 2)),
  );
  final invalid =
      jsonDecode(File('test/fixtures/invalid-inputs.json').readAsStringSync())
          as List;
  for (var i = 0; i < invalid.length; i++) {
    final c = object(invalid[i]);
    test('server-invalid input $i (${c['entity']}) is rejected offline', () {
      final p = jsonObject(
        jsonEncode(
          c['payload'],
        ).replaceAll('"\$product"', '1').replaceAll('"\$customer"', '1'),
      );
      expect(
        () => Ledger.project({
          ...state(),
          'queue': [op('POST', '/api/${c['entity']}', p)],
        }, strict: true),
        throwsA(anything),
      );
    });
  }
  test(
    'valid default bag weight, rounded rates and signed opening balance still work',
    () {
      expect(
        () => Ledger.validate(
          fixture(),
          op('POST', '/api/orders', {
            'order_date': '2026-10-29',
            'product_id': 1,
            'quantity': 2,
            'rate': 100,
            'status': 'Delivered',
            'total_amount': 200,
          }),
        ),
        returnsNormally,
      );
      expect(
        () => Ledger.validate(
          fixture(),
          op('POST', '/api/customers', {
            'name': 'Credit customer',
            'opening_due': -100,
          }),
        ),
        returnsNormally,
      );
      expect(
        Ledger.amounts({
          'items': [
            {'product_id': 1, 'quantity': 3, 'rate': 1.005},
          ],
          'paid_amount': 0,
        })['total_amount'],
        3.03,
      );
    },
  );
  test(
    'synced item order follows sale IDs rather than random item UUID order',
    () {
      final base = fixture();
      base['invoices'] = [
        {
          'id': 'synced',
          'status': 'active',
          'paid_amount': 37,
          'total_amount': 111,
          'customer_id': 1,
          'sale_date': '2026-10-29',
          'items': [
            {'id': 'a-uuid', 'sale_id': 3, 'quantity': 1, 'line_total': 100},
            {'id': 'z-uuid', 'sale_id': 1, 'quantity': 1, 'line_total': 1},
            {'id': 'm-uuid', 'sale_id': 2, 'quantity': 1, 'line_total': 10},
          ],
        },
      ];
      final view = Ledger.project(state(base));
      expect(
        rows(
          rows(view, 'invoices').single,
          'items',
        ).map((i) => i['sale_id']).toList(),
        [1, 2, 3],
      );
    },
  );
  test(
    'offline return allocates payments in server order even after UUID-ordered sync',
    () {
      final base = fixture(), rates = [1, 10, 100];
      base['invoices'] = [
        {
          'id': 'ret-alloc',
          'status': 'active',
          'customer_id': 1,
          'account': 'Cash',
          'sale_date': '2026-10-28',
          'subtotal': 222,
          'total_amount': 222,
          'paid_amount': 74,
          'version': 1,
          'items': [
            for (var n = 0; n < 3; n++)
              {
                'id': 'item-$n',
                'sale_id': n + 1,
                'product_id': 1,
                'quantity': 2,
                'rate': rates[n],
                'line_total': rates[n] * 2,
                'returned_quantity': 0,
              },
          ],
        },
      ];
      base['sales'] = [
        for (var n = 0; n < 3; n++)
          {
            'id': n + 1,
            'customer_id': 1,
            'product_id': 1,
            'account': 'Cash',
            'sale_date': '2026-10-28',
            'quantity': 2,
            'total_amount': rates[n] * 2,
            'paid_amount': 0,
          },
      ];
      base['invoices'][0]['items'] = (base['invoices'][0]['items'] as List)
          .reversed
          .toList();
      final view = Ledger.project({
        ...state(base),
        'queue': [
          op('POST', '/api/invoices/ret-alloc/return', {
            'return_date': '2026-10-29',
            'reason': 'Test',
            'restock': true,
            'confirmed': true,
            'items': [
              for (var n = 0; n < 3; n++) {'id': 'item-$n', 'quantity': 1},
            ],
          }),
        ],
      }, strict: true);
      expect(rows(view, 'sales').map((r) => r['paid_amount']).toList(), [
        .67,
        6.67,
        66.66,
      ]);
    },
  );
}
