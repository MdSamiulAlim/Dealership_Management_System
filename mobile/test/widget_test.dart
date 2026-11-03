import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:arafat_traders/main.dart';
import 'package:arafat_traders/core/workspace.dart';
import 'support.dart';
import 'package:arafat_traders/widgets/common.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('bn');
  });
  testWidgets(
    'decimal quantity paste is rejected instead of becoming fifteen bags',
    (tester) async {
      final w = Workspace(
            api: FakeApi((m, p, b) async => {}),
            vault: MemoryVault(),
            polling: false,
          ),
          control = TextEditingController(text: '1');
      await tester.pumpWidget(
        WorkspaceScope(
          workspace: w,
          child: MaterialApp(
            home: Scaffold(
              body: NumberField(
                controller: control,
                label: 'Bags',
                integer: true,
              ),
            ),
          ),
        ),
      );
      await tester.enterText(find.byType(TextFormField), '1.5');
      expect(control.text, '1');
      await tester.enterText(find.byType(TextFormField), '15');
      expect(control.text, '15');
      await tester.pumpWidget(const SizedBox());
      control.dispose();
      w.dispose();
    },
  );
  testWidgets('native login changes language and toggles password visibility', (
    tester,
  ) async {
    final w = Workspace(
      api: FakeApi((m, p, b) async => {}),
      vault: MemoryVault(),
      polling: false,
    );
    w.ready = true;
    w.language = 'en';
    await tester.pumpWidget(ArafatApp(workspace: w));
    expect(find.text('Sign in'), findsOneWidget);
    final password = find.byType(TextFormField).last;
    expect(tester.widget<TextFormField>(password).initialValue, '');
    expect(
      tester.widget<EditableText>(find.byType(EditableText).last).obscureText,
      true,
    );
    await tester.tap(find.byTooltip('Show password'));
    await tester.pump();
    expect(
      tester.widget<EditableText>(find.byType(EditableText).last).obscureText,
      false,
    );
    await tester.tap(find.text('বাংলা'));
    await tester.pumpAndSettle();
    expect(find.text('লগইন'), findsOneWidget);
    expect(find.text('ইউজার আইডি'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    w.dispose();
  });
  for (final width in [390.0, 800.0, 1200.0]) {
    testWidgets('native dashboard and menu fit ${width.toInt()}px', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final w = Workspace(
        api: FakeApi((m, p, b) async => {}),
        vault: MemoryVault(state()),
        polling: false,
      );
      await w.unlock('Samiul', 'test');
      w.ready = true;
      w.language = 'en';
      await tester.pumpWidget(ArafatApp(workspace: w));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Business overview'), findsOneWidget);
      expect(tester.takeException(), isNull);
      if (width < 1100) {
        await tester.tap(find.text('More'));
        await tester.pumpAndSettle();
        expect(find.text('Settings & backup'), findsOneWidget);
        expect(find.text('Expenses'), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
      await tester.pumpWidget(const SizedBox());
      w.dispose();
    });
  }
}
