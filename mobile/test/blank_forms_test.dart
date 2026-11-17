import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/workspace.dart';
import 'package:arafat_traders/screens/record_editor.dart';
import 'package:arafat_traders/screens/invoices.dart';
import 'package:arafat_traders/widgets/common.dart';
import 'support.dart';

Future<Workspace> showEditor(WidgetTester tester, Widget editor) async {
  final w = Workspace(
    api: FakeApi((m, p, b) async => {}),
    vault: MemoryVault(state()),
    polling: false,
  );
  await w.unlock('Samiul', 'test');
  w.ready = true;
  w.language = 'en';
  await tester.pumpWidget(
    WorkspaceScope(
      workspace: w,
      child: MaterialApp(home: editor),
    ),
  );
  await tester.pumpAndSettle();
  return w;
}

void main() {
  for (final entity in [
    'products',
    'customers',
    'orders',
    'payments',
    'transactions',
    'adjustments',
  ]) {
    testWidgets('new $entity inputs have no preset values', (tester) async {
      final w = await showEditor(tester, RecordEditor(entity: entity));
      for (final field in tester.widgetList<TextFormField>(
        find.byType(TextFormField),
      )) {
        expect(field.controller?.text ?? '', isEmpty, reason: entity);
      }
      for (final field in tester.widgetList<DropdownButtonFormField<String>>(
        find.byType(DropdownButtonFormField<String>),
      )) {
        expect(field.initialValue, isNull);
      }
      expect(tester.state<FormState>(find.byType(Form)).validate(), isFalse);
      await tester.pumpWidget(const SizedBox());
      w.dispose();
    });
  }
  test('product field names and order remain unchanged', () {
    expect(specs('products', false).map((f) => f.keyName).toList(), [
      'name',
      'product_code',
      'category',
      'feed_size',
      'protein_percent',
      'bag_weight',
      'default_rate',
      'low_stock_level',
      'opening_stock',
    ]);
  });
  testWidgets('only an explicit transfer choice derives its source account', (
    tester,
  ) async {
    final w = await showEditor(
      tester,
      const RecordEditor(entity: 'transactions'),
    );
    final type = find.byWidgetPredicate(
      (widget) =>
          widget is DropdownButton<String> &&
          (widget.items ?? []).any((item) => item.value == 'Bank Deposit'),
    );
    final account = find.byWidgetPredicate(
      (widget) =>
          widget is DropdownButton<String> &&
          (widget.items ?? []).any((item) => item.value == 'Cash'),
    );
    expect(tester.widget<DropdownButton<String>>(account).value, isNull);
    tester.widget<DropdownButton<String>>(type).onChanged!('Bank Withdraw');
    await tester.pumpAndSettle();
    expect(tester.widget<DropdownButton<String>>(account).value, 'Bank');
    expect(tester.widget<DropdownButton<String>>(account).onChanged, isNull);
    tester.widget<DropdownButton<String>>(type).onChanged!('Other Income');
    await tester.pumpAndSettle();
    expect(tester.widget<DropdownButton<String>>(account).value, isNull);
    await tester.pumpWidget(const SizedBox());
    w.dispose();
  });
  testWidgets(
    'new sale starts blank and choosing a product does not fill price or quantity',
    (tester) async {
      final w = await showEditor(tester, const SaleEditor());
      expect(
        tester
            .widget<TextFormField>(
              find.widgetWithText(TextFormField, 'Sale date'),
            )
            .controller!
            .text,
        isEmpty,
      );
      expect(find.text('Choose or add customer'), findsOneWidget);
      for (final label in ['Customer name on memo', 'Mobile', 'Address']) {
        final field = find.widgetWithText(TextFormField, label);
        await tester.scrollUntilVisible(
          field,
          250,
          scrollable: find.byType(Scrollable).first,
        );
        expect(tester.widget<TextFormField>(field).controller!.text, isEmpty);
      }
      final picker = find.text('Tap to choose product');
      await tester.scrollUntilVisible(
        picker,
        250,
        scrollable: find.byType(Scrollable).first,
      );
      await Scrollable.ensureVisible(tester.element(picker), alignment: .3);
      await tester.pumpAndSettle();
      await tester.tap(picker);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'Fish feed').first);
      await tester.pumpAndSettle();
      expect(find.byType(SaleEditor), findsOneWidget);
      expect(find.text('Choose product'), findsNothing);
      for (final label in ['Bags', 'Rate / bag', 'Discount', 'Paid amount']) {
        // The preceding product picker can leave an earlier field above the
        // viewport; inspect already-built fields before scrolling down.
        final field = find.widgetWithText(TextFormField, label);
        if (field.evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            field,
            120,
            scrollable: find.byType(Scrollable).first,
          );
        }
        expect(tester.widget<TextFormField>(field).controller!.text, isEmpty);
      }
      final list = tester.widget<ListView>(find.byType(ListView).first);
      final children =
          (list.childrenDelegate as SliverChildListDelegate).children;
      final field = children
          .whereType<DropdownButtonFormField<String>>()
          .singleWhere((field) => field.key == const ValueKey('sale-account'));
      expect(field.initialValue, isNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      w.dispose();
    },
  );
  testWidgets('product Edit retains saved fields and user alert threshold', (
    tester,
  ) async {
    final original = {
      ...fixture()['products'][0] as Map<String, dynamic>,
      'current_stock': 37,
      'low_stock_level': 9,
    };
    final w = await showEditor(
      tester,
      RecordEditor(entity: 'products', initial: original),
    );
    final field = find.widgetWithText(TextFormField, 'Low stock alert (bags)');
    await tester.ensureVisible(field);
    expect(tester.widget<TextFormField>(field).controller!.text, '9');
    expect(
      tester
          .widget<TextFormField>(
            find.widgetWithText(TextFormField, 'Product name'),
          )
          .controller!
          .text,
      'Fish feed',
    );
    await tester.pumpWidget(const SizedBox());
    w.dispose();
  });
}
