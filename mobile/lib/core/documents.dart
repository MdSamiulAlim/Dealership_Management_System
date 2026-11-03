import 'dart:convert';
import 'dart:ui' as ui;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';
import 'types.dart';

class Documents {
  static bool _fontsReady = false;
  static Future<void> fonts() async {
    if (_fontsReady) return;
    for (final entry in {
      'Manrope': 'manrope.ttf',
      'NotoBengali': 'noto-bengali.ttf',
    }.entries) {
      await (FontLoader(
        entry.key,
      )..addFont(rootBundle.load('assets/fonts/${entry.value}'))).load();
    }
    _fontsReady = true;
  }

  static Future<Uint8List> invoice(
    Json invoice,
    Json settings, {
    bool bengali = false,
  }) async {
    final painter = await _ReceiptPainter.create(bengali);
    String t(String en, String bn) => bengali ? bn : en;
    await painter.header(
      settings,
      t('Invoice', 'ইনভয়েস'),
      text(invoice['invoice_no']),
    );
    await painter.write('${t('Date', 'তারিখ')}: ${invoice['sale_date']}');
    if (invoice['draft'] == true || invoice['pending'] == true) {
      await painter.write(
        t('DRAFT / PENDING SYNC', 'খসড়া / Sync অপেক্ষমাণ'),
        bold: true,
        color: const Color(0xff805000),
      );
    }
    if (invoice['status'] == 'void') {
      await painter.write(
        t('CANCELLED', 'বাতিল'),
        bold: true,
        color: const Color(0xffba1a1a),
      );
    }
    await painter.write(
      '${t('Customer', 'কাস্টমার')}: ${invoice['customer_name']}',
      bold: true,
    );
    if (text(invoice['customer_mobile']).isNotEmpty) {
      await painter.write(text(invoice['customer_mobile']));
    }
    if (text(invoice['customer_address']).isNotEmpty) {
      await painter.write(text(invoice['customer_address']));
    }
    painter.space(10);
    painter.rule();
    await painter.write(
      t(
        'Product · Quantity × Rate · Net amount',
        'পণ্য · পরিমাণ × দর · নিট মূল্য',
      ),
      bold: true,
    );
    for (final item in rows(invoice, 'items')) {
      await painter.write(
        '${item['product_name']} ${text(item['product_code']).isEmpty ? '' : '[${item['product_code']}]'}',
        bold: true,
      );
      await painter.write(
        '${painter.qty(item['quantity'])} ${t('bags', 'বস্তা')} × ${painter.cash(item['rate'])}  =  ${painter.cash(item['line_total'])}',
      );
      if (number(item['returned_quantity']) > 0) {
        await painter.write(
          '${t('Returned', 'ফেরত')}: ${painter.qty(item['returned_quantity'])}',
        );
      }
      painter.space(6);
      painter.rule();
    }
    final cancelled = invoice['status'] == 'void';
    final total = cancelled
        ? 0
        : money(
            number(invoice['total_amount']) - number(invoice['returned_total']),
          );
    final paid = cancelled
        ? 0
        : money(number(invoice['paid_amount']) - number(invoice['refunded']));
    for (final row in [
      [t('Subtotal', 'ছাড়ের আগের মোট'), invoice['subtotal']],
      [t('Discount', 'ছাড়'), invoice['discount']],
      [t('Return credit', 'ফেরতের সমন্বয়'), invoice['returned_total'] ?? 0],
      [t('Total', 'মোট'), total],
      [t('Paid', 'পরিশোধ'), paid],
      [t('Refunded', 'ফেরত দেওয়া টাকা'), invoice['refunded'] ?? 0],
      [t('Due', 'বাকি'), money(total - paid)],
    ]) {
      await painter.write('${row[0]}: ${painter.cash(row[1])}', bold: true);
    }
    if (text(invoice['notes']).isNotEmpty) {
      painter.space(10);
      await painter.write('${t('Notes', 'নোট')}: ${invoice['notes']}');
    }
    painter.space(12);
    await painter.write(
      t(
        'Separate customer collections appear in the customer account.',
        'আলাদা আদায় কাস্টমারের হিসাবে দেখানো হয়।',
      ),
    );
    return painter.finish();
  }

  static Future<Uint8List> due(
    Json statement,
    Json settings, {
    bool bengali = false,
  }) async {
    final p = await _ReceiptPainter.create(bengali);
    String t(String en, String bn) => bengali ? bn : en;
    final customer = object(statement['customer']);
    await p.header(
      settings,
      t('Customer due statement', 'কাস্টমারের বকেয়া বিবরণী'),
      'CD-${customer['id']}',
    );
    await p.write(text(customer['name']), bold: true);
    await p.write(text(customer['mobile']));
    await p.write(text(customer['address']));
    await p.write(
      '${t('Opening balance', 'শুরুর বাকি')}: ${p.cash(statement['opening_balance'])}',
    );
    p.space(12);
    p.rule();
    for (final entry in rows(statement, 'entries')) {
      await p.write('${entry['date']} · ${entry['reference']}', bold: true);
      await p.write(
        '${t('Debit', 'যোগ')}: ${p.cash(entry['debit'])}  ·  ${t('Credit', 'কমা')}: ${p.cash(entry['credit'])}',
      );
      await p.write('${t('Balance', 'জের')}: ${p.cash(entry['balance'])}');
      p.rule();
    }
    await p.write(
      '${t('Total due', 'মোট বাকি')}: ${p.cash(statement['due'])}',
      bold: true,
    );
    if (number(statement['credit']) > 0) {
      await p.write(
        '${t('Customer credit', 'কাস্টমারের জমা')}: ${p.cash(statement['credit'])}',
        bold: true,
      );
    }
    return p.finish();
  }

  static Future<void> saveBytes(
    String name,
    Uint8List bytes, {
    String extension = 'pdf',
  }) async {
    await FilePicker.saveFile(
      dialogTitle: 'Arafat Traders',
      fileName: name,
      bytes: bytes,
      mimeType: extension == 'pdf'
          ? 'application/pdf'
          : extension == 'json'
          ? 'application/json'
          : 'text/csv',
    );
  }

  static Future<void> printPdf(Uint8List bytes) => Printing.layoutPdf(
    onLayout: (_) => bytes,
    name: 'Arafat Traders',
  ).then((_) {});
  static Future<void> share(
    Uint8List bytes,
    String name, {
    String? text,
  }) async {
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile.fromData(bytes, mimeType: 'application/pdf', name: name)],
        fileNameOverrides: [name],
        text: text,
      ),
    );
  }

  static Future<void> saveJson(String name, String value) => saveBytes(
    name,
    Uint8List.fromList(utf8.encode(value)),
    extension: 'json',
  );
  static Future<void> saveCsv(
    String name,
    List<String> headings,
    List<List<dynamic>> rows,
  ) async {
    String cell(dynamic v) {
      var s = text(v);
      if (v is! num && RegExp(r'^[=+\-@]').hasMatch(s)) s = "'$s";
      return '"${s.replaceAll('"', '""')}"';
    }

    final csv = [
      headings.map(cell).join(','),
      ...rows.map((r) => r.map(cell).join(',')),
    ].join('\r\n');
    await saveBytes(
      name,
      Uint8List.fromList(utf8.encode('\ufeff$csv')),
      extension: 'csv',
    );
  }
}

// Flutter's text shaper renders Bengali glyph clusters natively. Raster pages
// preserve the exact native layout in offline PDFs without HTML or WebViews.
class _ReceiptPainter {
  _ReceiptPainter(this.bengali);
  final bool bengali;
  late ui.PictureRecorder recorder;
  late Canvas canvas;
  double y = 36;
  final pages = <Uint8List>[];
  int pageNumber = 0;
  static Future<_ReceiptPainter> create(bool bn) async {
    await Documents.fonts();
    final result = _ReceiptPainter(bn);
    result._start();
    return result;
  }

  String cash(dynamic n) => NumberFormat.currency(
    locale: bengali ? 'bn_BD' : 'en_BD',
    symbol: '৳',
    decimalDigits: 2,
  ).format(number(n));
  String qty(dynamic n) =>
      NumberFormat('#,##0.##', bengali ? 'bn_BD' : 'en_BD').format(number(n));
  TextPainter _layout(
    String value, {
    bool bold = false,
    Color color = const Color(0xff14231d),
    double size = 12,
  }) => _receiptText(value, bold: bold, color: color, size: size);
  void _start() {
    recorder = ui.PictureRecorder();
    canvas = Canvas(recorder)..scale(2);
    canvas.drawColor(Colors.white, BlendMode.src);
    y = 36;
    pageNumber++;
  }

  Future<void> _end() async {
    _layout(
      'Powered by Samiul Alim (Software Engineer) · $pageNumber',
      size: 9,
    ).paint(canvas, const Offset(36, 808));
    final picture = recorder.endRecording(),
        image = await picture.toImage(1190, 1684);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    pages.add(data!.buffer.asUint8List());
    image.dispose();
    picture.dispose();
  }

  Future<void> header(Json settings, String label, String reference) async {
    final data = (await rootBundle.load(
      'assets/brand/arafat-growth-logo.png',
    )).buffer.asUint8List();
    final codec = await ui.instantiateImageCodec(data, targetWidth: 140),
        frame = await codec.getNextFrame();
    canvas.drawImageRect(
      frame.image,
      Rect.fromLTWH(
        0,
        0,
        frame.image.width.toDouble(),
        frame.image.height.toDouble(),
      ),
      const Rect.fromLTWH(36, 30, 65, 65),
      Paint(),
    );
    frame.image.dispose();
    codec.dispose();
    final header = ReceiptHeaderLayout(
      name: text(settings['name']).isEmpty
          ? 'Arafat Traders'
          : text(settings['name']),
      phone: text(settings['phone']).isEmpty
          ? '+8801646130402'
          : text(settings['phone']),
    );
    header.name.paint(canvas, header.nameBounds.topLeft);
    header.phone.paint(canvas, header.phoneBounds.topLeft);
    y = header.bodyTop;
    header.dispose();
    if (text(settings['address']).isNotEmpty) {
      await write(text(settings['address']));
    }
    await write(label, bold: true, size: 17);
    await write(reference, bold: true);
    space(6);
  }

  Future<void> write(
    String value, {
    bool bold = false,
    Color color = const Color(0xff14231d),
    double size = 12,
  }) async {
    if (value.isEmpty) return;
    final paragraph = _layout(value, bold: bold, color: color, size: size);
    var consumed = 0.0;
    while (consumed < paragraph.height) {
      if (y > 760) {
        await _end();
        _start();
      }
      final available = 780 - y,
          remaining = paragraph.height - consumed,
          paintHeight = remaining < available ? remaining : available;
      canvas.save();
      canvas.clipRect(Rect.fromLTWH(36, y, 523, paintHeight));
      paragraph.paint(canvas, Offset(36, y - consumed));
      canvas.restore();
      consumed += paintHeight;
      y += paintHeight;
      if (consumed < paragraph.height) {
        await _end();
        _start();
      }
    }
    y += 5;
    paragraph.dispose();
  }

  void space(double value) => y += value;
  void rule() {
    canvas.drawLine(
      Offset(36, y),
      Offset(559, y),
      Paint()..color = const Color(0xffc1cfc7),
    );
    y += 9;
  }

  Future<Uint8List> finish() async {
    await _end();
    final pdf = pw.Document();
    for (final page in pages) {
      pdf.addPage(
        pw.Page(
          pageFormat: PdfPageFormat.a4,
          margin: pw.EdgeInsets.zero,
          build: (_) => pw.Image(pw.MemoryImage(page), fit: pw.BoxFit.fill),
        ),
      );
    }
    return pdf.save();
  }
}

TextPainter _receiptText(
  String value, {
  bool bold = false,
  Color color = const Color(0xff14231d),
  double size = 12,
  double width = 523,
}) => TextPainter(
  text: TextSpan(
    text: value,
    style: TextStyle(
      fontFamily: 'Manrope',
      fontFamilyFallback: const ['NotoBengali'],
      fontSize: size,
      height: 1.5,
      fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
      color: color,
    ),
  ),
  textDirection: ui.TextDirection.ltr,
)..layout(maxWidth: width);

// The logo occupies the left column. Text is measured inside the remaining
// page width, and every following block starts after the complete heading.
class ReceiptHeaderLayout {
  ReceiptHeaderLayout({required String name, required String phone})
    : name = _receiptText(name, bold: true, size: 20, width: 443),
      phone = _receiptText(phone, bold: true, width: 443);
  final TextPainter name, phone;
  Rect get nameBounds => Rect.fromLTWH(116, 35, 443, name.height);
  Rect get phoneBounds =>
      Rect.fromLTWH(116, nameBounds.bottom + 6, 443, phone.height);
  double get bodyTop =>
      phoneBounds.bottom + 12 < 110 ? 110 : phoneBounds.bottom + 12;
  void dispose() {
    name.dispose();
    phone.dispose();
  }
}
