import 'package:flutter/material.dart';
import '../core/types.dart';
import '../core/ledger.dart';
import '../widgets/common.dart';
import 'record_editor.dart';
import 'catalog.dart';

const expenseTypes = ['Expense', 'Transport Cost', 'Other Expense'];

class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key, required this.kind});
  final String kind;
  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  String query = '', account = 'all', status = 'all';
  DateTimeRange? dates;
  int index = 0;
  @override
  Widget build(BuildContext c) {
    final entity = widget.kind == 'expenses' ? 'transactions' : widget.kind;
    final en = switch (widget.kind) {
      'orders' => 'Company orders',
      'payments' => 'Payments',
      'adjustments' => 'Stock adjustments',
      'expenses' => 'Expenses',
      _ => 'Money & transactions',
    };
    final bn = switch (widget.kind) {
      'orders' => 'কোম্পানির অর্ডার',
      'payments' => 'আদায়',
      'adjustments' => 'মজুত সমন্বয়',
      'expenses' => 'খরচ',
      _ => 'অর্থ ও লেনদেন',
    };
    final dateKey = switch (entity) {
      'orders' => 'order_date',
      'payments' => 'payment_date',
      'adjustments' => 'adjust_date',
      _ => 'txn_date',
    };
    final seen = <String>{};
    final list =
        rows(c.w.view, entity).where((row) {
          if (widget.kind == 'expenses' &&
              !expenseTypes.contains(row['type'])) {
            return false;
          }
          if (account != 'all' && row['account'] != account) return false;
          if (entity == 'transactions' && row['transfer_id'] != null) {
            if (seen.contains(text(row['transfer_id']))) return false;
            seen.add(text(row['transfer_id']));
          }
          final date = text(row[dateKey]);
          return (account == 'all' || row['account'] == account) &&
              (status == 'all' || row['status'] == status) &&
              (dates == null ||
                  (date.compareTo(
                            dates!.start.toIso8601String().substring(0, 10),
                          ) >=
                          0 &&
                      date.compareTo(
                            dates!.end.toIso8601String().substring(0, 10),
                          ) <=
                          0)) &&
              '${row['customer_name'] ?? ''} ${row['product_name'] ?? ''} ${row['invoice_no'] ?? ''} ${row['type'] ?? ''} ${row['category'] ?? ''} ${row['reference'] ?? ''} ${row['notes'] ?? ''}'
                  .toLowerCase()
                  .contains(query.toLowerCase());
        }).toList()..sort(
          (a, b) => text(b[dateKey]).compareTo(text(a[dateKey])) != 0
              ? text(b[dateKey]).compareTo(text(a[dateKey]))
              : number(b['id']).compareTo(number(a['id'])),
        );
    final current = index.clamp(0, list.isEmpty ? 0 : (list.length - 1) ~/ 50),
        dashboard = object(c.w.view['dashboard'] ?? {});
    return PageBody(
      onRefresh: () => c.w.sync(),
      children: [
        SectionTitle(
          c.t(en, bn),
          subtitle: widget.kind == 'orders'
              ? c.t(
                  'Received orders add stock and company payable.',
                  'প্রাপ্ত অর্ডারে মজুত ও কোম্পানির পাওনা বাড়ে।',
                )
              : c.t(
                  'Every save is tracked and safely synchronized.',
                  'প্রতিটি হিসাব নিরাপদে সংরক্ষণ ও Sync হয়।',
                ),
          action: FilledButton.icon(
            onPressed: () => page(
              c,
              RecordEditor(
                entity: entity,
                defaults: widget.kind == 'expenses'
                    ? {'type': 'Expense', 'expense_only': true}
                    : {},
              ),
            ),
            icon: const Icon(Icons.add),
            label: Text(c.t('New', 'নতুন')),
          ),
        ),
        if (widget.kind == 'transactions') ...[
          Row(
            children: [
              Expanded(
                child: Metric(
                  label: c.t('Cash', 'ক্যাশ'),
                  value: c.cash(dashboard['cash_balance']),
                  icon: Icons.payments_outlined,
                  strong: true,
                ),
              ),
              Expanded(
                child: Metric(
                  label: c.t('Bank', 'ব্যাংক'),
                  value: c.cash(dashboard['bank_balance']),
                  icon: Icons.account_balance_outlined,
                ),
              ),
            ],
          ),
          Wrap(
            spacing: 8,
            children: [
              FilledButton.tonalIcon(
                onPressed: () => page(
                  c,
                  const RecordEditor(
                    entity: 'transactions',
                    defaults: {'type': 'Bank Deposit'},
                  ),
                ),
                icon: const Icon(Icons.swap_horiz),
                label: Text(c.t('Cash → Bank', 'ক্যাশ → ব্যাংক')),
              ),
              FilledButton.tonalIcon(
                onPressed: () => page(
                  c,
                  const RecordEditor(
                    entity: 'transactions',
                    defaults: {'type': 'Bank Withdraw'},
                  ),
                ),
                icon: const Icon(Icons.swap_horiz),
                label: Text(c.t('Bank → Cash', 'ব্যাংক → ক্যাশ')),
              ),
            ],
          ),
          const SizedBox(height: 16),
        ],
        if (widget.kind == 'expenses')
          Metric(
            label: c.t('Filtered expense total', 'ফিল্টার অনুযায়ী মোট খরচ'),
            value: c.cash(Ledger.sum(list, (r) => number(r['amount']))),
            icon: Icons.receipt_long_outlined,
            strong: true,
          ),
        if (widget.kind == 'orders')
          Metric(
            label: c.t('Company payable', 'কোম্পানির পাওনা'),
            value: c.cash(dashboard['company_payable']),
            icon: Icons.local_shipping_outlined,
            strong: true,
          ),
        const SizedBox(height: 12),
        SearchField(
          hint: c.t('Search name, notes or reference', 'নাম, নোট বা রেফারেন্স'),
          onChanged: (v) => setState(() {
            query = v;
            index = 0;
          }),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
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
            if (entity != 'orders')
              for (final a in ['all', 'Cash', 'Bank'])
                ChoiceChip(
                  label: Text(
                    a == 'all'
                        ? c.t('All accounts', 'সব হিসাব')
                        : enumLabel(c, a),
                  ),
                  selected: account == a,
                  onSelected: (_) => setState(() {
                    account = a;
                    index = 0;
                  }),
                ),
            if (entity == 'orders')
              for (final a in ['all', 'Pending', 'Confirmed', 'Delivered'])
                ChoiceChip(
                  label: Text(a == 'all' ? c.t('All', 'সব') : enumLabel(c, a)),
                  selected: status == a,
                  onSelected: (_) => setState(() {
                    status = a;
                    index = 0;
                  }),
                ),
          ],
        ),
        const SizedBox(height: 12),
        if (list.isEmpty)
          EmptyState(
            title: c.t('No records found', 'তথ্য পাওয়া যায়নি'),
            message: widget.kind == 'orders'
                ? c.t(
                    'Tap New, choose a product and quantity, then save the company order.',
                    'নতুন চাপুন, পণ্য ও পরিমাণ দিয়ে কোম্পানির অর্ডার সেভ করুন।',
                  )
                : c.t(
                    'Add a new transaction or clear the filters.',
                    'নতুন লেনদেন যোগ করুন অথবা ফিল্টার মুছুন।',
                  ),
            action: FilledButton(
              onPressed: () => page(
                c,
                RecordEditor(
                  entity: entity,
                  defaults: widget.kind == 'expenses'
                      ? {'type': 'Expense', 'expense_only': true}
                      : {},
                ),
              ),
              child: Text(c.t('Add record', 'তথ্য যোগ করুন')),
            ),
          ),
        for (final row in paged(list, current))
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entity == 'orders' || entity == 'adjustments'
                        ? text(row['product_name'])
                        : entity == 'payments'
                        ? text(row['customer_name'])
                        : enumLabel(c, text(row['type'])),
                    style: Theme.of(c).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(text(row[dateKey])),
                  if (entity == 'orders') ...[
                    Chip(label: Text(enumLabel(c, text(row['status'])))),
                    ValueRow(
                      c.t('Bags × Rate', 'বস্তা × দর'),
                      '${c.qty(row['quantity'])} × ${c.cash(row['rate'])}',
                    ),
                    ValueRow(
                      c.t('Total', 'মোট'),
                      c.cash(row['total_amount']),
                      bold: true,
                    ),
                    if (text(row['invoice_no']).isNotEmpty)
                      ValueRow(
                        c.t('Challan', 'চালান'),
                        text(row['invoice_no']),
                      ),
                  ] else if (entity == 'adjustments') ...[
                    ValueRow(
                      c.t('Type', 'ধরন'),
                      enumLabel(c, text(row['type'])),
                    ),
                    ValueRow(
                      c.t('Bags', 'বস্তা'),
                      c.qty(row['quantity']),
                      bold: true,
                    ),
                  ] else ...[
                    ValueRow(
                      c.t('Amount', 'পরিমাণ'),
                      c.cash(row['amount']),
                      bold: true,
                    ),
                    ValueRow(
                      c.t('Account', 'হিসাব'),
                      enumLabel(c, text(row['account'])),
                    ),
                    if (text(row['category']).isNotEmpty)
                      ValueRow(c.t('Category', 'বিভাগ'), text(row['category'])),
                    if (text(row['reference']).isNotEmpty)
                      ValueRow(
                        c.t('Reference', 'রেফারেন্স'),
                        text(row['reference']),
                      ),
                  ],
                  if (text(row['notes']).isNotEmpty)
                    Text(
                      text(row['notes']),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  if (flag(row['pending']))
                    Chip(label: Text(c.t('Pending Sync', 'Sync অপেক্ষমাণ'))),
                  Row(
                    children: [
                      TextButton.icon(
                        onPressed: flag(row['pending'])
                            ? null
                            : () => page(
                                c,
                                RecordEditor(
                                  entity: entity,
                                  initial: clone(row),
                                  defaults: widget.kind == 'expenses'
                                      ? {'expense_only': true}
                                      : {},
                                ),
                              ),
                        icon: const Icon(Icons.edit_outlined),
                        label: Text(c.t('Edit', 'সম্পাদনা')),
                      ),
                      const Spacer(),
                      IconButton(
                        tooltip: c.t('Delete record', 'তথ্য মুছুন'),
                        onPressed: flag(row['pending'])
                            ? null
                            : () => deleteRecord(c, entity, row),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ],
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
        if (widget.kind == 'transactions')
          OutlinedButton.icon(
            onPressed: () => page(
              c,
              const ActivityScreen(kind: 'payments'),
              title: c.t('Payments', 'আদায়'),
            ),
            icon: const Icon(Icons.payments_outlined),
            label: Text(
              c.t('Customer payment history', 'কাস্টমারের পরিশোধের ইতিহাস'),
            ),
          ),
      ],
    );
  }
}
