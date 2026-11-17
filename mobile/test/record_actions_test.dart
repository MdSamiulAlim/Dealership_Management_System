import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/ledger.dart';
import 'package:arafat_traders/core/types.dart';
import 'package:arafat_traders/core/workspace.dart';
import 'package:arafat_traders/screens/activity.dart';
import 'package:arafat_traders/screens/record_editor.dart';
import 'package:arafat_traders/widgets/common.dart';
import 'support.dart';

void main() {
  final order = <String, dynamic>{
    'id': 1,
    'product_id': 1,
    'product_name': 'Fish feed',
    'order_date': '2026-11-16',
    'quantity': 5,
    'bag_weight': 25,
    'rate': 100,
    'total_amount': 500,
    'status': 'Delivered',
    'delivery_date': '2026-11-16',
    'invoice_no': 'O-1',
    'notes': '',
  };
  final transfer = <String, dynamic>{
    'id': 2,
    'transfer_id': 'transfer-1',
    'txn_date': '2026-11-16',
    'type': 'Bank Deposit',
    'amount': 100,
    'account': 'Cash',
    'notes': '',
  };
  final partner = <String, dynamic>{...transfer, 'id': 3, 'account': 'Bank'};

  test('offline order edit recalculates stock and payable', () {
    final base = fixture();
    base['orders'] = [order];
    final s = state(base);
    s['queue'] = [
      op('PATCH', '/api/orders/1', {
        ...order,
        'quantity': 8,
        'rate': 150,
        'total_amount': 1200,
        'original': order,
        'confirmed': true,
      }),
    ];
    final view = Ledger.project(s, strict: true);
    expect(rows(view, 'products').single['current_stock'], 108);
    expect(view['dashboard']['company_payable'], 1200);
  });
  test(
    'offline adjustment edits reject a stock reduction and product move beyond stock',
    () {
      final base = fixture();
      base['products'] = [
        ...rows(base, 'products'),
        {...rows(base, 'products').first, 'id': 2, 'opening_stock': 0},
      ];
      final old = <String, dynamic>{
        'id': 1,
        'product_id': 1,
        'adjust_date': '2026-11-16',
        'quantity': 4,
        'type': 'Manual Minus',
        'notes': 'Count',
      };
      base['adjustments'] = [old];
      for (final changes in [
        {'quantity': 101},
        {'product_id': 2},
        {'quantity': 1.5},
      ]) {
        final s = state(base);
        s['queue'] = [
          op('PATCH', '/api/adjustments/1', {
            ...old,
            ...changes,
            'original': old,
            'confirmed': true,
          }),
        ];
        expect(() => Ledger.project(s, strict: true), throwsA(anything));
      }
    },
  );
  test(
    'offline transfer edit changes both sides and preserves combined balance',
    () {
      final base = fixture();
      base['transactions'] = [
        {
          'id': 1,
          'txn_date': '2026-11-16',
          'type': 'Other Income',
          'amount': 1000,
          'account': 'Cash',
        },
        transfer,
        partner,
      ];
      final s = state(base);
      s['queue'] = [
        op('PATCH', '/api/transactions/2', {
          ...transfer,
          'amount': 250,
          'original': transfer,
          'original_transfer': partner,
          'confirmed': true,
        }),
      ];
      final view = Ledger.project(s, strict: true);
      expect(view['dashboard']['cash_balance'], 750);
      expect(view['dashboard']['bank_balance'], 250);
      expect(
        rows(view, 'transactions')
            .where((r) => r['transfer_id'] == 'transfer-1')
            .every((r) => r['amount'] == 250),
        isTrue,
      );
      final bad = clone(s);
      bad['queue'][0]['payload']['original_transfer']['amount'] = 99;
      expect(
        () => Ledger.project(bad, strict: true),
        throwsA(isA<AppFailure>()),
      );
    },
  );
  for (final kind in ['orders', 'transactions', 'adjustments']) {
    testWidgets('$kind list exposes a working Edit action', (tester) async {
      final base = fixture();
      base['orders'] = [order];
      base['transactions'] = [
        {
          'id': 1,
          'txn_date': '2026-11-16',
          'type': 'Company Payment',
          'amount': 25,
          'account': 'Cash',
          'notes': '',
        },
      ];
      base['adjustments'] = [
        {
          'id': 1,
          'product_id': 1,
          'product_name': 'Fish feed',
          'adjust_date': '2026-11-16',
          'quantity': 1,
          'type': 'Manual Add',
          'notes': 'Count',
        },
      ];
      final w = Workspace(
        api: FakeApi((m, p, b) async => {}),
        vault: MemoryVault(state(base)),
        polling: false,
      );
      await w.unlock('Samiul', 'test');
      w.ready = true;
      w.language = 'en';
      await tester.pumpWidget(
        WorkspaceScope(
          workspace: w,
          child: MaterialApp(
            home: Scaffold(body: ActivityScreen(kind: kind)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final edit = find.widgetWithText(TextButton, 'Edit');
      await tester.ensureVisible(edit);
      await tester.tap(edit);
      await tester.pumpAndSettle();
      expect(find.byType(RecordEditor), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      w.dispose();
    });
  }
}
