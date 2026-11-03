import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/documents.dart';
import 'package:arafat_traders/core/ledger.dart';
import 'support.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'long business headers stay inside the page and above the phone and body',
    (tester) async {
      await tester.runAsync(() async {
        await Documents.fonts();
        for (final name in [
          List.filled(15, 'Arafat Traders').join(' ').substring(0, 120),
          List.filled(15, 'আরাফাত ট্রেডার্স').join(' ').substring(0, 120),
          'X' * 120,
        ]) {
          final layout = ReceiptHeaderLayout(
            name: name,
            phone: '+8801646130402',
          );
          expect(layout.name.text!.toPlainText(), name);
          expect(layout.name.width, lessThanOrEqualTo(443));
          expect(layout.nameBounds.right, lessThanOrEqualTo(559));
          expect(layout.name.height, greaterThan(30));
          expect(layout.nameBounds.overlaps(layout.phoneBounds), false);
          expect(layout.phoneBounds.top, greaterThan(layout.nameBounds.bottom));
          expect(layout.bodyTop, greaterThan(layout.phoneBounds.bottom));
          layout.dispose();
        }
        final view = Ledger.project(state()),
            bytes = await Documents.invoice(
              {
                'invoice_no': 'LONG-NAME',
                'sale_date': '2026-10-29',
                'customer_name': 'Sample customer',
                'items': [],
                'total_amount': 0,
                'paid_amount': 0,
              },
              {
                ...view['settings'],
                'name': List.filled(8, 'Arafat Traders').join(' '),
              },
              bengali: false,
            );
        final dir = Directory('../releases/flutter-preview');
        await dir.create(recursive: true);
        await File('${dir.path}/long-business-header.pdf').writeAsBytes(bytes);
      });
    },
  );
  testWidgets(
    'native Bengali invoice renders a multi-page PDF with long notes',
    (tester) async {
      await tester.runAsync(() async {
        final s = state();
        s['queue'] = [
          op('POST', '/api/invoices', {
            'id': 'native-pdf',
            'sale_date': '2026-10-29',
            'customer_id': 1,
            'customer_name': 'কাস্টমারের নাম',
            'customer_mobile': '01700000000',
            'customer_address': 'ঢাকা, বাংলাদেশ',
            'invoice_no': 'CUSTOM-42',
            'items': [
              {'product_id': 1, 'quantity': 1, 'rate': 100},
            ],
            'paid_amount': 50,
            'account': 'Cash',
            'notes': List.filled(200, 'এটি বাংলা নোট।').join('\n'),
          }),
        ];
        final view = Ledger.project(s, strict: true),
            bytes = await Documents.invoice(
              view['invoices'][0],
              view['settings'],
              bengali: true,
            );
        expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
        expect(bytes.length, greaterThan(20000));
        final dir = Directory('../releases/flutter-preview');
        await dir.create(recursive: true);
        await File('${dir.path}/native-invoice-bn.pdf').writeAsBytes(bytes);
      });
    },
  );
}
