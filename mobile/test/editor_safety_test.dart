import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:arafat_traders/core/ledger.dart';
import 'package:arafat_traders/core/types.dart';
import 'package:arafat_traders/core/workspace.dart';
import 'package:arafat_traders/main.dart';
import 'package:arafat_traders/screens/invoices.dart';
import 'package:arafat_traders/screens/record_editor.dart';
import 'support.dart';

Json invoice() {
  final s = state();
  s['queue'] = [
    op('POST', '/api/invoices', {
      'id': 'private-invoice',
      'invoice_no': 'MEMO-PRIVATE',
      'sale_date': '2026-10-29',
      'customer_id': 1,
      'customer_name': 'Private Customer',
      'customer_mobile': '01700000000',
      'items': [
        {'product_id': 1, 'quantity': 20, 'rate': 100},
      ],
      'paid_amount': 0,
      'account': 'Cash',
    }),
  ];
  return rows(Ledger.project(s), 'invoices').single;
}

Future<Workspace> openEditor(
  WidgetTester tester,
  Widget editor, {
  FakeApi? api,
}) async {
  final w = Workspace(
    api: api ?? FakeApi((m, p, b) async => {}),
    vault: MemoryVault(state()),
    polling: false,
  );
  await w.unlock('Samiul', 'test');
  w.ready = true;
  w.language = 'en';
  await tester.pumpWidget(ArafatApp(workspace: w));
  await tester.pumpAndSettle();
  final navigator = Navigator.of(tester.element(find.byType(AppShell)));
  navigator.push(MaterialPageRoute<void>(builder: (_) => editor));
  await tester.pumpAndSettle();
  return w;
}

void main() {
  setUpAll(() async => initializeDateFormatting('bn'));
  for (final kind in ['customer', 'invoice']) {
    testWidgets(
      '$kind text-only edits prompt on Back; Cancel keeps text; Confirm discards',
      (tester) async {
        final editor = kind == 'customer'
            ? const RecordEditor(
                entity: 'customers',
                initial: {
                  'id': 1,
                  'name': 'Private Customer',
                  'mobile': '01700000000',
                  'address': 'Private Address',
                  'opening_due': 0,
                },
              )
            : SaleEditor(invoice: invoice());
        final w = await openEditor(tester, editor);
        final label = kind == 'customer'
            ? 'Customer name'
            : 'Customer name on memo';
        await tester.enterText(
          find.widgetWithText(TextFormField, label),
          'Changed private name',
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byType(BackButton).first);
        await tester.pumpAndSettle();
        expect(find.text('Discard changes?'), findsOneWidget);
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(find.text('Changed private name'), findsWidgets);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.text('Discard changes?'), findsOneWidget);
        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();
        expect(find.text('Changed private name'), findsNothing);
        expect(find.byType(AppShell), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
        w.dispose();
      },
    );
  }
  testWidgets('opening a clean customer editor can go Back without a warning', (
    tester,
  ) async {
    final w = await openEditor(
      tester,
      const RecordEditor(
        entity: 'customers',
        initial: {'id': 1, 'name': 'Private Customer'},
      ),
    );
    await tester.tap(find.byType(BackButton).first);
    await tester.pumpAndSettle();
    expect(find.text('Discard changes?'), findsNothing);
    expect(find.byType(AppShell), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    w.dispose();
  });
  testWidgets(
    'Return rejects decimal paste and also validates fractional controller values',
    (tester) async {
      final w = await openEditor(tester, ReturnEditor(invoice: invoice()));
      final field = find.widgetWithText(TextFormField, 'Return bags');
      await tester.enterText(field, '1');
      await tester.enterText(field, '1.5');
      await tester.pump();
      final textField = find.descendant(
        of: field,
        matching: find.byType(TextField),
      );
      final controller = tester.widget<TextField>(textField).controller!;
      expect(controller.text, '1');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Reason'),
        'Test return',
      );
      controller.text = '1.5';
      await tester.pump();
      final form = tester.state<FormState>(find.byType(Form));
      expect(form.validate(), false);
      await tester.pump();
      expect(find.text('Enter a valid amount'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      w.dispose();
    },
  );
  testWidgets(
    'oversized invoice Full payment reports validation and keeps the editor responsive',
    (tester) async {
      final large = invoice();
      large['items'][0]['rate'] = 1e12;
      final w = await openEditor(tester, SaleEditor(invoice: large));
      await tester.scrollUntilVisible(
        find.text('Full payment'),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Full payment'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byType(SaleEditor), findsOneWidget);
      expect(find.text('Enter a valid amount or quantity.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      w.dispose();
    },
  );
  testWidgets(
    'expired session removes an open private editor and dialogs, including Back history',
    (tester) async {
      final api = FakeApi(
        (m, p, b) async => throw const AppFailure('expired', status: 401),
      );
      final w = await openEditor(
        tester,
        const RecordEditor(
          entity: 'customers',
          initial: {
            'id': 1,
            'name': 'Private Customer',
            'address': 'Secret address',
            'mobile': '01700000000',
          },
        ),
        api: api,
      );
      expect(find.text('Private Customer'), findsOneWidget);
      final editorContext = tester.element(find.byType(RecordEditor));
      showDialog<void>(
        context: editorContext,
        builder: (_) => const AlertDialog(content: Text('Private dialog')),
      );
      await tester.pumpAndSettle();
      await expectLater(
        w.api.request('GET', '/api/check-login'),
        throwsA(isA<AppFailure>()),
      );
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(RecordEditor), findsNothing);
      expect(find.text('Private Customer'), findsNothing);
      expect(find.text('Private dialog'), findsNothing);
      expect(find.text('Secret address'), findsNothing);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      w.dispose();
    },
  );
}
