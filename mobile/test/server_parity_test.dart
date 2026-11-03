import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/ledger.dart';
import 'package:arafat_traders/core/types.dart';

void main() {
  final fixtures =
      (jsonObject(
                '{"cases":${File('test/fixtures/server-parity.json').readAsStringSync()}}',
              )['cases']
              as List)
          .map(object);
  for (final f in fixtures) {
    test('Flutter matches existing server: ${f['name']}', () {
      final actual = Ledger.project({
            'base': f['before'],
            'queue': [f['operation']],
            'ids': <String, dynamic>{},
          }, strict: true),
          expected = object(f['expected']);
      for (final field in [
        'cash_balance',
        'bank_balance',
        'customer_due',
        'company_payable',
        'current_stock',
      ]) {
        expect(
          actual['dashboard'][field],
          expected['dashboard'][field],
          reason: field,
        );
      }
      for (final product in rows(expected, 'products')) {
        expect(
          Ledger.find(
            rows(actual, 'products'),
            product['id'],
          )?['current_stock'],
          product['current_stock'],
          reason: 'Stock ${product['id']}',
        );
      }
      for (final customer in rows(expected, 'customers')) {
        expect(
          Ledger.find(
            rows(actual, 'customers'),
            customer['id'],
          )?['current_due'],
          customer['current_due'],
          reason: 'Customer ${customer['id']}',
        );
      }
      for (final invoice in rows(expected, 'invoices')) {
        final found = Ledger.find(rows(actual, 'invoices'), invoice['id']);
        for (final field in ['net_total', 'net_paid', 'due_amount']) {
          expect(found?[field], invoice[field], reason: 'Invoice $field');
        }
      }
    });
  }
}
