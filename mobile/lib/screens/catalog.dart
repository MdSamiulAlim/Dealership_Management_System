import 'package:flutter/material.dart';
import '../core/types.dart';
import '../core/ledger.dart';
import '../core/documents.dart';
import '../widgets/common.dart';
import 'record_editor.dart';
import 'invoices.dart';

Future<void> deleteRecord(BuildContext c, String entity, Json record) async {
  if (!await confirm(
    c,
    title: c.t('Delete this record?', 'এই তথ্য মুছবেন?'),
    message:
        '${record['name'] ?? record['invoice_no'] ?? record['notes'] ?? record['id']}\n${c.t('This changes stock or financial balances where applicable.', 'প্রযোজ্য ক্ষেত্রে মজুত বা টাকার হিসাব বদলাবে।')}',
    destructive: true,
  )) {
    return;
  }
  if (c.mounted) {
    await runAction(
      c,
      () => c.w.command('DELETE', '/api/$entity/${record['id']}', {
        'original': record,
        'confirmed': true,
      }),
    );
  }
}

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key, this.stock = false});
  final bool stock;
  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  String query = '', category = '', filter = 'all';
  int index = 0;
  @override
  Widget build(BuildContext c) {
    final list =
        rows(c.w.view, 'products')
            .where(
              (p) =>
                  '${p['name']} ${p['product_code']}'.toLowerCase().contains(
                    query.toLowerCase(),
                  ) &&
                  (category.isEmpty || p['category'] == category) &&
                  switch (filter) {
                    'low' =>
                      number(p['current_stock']) <=
                          number(p['low_stock_level']),
                    'zero' => number(p['current_stock']) <= 0,
                    'available' => number(p['current_stock']) > 0,
                    _ => true,
                  },
            )
            .toList()
          ..sort((a, b) => text(a['name']).compareTo(text(b['name'])));
    final current = index.clamp(0, list.isEmpty ? 0 : (list.length - 1) ~/ 50);
    return PageBody(
      onRefresh: () => c.w.sync(),
      children: [
        SectionTitle(
          widget.stock ? c.t('Stock', 'মজুত') : c.t('Products', 'পণ্য'),
          subtitle: widget.stock
              ? c.t(
                  'Live bag counts and low-stock alerts.',
                  'বর্তমান বস্তার সংখ্যা ও কম মজুতের সতর্কতা।',
                )
              : c.t(
                  'Manage your catalog and editable prices.',
                  'পণ্যের তালিকা ও পরিবর্তনযোগ্য দর পরিচালনা করুন।',
                ),
          action: FilledButton.icon(
            onPressed: () => page(
              c,
              RecordEditor(
                entity: widget.stock ? 'adjustments' : 'products',
                defaults: {if (category.isNotEmpty) 'category': category},
              ),
            ),
            icon: const Icon(Icons.add),
            label: Text(
              widget.stock ? c.t('Adjust', 'সমন্বয়') : c.t('New', 'নতুন'),
            ),
          ),
        ),
        SearchField(
          hint: c.t('Product name or code', 'পণ্যের নাম বা কোড'),
          onChanged: (v) => setState(() {
            query = v;
            index = 0;
          }),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final name in [
                '',
                'Fish feed',
                'Cattle feed',
                'Poultry feed',
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(
                      name.isEmpty ? c.t('All', 'সব') : enumLabel(c, name),
                    ),
                    selected: category == name,
                    onSelected: (_) => setState(() {
                      category = name;
                      index = 0;
                    }),
                  ),
                ),
            ],
          ),
        ),
        if (widget.stock)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: filter,
              decoration: InputDecoration(
                labelText: c.t('Stock filter', 'মজুত ফিল্টার'),
              ),
              items:
                  [
                        ['all', 'All stock', 'সব মজুত'],
                        ['low', 'Low stock', 'কম মজুত'],
                        ['zero', 'Out of stock', 'মজুত নেই'],
                        ['available', 'Available', 'মজুত আছে'],
                      ]
                      .map(
                        (r) => DropdownMenuItem(
                          value: r[0],
                          child: Text(c.t(r[1], r[2])),
                        ),
                      )
                      .toList(),
              onChanged: (v) => setState(() {
                filter = v!;
                index = 0;
              }),
            ),
          ),
        if (list.isEmpty)
          EmptyState(
            title: c.t('No products found', 'পণ্য পাওয়া যায়নি'),
            message: c.t(
              'Try another search or add a product.',
              'অন্যভাবে খুঁজুন অথবা পণ্য যোগ করুন।',
            ),
          ),
        for (final p in paged(list, current))
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    text(p['name']),
                    style: Theme.of(c).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    '${enumLabel(c, text(p['category']))} · ${p['product_code']}',
                  ),
                  Text(
                    '${p['feed_size'] ?? ''} · ${c.qty(p['bag_weight'])} ${c.t('kg / bag', 'কেজি / বস্তা')}${p['protein_percent'] == null ? '' : ' · ${c.t('Protein', 'প্রোটিন')} ${c.qty(p['protein_percent'])}%'}',
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    children: [
                      Chip(
                        avatar: Icon(
                          number(p['current_stock']) <=
                                  number(p['low_stock_level'])
                              ? Icons.warning_amber
                              : Icons.inventory_2_outlined,
                          size: 18,
                        ),
                        label: Text(
                          '${c.qty(p['current_stock'])} ${c.t('bags available', 'বস্তা আছে')}',
                        ),
                        backgroundColor:
                            number(p['current_stock']) <=
                                number(p['low_stock_level'])
                            ? Theme.of(c).colorScheme.errorContainer
                            : null,
                      ),
                      if (flag(p['pending']))
                        Chip(
                          label: Text(c.t('Pending Sync', 'Sync অপেক্ষমাণ')),
                        ),
                    ],
                  ),
                  ValueRow(
                    c.t('Price / bag', 'দর / বস্তা'),
                    c.cash(p['default_rate']),
                    bold: true,
                  ),
                  if (widget.stock) ...[
                    ValueRow(
                      c.t(
                        'Opening / Received / Sold',
                        'শুরু / প্রাপ্ত / বিক্রি',
                      ),
                      '${c.qty(p['opening_stock'])} / ${c.qty(p['received_stock'])} / ${c.qty(p['sold_stock'])}',
                    ),
                    ValueRow(
                      c.t('Low stock alert', 'কম মজুতের সীমা'),
                      '${c.qty(p['low_stock_level'])} ${c.t('bags', 'বস্তা')}',
                    ),
                  ],
                  Row(
                    children: [
                      OutlinedButton.icon(
                        onPressed: flag(p['pending'])
                            ? null
                            : () => page(
                                c,
                                RecordEditor(
                                  entity: 'products',
                                  initial: clone(p),
                                ),
                              ),
                        icon: const Icon(Icons.edit_outlined),
                        label: Text(c.t('Edit', 'সম্পাদনা')),
                      ),
                      const Spacer(),
                      IconButton(
                        tooltip: c.t(
                          'Delete unused product',
                          'অব্যবহৃত পণ্য মুছুন',
                        ),
                        onPressed: flag(p['pending'])
                            ? null
                            : () => deleteRecord(c, 'products', p),
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
        if (widget.stock)
          ExpansionTile(
            title: Text(
              c.t('Stock adjustment history', 'মজুত সমন্বয়ের ইতিহাস'),
            ),
            children: [
              for (final a in rows(c.w.view, 'adjustments').reversed.take(30))
                ListTile(
                  title: Text(
                    text(
                      c.w.find('products', a['product_id'])?['name'] ??
                          c.w.find(
                            'archived_products',
                            a['product_id'],
                          )?['name'] ??
                          a['product_id'],
                    ),
                  ),
                  subtitle: Text(
                    '${a['adjust_date']} · ${enumLabel(c, text(a['type']))} · ${c.qty(a['quantity'])}',
                  ),
                  trailing: IconButton(
                    tooltip: c.t('Delete adjustment', 'সমন্বয় মুছুন'),
                    onPressed: flag(a['pending'])
                        ? null
                        : () => deleteRecord(c, 'adjustments', a),
                    icon: const Icon(Icons.delete_outline),
                  ),
                ),
            ],
          ),
      ],
    );
  }
}

class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key, this.dueOnly = false});
  final bool dueOnly;
  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  String search = '';
  int index = 0;
  @override
  Widget build(BuildContext c) {
    final list =
        rows(c.w.view, 'customers')
            .where(
              (r) =>
                  (!widget.dueOnly || number(r['current_due']) > 0) &&
                  '${r['name']} ${r['mobile']}'.toLowerCase().contains(
                    search.toLowerCase(),
                  ),
            )
            .toList()
          ..sort(
            (a, b) => widget.dueOnly
                ? number(b['current_due']).compareTo(number(a['current_due']))
                : text(a['name']).compareTo(text(b['name'])),
          );
    final current = index.clamp(0, list.isEmpty ? 0 : (list.length - 1) ~/ 50);
    return PageBody(
      onRefresh: () => c.w.sync(),
      children: [
        SectionTitle(
          widget.dueOnly
              ? c.t('Customer due', 'কাস্টমারের বাকি')
              : c.t('Customers', 'কাস্টমার'),
          subtitle: widget.dueOnly
              ? c.t(
                  'Only customers with outstanding dues are shown.',
                  'শুধু যাঁদের বাকি আছে তাঁদের দেখানো হচ্ছে।',
                )
              : c.t(
                  'Customer details, balances and receipts.',
                  'কাস্টমারের তথ্য, হিসাব ও রসিদ।',
                ),
          action: FilledButton.icon(
            onPressed: () => page(
              c,
              RecordEditor(entity: widget.dueOnly ? 'payments' : 'customers'),
            ),
            icon: const Icon(Icons.add),
            label: Text(
              widget.dueOnly ? c.t('Collect', 'আদায়') : c.t('New', 'নতুন'),
            ),
          ),
        ),
        if (widget.dueOnly)
          Metric(
            label: c.t('Outstanding customer due', 'কাস্টমারের মোট বাকি'),
            value: c.cash(Ledger.sum(list, (r) => number(r['current_due']))),
            icon: Icons.account_balance_wallet_outlined,
            strong: true,
          ),
        const SizedBox(height: 12),
        SearchField(
          hint: c.t('Customer name or mobile', 'কাস্টমারের নাম বা মোবাইল'),
          onChanged: (v) => setState(() {
            search = v;
            index = 0;
          }),
        ),
        if (list.isEmpty)
          EmptyState(
            title: widget.dueOnly
                ? c.t('No outstanding dues', 'কোনো বাকি নেই')
                : c.t('No customers found', 'কাস্টমার পাওয়া যায়নি'),
            message: widget.dueOnly
                ? c.t(
                    'Customer balances are up to date.',
                    'কাস্টমারের হিসাব পরিশোধিত আছে।',
                  )
                : c.t(
                    'Add a customer to start recording sales.',
                    'বিক্রির জন্য কাস্টমার যোগ করুন।',
                  ),
          ),
        for (final customer in paged(list, current))
          Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              onTap: () => page(c, CustomerAccount(customerId: customer['id'])),
              leading: const CircleAvatar(child: Icon(Icons.person_outline)),
              title: Text(
                text(customer['name']),
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  '${customer['mobile'] ?? ''}\n${c.t('Due', 'বাকি')}: ${c.cash(customer['current_due'])}',
                ),
              ),
              trailing: const Icon(Icons.chevron_right),
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

class CustomerAccount extends StatefulWidget {
  const CustomerAccount({super.key, required this.customerId});
  final dynamic customerId;
  @override
  State<CustomerAccount> createState() => _CustomerAccountState();
}

class _CustomerAccountState extends State<CustomerAccount> {
  dynamic get customerId => widget.customerId;
  int historyPage = 0;
  Future<void> pdf(BuildContext c, Json statement, String action) async =>
      runAction(c, () async {
        final bytes = await Documents.due(
          statement,
          object(c.w.view['settings'] ?? {}),
          bengali: c.w.language == 'bn',
        );
        if (action == 'print') {
          await Documents.printPdf(bytes);
        } else if (action == 'share') {
          await Documents.share(bytes, 'Arafat-Customer-Due-$customerId.pdf');
        } else {
          await Documents.saveBytes(
            'Arafat-Customer-Due-$customerId.pdf',
            bytes,
          );
        }
      });
  @override
  Widget build(BuildContext c) {
    final customer = c.w.find('customers', customerId);
    if (customer == null) {
      return Scaffold(
        appBar: AppBar(),
        body: EmptyState(
          title: c.t('Customer not found', 'কাস্টমার পাওয়া যায়নি'),
          message: c.t('Refresh and try again.', 'Sync করে দেখুন।'),
        ),
      );
    }
    final statement = Ledger.due(c.w.view, customer);
    final history = rows(statement, 'entries').reversed.toList();
    final current = historyPage.clamp(
      0,
      history.isEmpty ? 0 : (history.length - 1) ~/ 50,
    );
    return Scaffold(
      appBar: AppBar(title: Text(text(customer['name']))),
      body: PageBody(
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    text(customer['name']),
                    style: Theme.of(c).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(text(customer['mobile'])),
                  Text(text(customer['address'])),
                  const Divider(),
                  ValueRow(
                    c.t('Opening due', 'শুরুর বাকি'),
                    c.cash(customer['opening_due']),
                  ),
                  ValueRow(
                    c.t('Total purchase', 'মোট ক্রয়'),
                    c.cash(customer['total_purchase']),
                  ),
                  ValueRow(
                    c.t('Total paid', 'মোট পরিশোধ'),
                    c.cash(customer['total_paid']),
                  ),
                  ValueRow(
                    c.t('Current due', 'বর্তমান বাকি'),
                    c.cash(statement['due']),
                    bold: true,
                  ),
                  if (number(statement['credit']) > 0)
                    ValueRow(
                      c.t('Customer credit', 'কাস্টমারের জমা'),
                      c.cash(statement['credit']),
                      bold: true,
                    ),
                ],
              ),
            ),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: () => page(
                  c,
                  RecordEditor(
                    entity: 'payments',
                    defaults: {'customer_id': customer['id']},
                  ),
                ),
                icon: const Icon(Icons.add),
                label: Text(c.t('Collect payment', 'টাকা আদায়')),
              ),
              OutlinedButton.icon(
                onPressed: flag(customer['pending'])
                    ? null
                    : () => page(
                        c,
                        RecordEditor(
                          entity: 'customers',
                          initial: clone(customer),
                        ),
                      ),
                icon: const Icon(Icons.edit_outlined),
                label: Text(c.t('Edit customer', 'তথ্য সম্পাদনা')),
              ),
              OutlinedButton.icon(
                onPressed: () => pdf(c, statement, 'save'),
                icon: const Icon(Icons.download),
                label: Text(c.t('Due receipt', 'বাকির রসিদ')),
              ),
              OutlinedButton.icon(
                onPressed: () => pdf(c, statement, 'print'),
                icon: const Icon(Icons.print),
                label: Text(c.t('Print', 'প্রিন্ট')),
              ),
              OutlinedButton.icon(
                onPressed: () => pdf(c, statement, 'share'),
                icon: const Icon(Icons.share),
                label: Text(c.t('Share', 'শেয়ার')),
              ),
            ],
          ),
          const SizedBox(height: 24),
          SectionTitle(c.t('Account history', 'হিসাবের ইতিহাস')),
          for (final entry in paged(history, current))
            Card(
              child: ListTile(
                onTap: entry['invoice_id'] != null
                    ? () =>
                          page(c, InvoiceScreen(id: text(entry['invoice_id'])))
                    : null,
                title: Text('${entry['reference']} · ${entry['date']}'),
                subtitle: Text(
                  '${c.t('Debit / Credit', 'যোগ / কমা')}: ${c.cash(entry['debit'])} / ${c.cash(entry['credit'])}\n${c.t('Balance', 'জের')}: ${c.cash(entry['balance'])}',
                ),
                trailing: entry['kind'] == 'payment'
                    ? PopupMenuButton<String>(
                        onSelected: (v) {
                          final payment = c.w.find('payments', entry['id']);
                          if (payment == null || flag(payment['pending'])) {
                            return;
                          }
                          if (v == 'edit') {
                            page(
                              c,
                              RecordEditor(
                                entity: 'payments',
                                initial: clone(payment),
                              ),
                            );
                          } else {
                            deleteRecord(c, 'payments', payment);
                          }
                        },
                        itemBuilder: (_) => [
                          PopupMenuItem(
                            value: 'edit',
                            child: Text(c.t('Edit payment', 'পরিশোধ সম্পাদনা')),
                          ),
                          PopupMenuItem(
                            value: 'delete',
                            child: Text(c.t('Delete payment', 'পরিশোধ মুছুন')),
                          ),
                        ],
                      )
                    : const Icon(Icons.chevron_right),
              ),
            ),
          ListPager(
            total: history.length,
            page: current,
            onPage: (v) => setState(() => historyPage = v),
          ),
          if (rows(statement, 'entries').isEmpty)
            EmptyState(
              title: c.t('No transactions yet', 'এখনও লেনদেন নেই'),
              message: c.t(
                'Invoices and collections will appear here.',
                'ইনভয়েস ও আদায় এখানে দেখানো হবে।',
              ),
            ),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            onPressed: flag(customer['pending'])
                ? null
                : () => deleteRecord(c, 'customers', customer),
            icon: const Icon(Icons.delete_outline),
            label: Text(
              c.t('Delete unused customer', 'অব্যবহৃত কাস্টমার মুছুন'),
            ),
          ),
        ],
      ),
    );
  }
}
