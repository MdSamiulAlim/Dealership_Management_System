import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../core/types.dart';
import '../widgets/common.dart';
import 'invoices.dart';
import 'catalog.dart';
import 'activity.dart';

class OverviewScreen extends StatefulWidget {
  const OverviewScreen({super.key});
  @override
  State<OverviewScreen> createState() => _OverviewScreenState();
}

class _OverviewScreenState extends State<OverviewScreen> {
  int days = 7;
  @override
  Widget build(BuildContext c) {
    final d = object(c.w.view['dashboard'] ?? {}),
        reports = object(c.w.view['reports'] ?? {});
    final metrics = [
      [
        c.t('Sales today', 'আজকের বিক্রি'),
        c.cash(d['total_sales_today']),
        Icons.point_of_sale,
      ],
      [
        c.t('Received today', 'আজকের আদায়'),
        c.cash(d['received_today']),
        Icons.payments_outlined,
      ],
      [
        c.t('Cash balance', 'ক্যাশের জের'),
        c.cash(d['cash_balance']),
        Icons.account_balance_wallet_outlined,
      ],
      [
        c.t('Bank balance', 'ব্যাংকের জের'),
        c.cash(d['bank_balance']),
        Icons.account_balance_outlined,
      ],
      [
        c.t('Customer due', 'কাস্টমারের বাকি'),
        c.cash(d['customer_due']),
        Icons.people_outline,
      ],
      [
        c.t('Company payable', 'কোম্পানির পাওনা'),
        c.cash(d['company_payable']),
        Icons.local_shipping_outlined,
      ],
      [
        c.t('Available stock', 'মোট মজুত'),
        '${c.qty(d['current_stock'])} ${c.t('bags', 'বস্তা')}',
        Icons.inventory_2_outlined,
      ],
      [
        c.t('Low-stock products', 'কম মজুতের পণ্য'),
        c.qty((d['low_stock'] as List? ?? []).length),
        Icons.warning_amber_outlined,
      ],
    ];
    final end = DateTime.parse(today()),
        series = List.generate(days, (n) {
          final date = end
              .subtract(Duration(days: days - 1 - n))
              .toIso8601String()
              .substring(0, 10);
          final rowsForDate = rows(
            reports,
            'daily_sales',
          ).where((r) => r['date'] == date);
          return {
            'date': date,
            'amount': rowsForDate.isEmpty
                ? 0
                : number(rowsForDate.first['net_sales']),
          };
        });
    return PageBody(
      onRefresh: () => c.w.sync(),
      children: [
        SectionTitle(
          c.t('Business overview', 'ব্যবসার সারসংক্ষেপ'),
          subtitle: c.t(
            'Your shop, stock and accounts in one place.',
            'দোকান, মজুত ও হিসাব এক জায়গায়।',
          ),
        ),
        LayoutBuilder(
          builder: (c, box) {
            final columns = box.maxWidth > 900 ? 4 : 2;
            return Wrap(
              spacing: 0,
              runSpacing: 0,
              children: [
                for (var n = 0; n < metrics.length; n++)
                  SizedBox(
                    width: box.maxWidth / columns,
                    child: Metric(
                      label: metrics[n][0] as String,
                      value: metrics[n][1] as String,
                      icon: metrics[n][2] as IconData,
                      strong: n == 0,
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.icon(
              onPressed: () => page(c, const SaleEditor()),
              icon: const Icon(Icons.add),
              label: Text(c.t('New sale', 'নতুন বিক্রি')),
            ),
            FilledButton.tonalIcon(
              onPressed: () => page(
                c,
                const ActivityScreen(kind: 'payments'),
                title: c.t('Payments', 'আদায়'),
              ),
              icon: const Icon(Icons.payments_outlined),
              label: Text(c.t('Payments', 'আদায়')),
            ),
            FilledButton.tonalIcon(
              onPressed: () => page(
                c,
                const CustomersScreen(dueOnly: true),
                title: c.t('Customer due', 'কাস্টমারের বাকি'),
              ),
              icon: const Icon(Icons.people_outline),
              label: Text(c.t('Customer due', 'কাস্টমারের বাকি')),
            ),
          ],
        ),
        const SizedBox(height: 24),
        SectionTitle(c.t('Sales trend', 'বিক্রির ধারা')),
        SegmentedButton<int>(
          segments: [
            for (final n in [7, 15, 30])
              ButtonSegment(
                value: n,
                label: Text('${c.qty(n)} ${c.t('days', 'দিন')}'),
              ),
          ],
          selected: {days},
          onSelectionChanged: (v) => setState(() => days = v.first),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  c.cash(
                    series.fold<double>(
                      0,
                      (sum, row) => sum + number(row['amount']),
                    ),
                  ),
                  style: Theme.of(c).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 12),
                Semantics(
                  label: c.t(
                    '$days day sales chart',
                    '$days দিনের বিক্রির গ্রাফ',
                  ),
                  child: SizedBox(
                    height: 180,
                    width: double.infinity,
                    child: CustomPaint(
                      painter: _SalesPainter(
                        series.map((r) => number(r['amount'])).toList(),
                        Theme.of(c).colorScheme.primary,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(text(series.first['date'])),
                    Text(text(series.last['date'])),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 18),
        SectionTitle(c.t('Recent invoices', 'সাম্প্রতিক ইনভয়েস')),
        if (rows(c.w.view, 'invoices').isEmpty)
          EmptyState(
            title: c.t('Start your first sale', 'প্রথম বিক্রি শুরু করুন'),
            message: c.t(
              'Tap New sale and add products to create an invoice.',
              'নতুন বিক্রি চাপুন এবং পণ্য যোগ করে ইনভয়েস তৈরি করুন।',
            ),
          ),
        for (final invoice in rows(
          c.w.view,
          'invoices',
        ).where((i) => i['status'] != 'void').take(5))
          Card(
            child: ListTile(
              onTap: () => page(c, InvoiceScreen(id: text(invoice['id']))),
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text(text(invoice['invoice_no'])),
              subtitle: Text(
                '${invoice['customer_name']} · ${invoice['sale_date']}',
              ),
              trailing: Text(
                c.cash(invoice['net_total']),
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ),
        const SizedBox(height: 18),
        SectionTitle(c.t('Low stock', 'কম মজুত')),
        for (final product in rows(d, 'low_stock').take(8))
          Card(
            child: ListTile(
              leading: const Icon(Icons.warning_amber_outlined),
              title: Text(text(product['name'])),
              subtitle: Text(
                '${c.t('Alert at', 'সতর্কতার সীমা')}: ${c.qty(product['low_stock_level'])}',
              ),
              trailing: Text(
                '${c.qty(product['current_stock'])} ${c.t('bags', 'বস্তা')}',
              ),
            ),
          ),
      ],
    );
  }
}

class _SalesPainter extends CustomPainter {
  _SalesPainter(this.values, this.color);
  final List<double> values;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final maxValue = math.max(
      1.0,
      values.map((v) => v.abs()).fold(0.0, math.max),
    );
    final width = size.width / values.length;
    final baseline = size.height * (values.any((v) => v < 0) ? .5 : .88);
    canvas.drawLine(
      Offset(0, baseline),
      Offset(size.width, baseline),
      Paint()..color = color.withValues(alpha: .2),
    );
    for (var i = 0; i < values.length; i++) {
      final height = values[i].abs() / maxValue * (baseline - 12);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(
            i * width + width * .14,
            values[i] < 0 ? baseline : baseline - height,
            width * .72,
            math.max(2, height),
          ),
          const Radius.circular(5),
        ),
        Paint()..color = values[i] < 0 ? Colors.red.shade700 : color,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _SalesPainter old) =>
      old.values != values || old.color != color;
}
