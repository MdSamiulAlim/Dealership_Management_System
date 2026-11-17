import 'package:flutter/material.dart';
import '../core/types.dart';
import '../core/ledger.dart';
import '../core/documents.dart';
import '../widgets/common.dart';
import 'record_editor.dart';

bool hasReturns(Json invoice) =>
    rows(invoice, 'items').any((i) => number(i['returned_quantity']) > 0);
Future<void> deleteInvoice(BuildContext c, Json invoice) async {
  if (!await confirm(
        c,
        title: c.t('Delete / cancel invoice?', 'ইনভয়েস মুছবেন / বাতিল করবেন?'),
        message:
            '${invoice['invoice_no']}\n${invoice['customer_name']}\n${c.t('Stock and financial effects will be reversed; history remains.', 'মজুত ও হিসাবের প্রভাব উল্টানো হবে; ইতিহাস থাকবে।')}',
        destructive: true,
      ) ||
      !c.mounted) {
    return;
  }
  await runAction(
    c,
    () => c.w.command('DELETE', '/api/invoices/${invoice['id']}', {
      'expected_version': invoice['version'],
      'confirmed': true,
    }),
  );
}

String invoiceStatus(BuildContext c, Json invoice) =>
    invoice['status'] == 'void'
    ? c.t('Cancelled', 'বাতিল')
    : flag(invoice['pending'])
    ? c.t('Pending Sync', 'Sync অপেক্ষমাণ')
    : hasReturns(invoice) &&
          rows(invoice, 'items').every(
            (i) => number(i['quantity']) <= number(i['returned_quantity']),
          )
    ? c.t('Returned', 'ফেরত')
    : number(invoice['due_amount']) > 0
    ? (number(invoice['net_paid']) > 0
          ? c.t('Partial', 'আংশিক')
          : c.t('Due', 'বাকি'))
    : c.t('Paid', 'পরিশোধিত');

class SalesScreen extends StatefulWidget {
  const SalesScreen({super.key});
  @override
  State<SalesScreen> createState() => _SalesScreenState();
}

class _SalesScreenState extends State<SalesScreen> {
  String search = '', status = 'all';
  DateTimeRange? dates;
  Json? customer, product;
  int index = 0;
  @override
  Widget build(BuildContext c) {
    final filtered =
        rows(c.w.view, 'invoices').where((i) {
          final amount = number(i['net_total']), paid = number(i['net_paid']);
          final matches =
              '${i['invoice_no']} ${i['customer_name']} ${rows(i, 'items').map((r) => '${r['product_name']} ${r['product_code']}').join(' ')}'
                  .toLowerCase()
                  .contains(search.toLowerCase());
          final date = text(i['sale_date']);
          return matches &&
              (customer == null || same(i['customer_id'], customer!['id'])) &&
              (product == null ||
                  rows(
                    i,
                    'items',
                  ).any((r) => same(r['product_id'], product!['id']))) &&
              (dates == null ||
                  (date.compareTo(
                            dates!.start.toIso8601String().substring(0, 10),
                          ) >=
                          0 &&
                      date.compareTo(
                            dates!.end.toIso8601String().substring(0, 10),
                          ) <=
                          0)) &&
              switch (status) {
                'due' => amount > paid,
                'paid' => i['status'] != 'void' && amount <= paid,
                'partial' => i['status'] != 'void' && paid > 0 && amount > paid,
                'unpaid' => i['status'] != 'void' && paid == 0 && amount > 0,
                'returned' =>
                  hasReturns(i) ||
                      rows(
                        c.w.view,
                        'returns',
                      ).any((r) => same(r['invoice_id'], i['id'])),
                'cancelled' => i['status'] == 'void',
                'pending' => flag(i['pending']),
                _ => true,
              };
        }).toList()..sort(
          (a, b) => text(b['sale_date']).compareTo(text(a['sale_date'])) != 0
              ? text(b['sale_date']).compareTo(text(a['sale_date']))
              : text(b['created_at']).compareTo(text(a['created_at'])),
        );
    final current = index.clamp(
      0,
      filtered.isEmpty ? 0 : (filtered.length - 1) ~/ 50,
    );
    return PageBody(
      onRefresh: () => c.w.sync(),
      children: [
        SectionTitle(
          c.t('Sales & memos', 'বিক্রি ও মেমো'),
          subtitle: c.t(
            'Search, manage and print your invoices.',
            'ইনভয়েস খুঁজুন, পরিবর্তন ও প্রিন্ট করুন।',
          ),
          action: FilledButton.icon(
            onPressed: () => page(c, const SaleEditor()),
            icon: const Icon(Icons.add),
            label: Text(c.t('New sale', 'নতুন বিক্রি')),
          ),
        ),
        SearchField(
          hint: c.t('Invoice, customer or product', 'ইনভয়েস, কাস্টমার বা পণ্য'),
          onChanged: (v) => setState(() {
            search = v;
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
                final value = await showDateRangePicker(
                  context: c,
                  firstDate: DateTime(2000),
                  lastDate: DateTime(2100),
                  initialDateRange: dates,
                );
                if (value != null) {
                  setState(() {
                    dates = value;
                    index = 0;
                  });
                }
              },
            ),
            FilterChip(
              label: Text(
                customer == null
                    ? c.t('Customer', 'কাস্টমার')
                    : text(customer!['name']),
              ),
              selected: customer != null,
              onSelected: (_) async {
                final row = await pickRecord(c, products: false);
                if (row != null) {
                  setState(() {
                    customer = row;
                    index = 0;
                  });
                }
              },
            ),
            FilterChip(
              label: Text(
                product == null
                    ? c.t('Product', 'পণ্য')
                    : text(product!['name']),
              ),
              selected: product != null,
              onSelected: (_) async {
                final row = await pickRecord(c, products: true);
                if (row != null) {
                  setState(() {
                    product = row;
                    index = 0;
                  });
                }
              },
            ),
            if (dates != null || customer != null || product != null)
              ActionChip(
                label: Text(c.t('Clear', 'মুছুন')),
                onPressed: () => setState(() {
                  dates = null;
                  customer = null;
                  product = null;
                  index = 0;
                }),
              ),
          ],
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          isExpanded: true,
          initialValue: status,
          decoration: InputDecoration(
            labelText: c.t('Payment status', 'পরিশোধের অবস্থা'),
          ),
          items:
              [
                    ['all', 'All invoices', 'সব ইনভয়েস'],
                    ['due', 'With due', 'বাকি আছে'],
                    ['paid', 'Paid', 'পরিশোধিত'],
                    ['partial', 'Partially paid', 'আংশিক পরিশোধ'],
                    ['unpaid', 'Unpaid', 'অপরিশোধিত'],
                    ['returned', 'With returns', 'ফেরত আছে'],
                    ['cancelled', 'Cancelled', 'বাতিল'],
                    ['pending', 'Pending Sync', 'Sync অপেক্ষমাণ'],
                  ]
                  .map(
                    (r) => DropdownMenuItem(
                      value: r[0],
                      child: Text(c.t(r[1], r[2])),
                    ),
                  )
                  .toList(),
          onChanged: (v) => setState(() {
            status = v!;
            index = 0;
          }),
        ),
        const SizedBox(height: 14),
        if (filtered.isEmpty)
          EmptyState(
            title: c.t('No invoices found', 'ইনভয়েস পাওয়া যায়নি'),
            message: c.t(
              'Create a new sale or clear your filters.',
              'নতুন বিক্রি যোগ করুন অথবা ফিল্টার মুছুন।',
            ),
            action: FilledButton(
              onPressed: () => page(c, const SaleEditor()),
              child: Text(c.t('Create sale', 'বিক্রি যোগ করুন')),
            ),
          ),
        for (final invoice in paged(filtered, current))
          Card(
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () => page(c, InvoiceScreen(id: text(invoice['id']))),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            text(invoice['invoice_no']),
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                            ),
                          ),
                        ),
                        Chip(
                          label: Text(invoiceStatus(c, invoice)),
                          visualDensity: VisualDensity.compact,
                        ),
                      ],
                    ),
                    Text(
                      '${invoice['customer_name']} · ${invoice['sale_date']}',
                    ),
                    const SizedBox(height: 8),
                    Text(
                      rows(
                        invoice,
                        'items',
                      ).map((r) => text(r['product_name'])).join(' · '),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const Divider(),
                    ValueRow(
                      c.t('Total', 'মোট'),
                      c.cash(invoice['net_total']),
                      bold: true,
                    ),
                    ValueRow(
                      c.t('Paid / Due', 'পরিশোধ / বাকি'),
                      '${c.cash(invoice['net_paid'])} / ${c.cash(invoice['due_amount'])}',
                    ),
                    Wrap(
                      spacing: 8,
                      children: [
                        TextButton.icon(
                          onPressed:
                              invoice['status'] != 'active' ||
                                  hasReturns(invoice) ||
                                  flag(invoice['pending'])
                              ? null
                              : () => page(
                                  c,
                                  SaleEditor(invoice: clone(invoice)),
                                ),
                          icon: const Icon(Icons.edit_outlined),
                          label: Text(c.t('Edit', 'সম্পাদনা')),
                        ),
                        TextButton.icon(
                          onPressed:
                              invoice['status'] != 'active' ||
                                  flag(invoice['pending'])
                              ? null
                              : () => deleteInvoice(c, invoice),
                          icon: const Icon(Icons.delete_outline),
                          label: Text(c.t('Delete', 'মুছুন')),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ListPager(
          total: filtered.length,
          page: current,
          onPage: (v) => setState(() => index = v),
        ),
      ],
    );
  }
}

class _SaleLine {
  _SaleLine({this.product, int? quantity, double? rate})
    : quantity = TextEditingController(text: quantity?.toString() ?? ''),
      rate = TextEditingController(text: rate?.toString() ?? '');
  Json? product;
  final TextEditingController quantity, rate;
  void dispose() {
    quantity.dispose();
    rate.dispose();
  }
}

class SaleEditor extends StatefulWidget {
  const SaleEditor({super.key, this.invoice});
  final Json? invoice;
  @override
  State<SaleEditor> createState() => _SaleEditorState();
}

class _SaleEditorState extends State<SaleEditor> {
  final form = GlobalKey<FormState>();
  late String id;
  final date = TextEditingController(),
      memo = TextEditingController(),
      name = TextEditingController(),
      mobile = TextEditingController(),
      address = TextEditingController(),
      notes = TextEditingController(),
      discount = TextEditingController(),
      paid = TextEditingController();
  final lines = <_SaleLine>[];
  dynamic customerId;
  String account = '', discountType = '';
  bool saving = false, dirty = false, initialized = false;
  String? error;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (initialized) return;
    initialized = true;
    final i = widget.invoice;
    id = text(i?['id'] ?? context.w.uuid.v4());
    date.text = text(i?['sale_date']);
    memo.text = text(i?['invoice_no']);
    customerId = i?['customer_id'];
    name.text = text(i?['customer_name']);
    mobile.text = text(i?['customer_mobile']);
    address.text = text(i?['customer_address']);
    notes.text = text(i?['notes']);
    discount.text = text(i?['discount']);
    paid.text = text(i?['paid_amount']);
    account = text(i?['account']);
    discountType = i == null ? '' : 'amount';
    if (i != null) {
      for (final row in rows(i, 'items')) {
        lines.add(
          _SaleLine(
            product:
                context.w.find('products', row['product_id']) ??
                context.w.find('archived_products', row['product_id']),
            quantity: number(row['quantity']).toInt(),
            rate: number(row['rate']),
          ),
        );
      }
    }
    if (lines.isEmpty) lines.add(_SaleLine());
  }

  @override
  void dispose() {
    for (final c in [
      date,
      memo,
      name,
      mobile,
      address,
      notes,
      discount,
      paid,
    ]) {
      c.dispose();
    }
    for (final line in lines) {
      line.dispose();
    }
    super.dispose();
  }

  Json payload() => {
    'id': id,
    'sale_date': date.text,
    'invoice_no': memo.text.trim(),
    'customer_id': customerId,
    'customer_name': name.text.trim(),
    'customer_mobile': mobile.text.trim(),
    'customer_address': address.text.trim(),
    'notes': notes.text,
    'items': lines
        .map(
          (line) => {
            'product_id': line.product?['id'],
            'quantity': number(line.quantity.text),
            'rate': line.rate.text.trim().isEmpty
                ? null
                : number(line.rate.text),
          },
        )
        .toList(),
    'discount_type': discountType,
    'discount_value': number(discount.text),
    'paid_amount': number(paid.text),
    'account': account,
    if (widget.invoice != null) 'expected_version': widget.invoice!['version'],
  };
  Json draft() {
    final p = payload(), a = Ledger.amounts(p);
    return {
      ...p,
      ...a,
      'invoice_no': memo.text.trim().isEmpty ? 'DRAFT' : memo.text.trim(),
      'status': 'active',
      'draft': true,
      'returned_total': 0,
      'refunded': 0,
      'net_total': a['total_amount'],
      'net_paid': a['paid_amount'],
      'due_amount': money(number(a['total_amount']) - number(a['paid_amount'])),
      'items': List.generate(
        lines.length,
        (n) => {
          ...rows(a, 'items')[n],
          'product_name': lines[n].product?['name'] ?? '',
          'product_code': lines[n].product?['product_code'] ?? '',
          'returned_quantity': 0,
        },
      ),
    };
  }

  Future<void> submit() async {
    if (saving || !form.currentState!.validate()) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      final p = payload(), a = Ledger.amounts(p);
      final percent = number(a['subtotal']) == 0
          ? 0
          : number(a['discount']) / number(a['subtotal']) * 100;
      if (percent >
          number(context.w.view['settings']?['large_discount_percent'] ?? 20)) {
        if (!await confirm(
          context,
          title: context.t('Confirm large discount', 'বড় ছাড় নিশ্চিত করুন'),
          message: '${context.qty(percent)}% · ${context.cash(a['discount'])}',
        )) {
          return;
        }
        p['confirm_discount'] = true;
      }
      if (!mounted) return;
      await context.w.command(
        widget.invoice == null ? 'POST' : 'PATCH',
        widget.invoice == null ? '/api/invoices' : '/api/invoices/$id',
        p,
      );
      dirty = false;
      if (mounted) {
        final navigator = Navigator.of(context);
        navigator.pop();
        await navigator.push(
          MaterialPageRoute(builder: (_) => InvoiceScreen(id: id)),
        );
      }
    } catch (e) {
      if (mounted) setState(() => error = errorMessage(context, e));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> preview(String action) async {
    if (!form.currentState!.validate()) return;
    await runAction(context, () async {
      final i = draft(),
          settings = object(context.w.view['settings'] ?? {}),
          bn = context.w.language == 'bn';
      if (action == 'preview') {
        await page(context, InvoiceScreen(id: id, draft: i));
        return;
      }
      final bytes = await Documents.invoice(i, settings, bengali: bn);
      if (action == 'print') {
        await Documents.printPdf(bytes);
      } else {
        await Documents.share(bytes, 'Arafat-Draft.pdf');
      }
    });
  }

  Widget lineCard(_SaleLine line, int index) {
    final product = line.product;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${context.t('Item', 'পণ্য')} ${context.qty(index + 1)}',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
                if (lines.length > 1)
                  IconButton(
                    tooltip: context.t('Remove item', 'পণ্য বাদ দিন'),
                    onPressed: () {
                      setState(() {
                        lines.remove(line);
                        dirty = true;
                      });
                      line.dispose();
                    },
                    icon: const Icon(Icons.delete_outline),
                  ),
              ],
            ),
            FormField<dynamic>(
              validator: (_) => line.product == null
                  ? context.t('Choose a product', 'পণ্য নির্বাচন করুন')
                  : null,
              builder: (field) => InkWell(
                onTap: () async {
                  final row = await pickRecord(context, products: true);
                  if (row != null) {
                    setState(() {
                      line.product = row;
                      dirty = true;
                      field.didChange(row['id']);
                    });
                  }
                },
                child: InputDecorator(
                  decoration: InputDecoration(
                    labelText: context.t('Product', 'পণ্য'),
                    errorText: field.errorText,
                    suffixIcon: const Icon(Icons.search),
                  ),
                  child: Text(
                    product == null
                        ? context.t(
                            'Tap to choose product',
                            'পণ্য নির্বাচন করতে চাপুন',
                          )
                        : text(product['name']),
                  ),
                ),
              ),
            ),
            if (product != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '${context.t('Available', 'মজুত')}: ${context.qty(product['current_stock'])} ${context.t('bags', 'বস্তা')} · ${product['product_code']}',
                  ),
                ),
              ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: NumberField(
                    controller: line.quantity,
                    label: context.t('Bags', 'বস্তা'),
                    integer: true,
                    allowZero: false,
                    onChanged: (_) => setState(() => dirty = true),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: NumberField(
                    controller: line.rate,
                    label: context.t('Rate / bag', 'দর / বস্তা'),
                    onChanged: (_) => setState(() => dirty = true),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                context.cash(
                  number(line.quantity.text) * number(line.rate.text),
                ),
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext c) {
    Json? totals;
    try {
      totals = Ledger.amounts(payload());
    } catch (_) {}
    return DraftGuard(
      dirty: dirty,
      saving: saving,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            widget.invoice == null
                ? c.t('New sale', 'নতুন বিক্রি')
                : c.t('Edit invoice', 'ইনভয়েস সম্পাদনা'),
          ),
        ),
        body: Form(
          key: form,
          onChanged: () {
            if (!dirty) setState(() => dirty = true);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 140),
            children: [
              DateField(
                controller: date,
                label: c.t('Sale date', 'বিক্রির তারিখ'),
              ),
              const SizedBox(height: 16),
              FormField<dynamic>(
                validator: (_) => customerId == null
                    ? c.t('Choose a customer', 'কাস্টমার নির্বাচন করুন')
                    : null,
                builder: (field) => InkWell(
                  onTap: () async {
                    final row = await pickRecord(
                      c,
                      products: false,
                      allowNew: true,
                    );
                    if (row != null) {
                      setState(() {
                        customerId = row['id'];
                        name.text = text(row['name']);
                        mobile.text = text(row['mobile']);
                        address.text = text(row['address']);
                        field.didChange(customerId);
                      });
                    }
                  },
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: c.t('Customer', 'কাস্টমার'),
                      errorText: field.errorText,
                      suffixIcon: const Icon(Icons.person_search),
                    ),
                    child: Text(
                      customerId == null
                          ? c.t(
                              'Choose or add customer',
                              'কাস্টমার নির্বাচন অথবা যোগ করুন',
                            )
                          : customerId == 'new'
                          ? c.t('New customer', 'নতুন কাস্টমার')
                          : name.text,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: name,
                maxLength: 200,
                decoration: InputDecoration(
                  labelText: c.t(
                    'Customer name on memo',
                    'মেমোতে কাস্টমারের নাম',
                  ),
                ),
                validator: (v) => (v ?? '').trim().isEmpty
                    ? c.t('Enter customer name', 'কাস্টমারের নাম দিন')
                    : null,
              ),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: mobile,
                      maxLength: 50,
                      keyboardType: TextInputType.phone,
                      decoration: InputDecoration(
                        labelText: c.t('Mobile', 'মোবাইল'),
                      ),
                    ),
                  ),
                ],
              ),
              TextFormField(
                controller: address,
                maxLength: 1000,
                maxLines: 2,
                decoration: InputDecoration(
                  labelText: c.t('Address', 'ঠিকানা'),
                ),
              ),
              const SizedBox(height: 12),
              for (var n = 0; n < lines.length; n++) lineCard(lines[n], n),
              OutlinedButton.icon(
                onPressed: lines.length >= 40
                    ? null
                    : () => setState(() {
                        lines.add(_SaleLine());
                        dirty = true;
                      }),
                icon: const Icon(Icons.add),
                label: Text(c.t('Add another product', 'আরেকটি পণ্য যোগ করুন')),
              ),
              const SizedBox(height: 18),
              DropdownButtonFormField<String>(
                initialValue: discountType.isEmpty ? null : discountType,
                decoration: InputDecoration(
                  labelText: c.t('Discount type', 'ছাড়ের ধরন'),
                ),
                items: [
                  DropdownMenuItem(
                    value: 'amount',
                    child: Text(c.t('Discount amount', 'ছাড়ের পরিমাণ')),
                  ),
                  DropdownMenuItem(
                    value: 'percent',
                    child: Text(c.t('Discount %', 'ছাড় %')),
                  ),
                ],
                validator: (_) =>
                    number(discount.text) > 0 && discountType.isEmpty
                    ? c.t('Choose an option', 'নির্বাচন করুন')
                    : null,
                onChanged: (v) => setState(() {
                  discountType = v ?? '';
                  dirty = true;
                }),
              ),
              const SizedBox(height: 12),
              NumberField(
                controller: discount,
                label: c.t('Discount', 'ছাড়'),
                required: false,
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 16),
              NumberField(
                controller: paid,
                label: c.t('Paid amount', 'পরিশোধ'),
                onChanged: (_) => setState(() {}),
              ),
              Wrap(
                spacing: 8,
                children: [
                  TextButton(
                    onPressed: () => setState(() => paid.text = '0'),
                    child: Text(c.t('Pay later', 'বাকিতে')),
                  ),
                  TextButton(
                    onPressed: () => runAction(c, () async {
                      final p = payload()..['paid_amount'] = 0;
                      final total = Ledger.amounts(p)['total_amount'];
                      if (mounted) {
                        setState(() {
                          paid.text = text(total);
                          dirty = true;
                        });
                      }
                    }),
                    child: Text(c.t('Full payment', 'পুরো পরিশোধ')),
                  ),
                ],
              ),
              DropdownButtonFormField<String>(
                initialValue: account.isEmpty ? null : account,
                key: const ValueKey('sale-account'),
                decoration: InputDecoration(labelText: c.t('Account', 'হিসাব')),
                items: [
                  DropdownMenuItem(
                    value: 'Cash',
                    child: Text(c.t('Cash', 'ক্যাশ')),
                  ),
                  DropdownMenuItem(
                    value: 'Bank',
                    child: Text(c.t('Bank', 'ব্যাংক')),
                  ),
                ],
                validator: (_) => account.isEmpty
                    ? c.t(
                        'Choose Cash or Bank.',
                        'ক্যাশ অথবা ব্যাংক নির্বাচন করুন।',
                      )
                    : null,
                onChanged: (v) => setState(() {
                  account = v ?? '';
                  dirty = true;
                }),
              ),
              const SizedBox(height: 16),
              Card(
                color: Theme.of(c).colorScheme.primaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      ValueRow(
                        c.t('Subtotal', 'ছাড়ের আগের মোট'),
                        totals == null ? '—' : c.cash(totals['subtotal']),
                      ),
                      ValueRow(
                        c.t('Discount', 'ছাড়'),
                        totals == null ? '—' : c.cash(totals['discount']),
                      ),
                      ValueRow(
                        c.t('Total', 'মোট'),
                        totals == null ? '—' : c.cash(totals['total_amount']),
                        bold: true,
                      ),
                      ValueRow(
                        c.t('Due', 'বাকি'),
                        totals == null
                            ? '—'
                            : c.cash(
                                number(totals['total_amount']) -
                                    number(totals['paid_amount']),
                              ),
                        bold: true,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: memo,
                maxLength: 100,
                decoration: InputDecoration(
                  labelText: c.t(
                    'Invoice number (optional)',
                    'ইনভয়েস নম্বর (ঐচ্ছিক)',
                  ),
                ),
              ),
              TextFormField(
                controller: notes,
                maxLines: 3,
                decoration: InputDecoration(labelText: c.t('Notes', 'নোট')),
              ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(
                    error!,
                    style: TextStyle(color: Theme.of(c).colorScheme.error),
                  ),
                ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: () => preview('preview'),
                    icon: const Icon(Icons.receipt_long_outlined),
                    label: Text(c.t('Preview', 'দেখুন')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => preview('print'),
                    icon: const Icon(Icons.print_outlined),
                    label: Text(c.t('Print', 'প্রিন্ট')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => preview('share'),
                    icon: const Icon(Icons.share_outlined),
                    label: Text(c.t('Share', 'শেয়ার')),
                  ),
                ],
              ),
            ],
          ),
        ),
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: FilledButton.icon(
              onPressed: saving ? null : submit,
              icon: const Icon(Icons.check),
              label: Text(
                saving
                    ? c.t('Saving…', 'সেভ হচ্ছে…')
                    : c.t('Save sale', 'বিক্রি সেভ করুন'),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class InvoiceScreen extends StatelessWidget {
  const InvoiceScreen({super.key, required this.id, this.draft});
  final String id;
  final Json? draft;
  Future<void> document(BuildContext c, Json invoice, String action) async {
    await runAction(c, () async {
      final bytes = await Documents.invoice(
        invoice,
        object(c.w.view['settings'] ?? {}),
        bengali: c.w.language == 'bn',
      );
      final name =
          'Arafat-Invoice-${text(invoice['invoice_no']).replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.pdf';
      if (action == 'print') {
        await Documents.printPdf(bytes);
      } else if (action == 'save') {
        await Documents.saveBytes(name, bytes);
      } else {
        try {
          await Documents.share(bytes, name);
        } catch (_) {
          if (c.mounted) {
            await showDialog<void>(
              context: c,
              builder: (d) => AlertDialog(
                title: Text(c.t('Copy invoice', 'ইনভয়েস কপি করুন')),
                content: SingleChildScrollView(
                  child: SelectableText(
                    '${invoice['invoice_no']}\n${invoice['customer_name']}\n${c.t('Total', 'মোট')}: ${c.cash(invoice['net_total'] ?? invoice['total_amount'])}\n${c.t('Due', 'বাকি')}: ${c.cash(invoice['due_amount'])}',
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(d),
                    child: Text(c.t('Close', 'বন্ধ করুন')),
                  ),
                ],
              ),
            );
          }
        }
      }
    });
  }

  @override
  Widget build(BuildContext c) {
    final invoice = draft ?? c.w.find('invoices', id);
    if (invoice == null) {
      return Scaffold(
        appBar: AppBar(),
        body: EmptyState(
          title: c.t('Invoice not found', 'ইনভয়েস পাওয়া যায়নি'),
          message: c.t('Refresh and try again.', 'Sync করে আবার দেখুন।'),
        ),
      );
    }
    final settings = object(c.w.view['settings'] ?? {}),
        editable =
            invoice['status'] != 'void' &&
            !hasReturns(invoice) &&
            !flag(invoice['pending']) &&
            draft == null;
    final canReturn =
        invoice['status'] != 'void' &&
        rows(
          invoice,
          'items',
        ).any((i) => number(i['quantity']) > number(i['returned_quantity'])) &&
        !flag(invoice['pending']) &&
        draft == null;
    return Scaffold(
      appBar: AppBar(title: Text(text(invoice['invoice_no']))),
      body: PageBody(
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Image.asset(
                        'assets/brand/arafat-growth-logo.png',
                        width: 65,
                        height: 65,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              text(settings['name'] ?? 'Arafat Traders'),
                              style: Theme.of(c).textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            Text(
                              text(settings['phone'] ?? '+8801646130402'),
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            if (text(settings['address']).isNotEmpty)
                              Text(text(settings['address'])),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 28),
                  Text(
                    text(invoice['invoice_no']),
                    style: Theme.of(c).textTheme.titleLarge,
                  ),
                  Text(text(invoice['sale_date'])),
                  if (draft != null)
                    Chip(
                      label: Text(c.t('Draft — not saved', 'খসড়া — সেভ হয়নি')),
                    )
                  else
                    Chip(label: Text(invoiceStatus(c, invoice))),
                  Text(
                    text(invoice['customer_name']),
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  if (text(invoice['customer_mobile']).isNotEmpty)
                    Text(text(invoice['customer_mobile'])),
                  if (text(invoice['customer_address']).isNotEmpty)
                    Text(text(invoice['customer_address'])),
                  const Divider(height: 28),
                  for (final item in rows(invoice, 'items'))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            text(item['product_name']),
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          ValueRow(
                            '${c.qty(item['quantity'])} × ${c.cash(item['rate'])}',
                            c.cash(item['line_total']),
                          ),
                          if (number(item['returned_quantity']) > 0)
                            Text(
                              '${c.t('Returned', 'ফেরত')}: ${c.qty(item['returned_quantity'])} ${c.t('bags', 'বস্তা')}',
                            ),
                        ],
                      ),
                    ),
                  const Divider(),
                  ValueRow(
                    c.t('Subtotal', 'ছাড়ের আগের মোট'),
                    c.cash(invoice['subtotal']),
                  ),
                  ValueRow(c.t('Discount', 'ছাড়'), c.cash(invoice['discount'])),
                  if (number(invoice['returned_total']) > 0)
                    ValueRow(
                      c.t('Return credit', 'ফেরতের সমন্বয়'),
                      c.cash(invoice['returned_total']),
                    ),
                  ValueRow(
                    c.t('Total', 'মোট'),
                    c.cash(invoice['net_total'] ?? invoice['total_amount']),
                    bold: true,
                  ),
                  ValueRow(
                    c.t('Paid', 'পরিশোধ'),
                    c.cash(invoice['net_paid'] ?? invoice['paid_amount']),
                  ),
                  if (number(invoice['refunded']) > 0)
                    ValueRow(
                      c.t('Refunded', 'ফেরত দেওয়া'),
                      c.cash(invoice['refunded']),
                    ),
                  ValueRow(
                    c.t('Due', 'বাকি'),
                    c.cash(invoice['due_amount']),
                    bold: true,
                  ),
                  ValueRow(
                    c.t('Account', 'হিসাব'),
                    enumLabel(c, text(invoice['account'])),
                  ),
                  if (text(invoice['notes']).isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: SelectableText(text(invoice['notes'])),
                    ),
                  const SizedBox(height: 16),
                  Text(
                    c.t(
                      'Separate customer collections appear in the customer account.',
                      'আলাদা আদায় কাস্টমারের হিসাবে দেখানো হয়।',
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: () => document(c, invoice, 'save'),
                icon: const Icon(Icons.download),
                label: Text(c.t('Download PDF', 'PDF নামান')),
              ),
              OutlinedButton.icon(
                onPressed: () => document(c, invoice, 'print'),
                icon: const Icon(Icons.print),
                label: Text(c.t('Print', 'প্রিন্ট')),
              ),
              OutlinedButton.icon(
                onPressed: () => document(c, invoice, 'share'),
                icon: const Icon(Icons.share),
                label: Text(c.t('Share', 'শেয়ার')),
              ),
              if (editable)
                OutlinedButton.icon(
                  onPressed: () => page(c, SaleEditor(invoice: clone(invoice))),
                  icon: const Icon(Icons.edit_outlined),
                  label: Text(c.t('Edit', 'সম্পাদনা')),
                ),
              if (canReturn)
                OutlinedButton.icon(
                  onPressed: () =>
                      page(c, ReturnEditor(invoice: clone(invoice))),
                  icon: const Icon(Icons.assignment_return_outlined),
                  label: Text(c.t('Return', 'ফেরত')),
                ),
              if (draft == null &&
                  invoice['status'] != 'void' &&
                  !flag(invoice['pending']))
                OutlinedButton.icon(
                  onPressed: () async {
                    if (await confirm(
                          c,
                          title: c.t('Cancel invoice?', 'ইনভয়েস বাতিল করবেন?'),
                          message:
                              '${invoice['invoice_no']}\n${invoice['customer_name']}\n${c.t('Stock and financial effects will be reversed; history remains.', 'মজুত ও হিসাবের প্রভাব উল্টানো হবে; ইতিহাস থাকবে।')}',
                          destructive: true,
                        ) &&
                        c.mounted) {
                      await runAction(
                        c,
                        () => c.w.command('DELETE', '/api/invoices/$id', {
                          'expected_version': invoice['version'],
                          'confirmed': true,
                        }),
                      );
                    }
                  },
                  icon: const Icon(Icons.cancel_outlined),
                  label: Text(c.t('Cancel invoice', 'ইনভয়েস বাতিল')),
                ),
            ],
          ),
          if (flag(invoice['pending']))
            Padding(
              padding: const EdgeInsets.only(top: 14),
              child: Text(
                c.t(
                  'Sync this invoice before editing or returning.',
                  'পরিবর্তন বা ফেরতের আগে ইনভয়েসটি Sync করুন।',
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class ReturnEditor extends StatefulWidget {
  const ReturnEditor({super.key, required this.invoice});
  final Json invoice;
  @override
  State<ReturnEditor> createState() => _ReturnEditorState();
}

class _ReturnEditorState extends State<ReturnEditor> {
  final form = GlobalKey<FormState>(),
      date = TextEditingController(),
      reason = TextEditingController();
  final quantities = <String, TextEditingController>{};
  bool? restock;
  bool saving = false, dirty = false;
  String? error;
  @override
  void initState() {
    super.initState();
    for (final item in rows(widget.invoice, 'items')) {
      quantities[text(item['id'])] = TextEditingController();
    }
  }

  @override
  void dispose() {
    date.dispose();
    reason.dispose();
    for (final c in quantities.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> submit() async {
    if (!form.currentState!.validate() || saving) return;
    final items = [
      for (final item in rows(widget.invoice, 'items'))
        if (number(quantities[text(item['id'])]!.text) > 0)
          {
            'id': item['id'],
            'quantity': bags(quantities[text(item['id'])]!.text),
          },
    ];
    if (items.isEmpty) {
      setState(
        () => error = context.t(
          'Enter at least one return quantity.',
          'অন্তত একটি পণ্যের ফেরতের পরিমাণ দিন।',
        ),
      );
      return;
    }
    if (!await confirm(
      context,
      title: context.t('Confirm return', 'ফেরত নিশ্চিত করুন'),
      message:
          '${widget.invoice['invoice_no']}\n${context.t('This changes stock, due and any refund.', 'এতে মজুত, বাকি ও ফেরত টাকার হিসাব বদলাবে।')}',
    )) {
      return;
    }
    if (!mounted) return;
    setState(() => saving = true);
    try {
      await context.w
          .command('POST', '/api/invoices/${widget.invoice['id']}/return', {
            'expected_version': widget.invoice['version'],
            'confirmed': true,
            'return_date': date.text,
            'reason': reason.text.trim(),
            'restock': restock,
            'items': items,
          });
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = errorMessage(context, e));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext c) => DraftGuard(
    dirty: dirty,
    saving: saving,
    child: Scaffold(
      appBar: AppBar(title: Text(c.t('Return products', 'পণ্য ফেরত'))),
      body: Form(
        key: form,
        onChanged: () {
          if (!dirty) setState(() => dirty = true);
        },
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              text(widget.invoice['invoice_no']),
              style: Theme.of(c).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            DateField(
              controller: date,
              label: c.t('Return date', 'ফেরতের তারিখ'),
            ),
            const SizedBox(height: 16),
            for (final item in rows(widget.invoice, 'items'))
              Padding(
                padding: const EdgeInsets.only(bottom: 18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      text(item['product_name']),
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      '${c.t('Remaining', 'অবশিষ্ট')}: ${c.qty(number(item['quantity']) - number(item['returned_quantity']))}',
                    ),
                    NumberField(
                      controller: quantities[text(item['id'])]!,
                      integer: true,
                      required: false,
                      maximum:
                          number(item['quantity']) -
                          number(item['returned_quantity']),
                      label: c.t('Return bags', 'ফেরতের বস্তা'),
                    ),
                  ],
                ),
              ),
            TextFormField(
              controller: reason,
              maxLines: 3,
              decoration: InputDecoration(labelText: c.t('Reason', 'কারণ')),
              validator: (v) => (v ?? '').trim().isEmpty
                  ? c.t('Enter a reason', 'কারণ লিখুন')
                  : null,
            ),
            DropdownButtonFormField<bool>(
              decoration: InputDecoration(
                labelText: c.t(
                  'Return stock to available inventory',
                  'ফেরত পণ্য মজুতে যোগ করুন',
                ),
              ),
              items: [
                DropdownMenuItem(value: true, child: Text(c.t('Yes', 'হ্যাঁ'))),
                DropdownMenuItem(value: false, child: Text(c.t('No', 'না'))),
              ],
              validator: (v) =>
                  v == null ? c.t('Choose an option', 'নির্বাচন করুন') : null,
              onChanged: (v) => setState(() {
                restock = v;
                dirty = true;
              }),
            ),
            if (error != null)
              Text(
                error!,
                style: TextStyle(color: Theme.of(c).colorScheme.error),
              ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: saving ? null : submit,
              icon: const Icon(Icons.check),
              label: Text(c.t('Save return', 'ফেরত সেভ করুন')),
            ),
          ],
        ),
      ),
    ),
  );
}
