import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:arafat_traders/core/documents.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:arafat_traders/main.dart';
import 'package:arafat_traders/core/workspace.dart';
import 'package:arafat_traders/widgets/common.dart';
import 'package:arafat_traders/screens/invoices.dart';
import 'package:arafat_traders/screens/record_editor.dart';
import 'support.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('bn');
    await Documents.fonts();
    final flutterRoot = Platform.environment['FLUTTER_ROOT'];
    if (flutterRoot != null) {
      final file = File(
        '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
      );
      if (await file.exists()) {
        await (FontLoader('MaterialIcons')..addFont(
              Future.value(ByteData.sublistView(await file.readAsBytes())),
            ))
            .load();
      }
    }
  });
  for (final language in ['en', 'bn']) {
    for (final destination in destinations) {
      testWidgets('${destination.en} native screen fits phone in $language', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
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
        w.language = language;
        await tester.pumpWidget(
          WorkspaceScope(
            workspace: w,
            child: MaterialApp(
              locale: Locale(language),
              supportedLocales: const [Locale('en'), Locale('bn')],
              localizationsDelegates: GlobalMaterialLocalizations.delegates,
              home: Scaffold(body: destination.screen),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        w.dispose();
      });
    }
  }
  for (final entity in [
    'products',
    'customers',
    'orders',
    'payments',
    'transactions',
    'adjustments',
  ]) {
    testWidgets('$entity create form fits phone', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
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
      await tester.pumpWidget(
        WorkspaceScope(
          workspace: w,
          child: MaterialApp(home: RecordEditor(entity: entity)),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      w.dispose();
    });
  }
  testWidgets('native sale editor fits phone and captures preview', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
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
    final key = GlobalKey();
    await tester.pumpWidget(
      WorkspaceScope(
        workspace: w,
        child: MaterialApp(
          theme: ThemeData(
            useMaterial3: true,
            fontFamily: 'Manrope',
            fontFamilyFallback: const ['NotoBengali'],
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xff006b50),
            ),
          ),
          home: RepaintBoundary(key: key, child: const SaleEditor()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.runAsync(() async {
      final image =
          await (key.currentContext!.findRenderObject()
                  as RenderRepaintBoundary)
              .toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await Directory('../releases/flutter-preview').create(recursive: true);
      await File(
        '../releases/flutter-preview/native-sale.png',
      ).writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
    await tester.pumpWidget(const SizedBox());
    w.dispose();
  });
}
