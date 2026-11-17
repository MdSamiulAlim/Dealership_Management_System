import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/ledger.dart';
import 'package:arafat_traders/core/types.dart';
import 'support.dart';

void main() {
  final cases =
      jsonDecode(File('test/fixtures/percentage-cases.json').readAsStringSync())
          as List;
  for (final raw in cases) {
    final c = object(raw);
    test('${c['rates']} at ${c['percent']}% rounds half up', () {
      final result = Ledger.amounts({
        'items': [
          for (final rate in c['rates'])
            {'product_id': 1, 'quantity': 1, 'rate': rate},
        ],
        'discount_type': 'percent',
        'discount_value': c['percent'],
        'paid_amount': 0,
      });
      expect(result['discount'], number(c['discount_cents']) / 100);
      expect(result['total_amount'], number(c['total_cents']) / 100);
      expect(
        rows(
          result,
          'items',
        ).fold<int>(0, (n, r) => n + cents(r['line_total'])),
        c['total_cents'],
      );
    });
  }
  test('pending invoice projection uses the same discount, total and due', () {
    final s = state();
    s['queue'] = [
      op('POST', '/api/invoices', {
        'id': 'percent-invoice',
        'sale_date': '2026-11-17',
        'customer_id': 1,
        'items': [
          {'product_id': 1, 'quantity': 1, 'rate': 50},
        ],
        'discount_type': 'percent',
        'discount_value': .57,
        'paid_amount': 37,
        'account': 'Cash',
      }),
    ];
    final view = Ledger.project(s, strict: true),
        invoice = rows(view, 'invoices').single;
    expect(invoice['discount'], .29);
    expect(invoice['total_amount'], 49.71);
    expect(invoice['due_amount'], 12.71);
    expect(rows(view, 'sales').single['total_amount'], 49.71);
  });
}
