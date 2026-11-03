import 'package:flutter/material.dart';
import '../core/types.dart';
import '../core/documents.dart';
import '../widgets/common.dart';
import 'record_editor.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});
  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  String report = 'daily_sales', query = '';
  DateTimeRange? dates;
  int index = 0;
  static const names = {
    'daily_sales': ['Daily sales', 'দিনের বিক্রি'],
    'monthly_sales': ['Monthly sales', 'মাসের বিক্রি'],
    'return_journal': ['Returns & refunds', 'ফেরত ও টাকা ফেরত'],
    'product_sales': ['Product sales', 'পণ্যভিত্তিক বিক্রি'],
    'customer_sales': ['Customer sales', 'কাস্টমারভিত্তিক বিক্রি'],
    'stock_report': ['Current stock', 'বর্তমান মজুত'],
    'due_report': ['Customer balances', 'কাস্টমারের জের'],
  };
  static const fields = {
    'daily_sales': [
      'date',
      'invoice_count',
      'bags',
      'sales',
      'received',
      'due',
      'return_credit',
      'refunds',
      'net_sales',
      'net_received',
    ],
    'monthly_sales': [
      'month',
      'bags',
      'sales',
      'received',
      'return_credit',
      'refunds',
      'net_sales',
      'net_received',
    ],
    'return_journal': [
      'date',
      'invoice_no',
      'name',
      'account',
      'return_credit',
      'refunds',
      'reason',
    ],
    'product_sales': ['name', 'bags', 'amount'],
    'customer_sales': ['customer_id', 'name', 'purchase', 'paid', 'sale_due'],
    'stock_report': [
      'name',
      'product_code',
      'opening_stock',
      'received_stock',
      'sold_stock',
      'current_stock',
      'low_stock_level',
    ],
    'due_report': [
      'name',
      'mobile',
      'opening_due',
      'total_purchase',
      'total_paid',
      'current_due',
    ],
  };
  String label(BuildContext c, String key) {
    const names = {
      'date': ['Date', 'তারিখ'],
      'month': ['Month', 'মাস'],
      'invoice_count': ['Invoices', 'ইনভয়েস'],
      'bags': ['Bags', 'বস্তা'],
      'sales': ['Original sales', 'মূল বিক্রি'],
      'received': ['Invoice payment', 'ইনভয়েসে পরিশোধ'],
      'due': ['Original due', 'মূল বাকি'],
      'return_credit': ['Return credit', 'ফেরতের সমন্বয়'],
      'refunds': ['Refunds', 'ফেরত দেওয়া টাকা'],
      'net_sales': ['Net sales', 'নিট বিক্রি'],
      'net_received': ['Net received', 'নিট আদায়'],
      'invoice_no': ['Invoice', 'ইনভয়েস'],
      'name': ['Name', 'নাম'],
      'account': ['Account', 'হিসাব'],
      'reason': ['Reason', 'কারণ'],
      'amount': ['Net amount', 'নিট মূল্য'],
      'customer_id': ['Customer ID', 'কাস্টমার আইডি'],
      'purchase': ['Net purchase', 'নিট ক্রয়'],
      'paid': ['Paid', 'পরিশোধ'],
      'sale_due': ['Invoice due', 'ইনভয়েসের বাকি'],
      'product_code': ['Product code', 'পণ্যের কোড'],
      'opening_stock': ['Opening bags', 'শুরুর বস্তা'],
      'received_stock': ['Received bags', 'প্রাপ্ত বস্তা'],
      'sold_stock': ['Sold bags', 'বিক্রিত বস্তা'],
      'current_stock': ['Current bags', 'বর্তমান বস্তা'],
      'low_stock_level': ['Alert level', 'সতর্কতার সীমা'],
      'mobile': ['Mobile', 'মোবাইল'],
      'opening_due': ['Opening due', 'শুরুর বাকি'],
      'total_purchase': ['Total purchase', 'মোট ক্রয়'],
      'total_paid': ['Total paid', 'মোট পরিশোধ'],
      'current_due': ['Current due', 'বর্তমান বাকি'],
    };
    final pair = names[key] ?? [key, key];
    return c.t(pair[0], pair[1]);
  }

  bool currency(String key) => [
    'sales',
    'received',
    'due',
    'return_credit',
    'refunds',
    'net_sales',
    'net_received',
    'amount',
    'purchase',
    'paid',
    'sale_due',
    'opening_due',
    'total_purchase',
    'total_paid',
    'current_due',
  ].contains(key);
  String value(BuildContext c, String key, dynamic v) => currency(key)
      ? c.cash(v)
      : [
          'bags',
          'invoice_count',
          'opening_stock',
          'received_stock',
          'sold_stock',
          'current_stock',
          'low_stock_level',
        ].contains(key)
      ? c.qty(v)
      : key == 'account'
      ? enumLabel(c, text(v))
      : text(v);
  @override
  Widget build(BuildContext c) {
    final dated = [
          'daily_sales',
          'monthly_sales',
          'return_journal',
        ].contains(report),
        columns = fields[report]!;
    final list = rows(object(c.w.view['reports'] ?? {}), report).where((r) {
      if (!r.values.join(' ').toLowerCase().contains(query.toLowerCase())) {
        return false;
      }
      if (!dated || dates == null) return true;
      final date = text(r['date'] ?? '${r['month']}-01');
      return date.compareTo(
                dates!.start.toIso8601String().substring(
                  0,
                  report == 'monthly_sales' ? 7 : 10,
                ),
              ) >=
              0 &&
          date
                  .substring(0, report == 'monthly_sales' ? 7 : 10)
                  .compareTo(
                    dates!.end.toIso8601String().substring(
                      0,
                      report == 'monthly_sales' ? 7 : 10,
                    ),
                  ) <=
              0;
    }).toList();
    final current = index.clamp(0, list.isEmpty ? 0 : (list.length - 1) ~/ 50);
    return PageBody(
      onRefresh: () => c.w.sync(),
      children: [
        SectionTitle(
          c.t('Reports', 'রিপোর্ট'),
          subtitle: c.t(
            'Sales, returns, stock and customer balances.',
            'বিক্রি, ফেরত, মজুত ও কাস্টমারের হিসাব।',
          ),
        ),
        DropdownButtonFormField<String>(
          isExpanded: true,
          initialValue: report,
          decoration: InputDecoration(
            labelText: c.t('Report type', 'রিপোর্টের ধরন'),
          ),
          items: names.entries
              .map(
                (e) => DropdownMenuItem(
                  value: e.key,
                  child: Text(c.t(e.value[0], e.value[1])),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() {
            report = v!;
            index = 0;
            dates = null;
          }),
        ),
        const SizedBox(height: 14),
        SearchField(
          hint: c.t('Search this report', 'এই রিপোর্টে খুঁজুন'),
          onChanged: (v) => setState(() {
            query = v;
            index = 0;
          }),
        ),
        if (dated)
          Wrap(
            spacing: 8,
            children: [
              FilterChip(
                label: Text(
                  dates == null
                      ? c.t('Date range', 'তারিখ')
                      : c.t('Dates selected', 'তারিখ নির্বাচিত'),
                ),
                selected: dates != null,
                onSelected: (_) async {
                  final range = await showDateRangePicker(
                    context: c,
                    firstDate: DateTime(2000),
                    lastDate: DateTime(2100),
                    initialDateRange: dates,
                  );
                  if (range != null) {
                    setState(() {
                      dates = range;
                      index = 0;
                    });
                  }
                },
              ),
              if (dates != null)
                ActionChip(
                  label: Text(c.t('Clear', 'মুছুন')),
                  onPressed: () => setState(() => dates = null),
                ),
            ],
          ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Text(
            dated
                ? c.t(
                    'Returns and refunds appear on their own dates.',
                    'ফেরত ও টাকা ফেরত তাদের নিজস্ব তারিখে দেখানো হয়।',
                  )
                : c.t(
                    'These are current net balances based on complete history.',
                    'এগুলো সম্পূর্ণ ইতিহাস অনুযায়ী বর্তমান নিট হিসাব।',
                  ),
          ),
        ),
        OutlinedButton.icon(
          onPressed: list.isEmpty
              ? null
              : () => runAction(
                  c,
                  () => Documents.saveCsv(
                    'Arafat-$report-${today()}.csv',
                    columns.map((k) => label(c, k)).toList(),
                    list
                        .map((r) => columns.map((key) => r[key] ?? '').toList())
                        .toList(),
                  ),
                ),
          icon: const Icon(Icons.download),
          label: Text(c.t('Download CSV', 'CSV নামান')),
        ),
        const SizedBox(height: 16),
        if (list.isEmpty)
          EmptyState(
            title: c.t('No report data', 'রিপোর্টের তথ্য নেই'),
            message: c.t(
              'Records will appear after sales or transactions.',
              'বিক্রি বা লেনদেনের পরে তথ্য দেখানো হবে।',
            ),
          ),
        for (final row in paged(list, current))
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var n = 0; n < columns.length; n++)
                    ValueRow(
                      label(c, columns[n]),
                      value(c, columns[n], row[columns[n]]),
                      bold:
                          n == 0 ||
                          [
                            'net_sales',
                            'current_due',
                            'current_stock',
                          ].contains(columns[n]),
                    ),
                ],
              ),
            ),
          ),
        ListPager(
          total: list.length,
          page: current,
          onPage: (v) => setState(() => index = v),
        ),
      ],
    );
  }
}
