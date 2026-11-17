import 'package:flutter/material.dart';
import '../core/types.dart';
import '../widgets/common.dart';

String enumLabel(BuildContext c, String value) {
  const labels = {
    'Fish feed': 'মাছের খাবার',
    'Cattle feed': 'গরুর খাবার',
    'Poultry feed': 'হাঁস-মুরগির খাবার',
    'Cash': 'ক্যাশ',
    'Bank': 'ব্যাংক',
    'Pending': 'অপেক্ষমাণ',
    'Confirmed': 'নিশ্চিত',
    'Delivered': 'প্রাপ্ত',
    'Return': 'ফেরত',
    'Damage': 'ক্ষতি',
    'Loss': 'হারানো',
    'Manual Add': 'মজুত যোগ',
    'Manual Minus': 'মজুত কমানো',
    'Expense': 'খরচ',
    'Transport Cost': 'পরিবহন খরচ',
    'Other Expense': 'অন্যান্য খরচ',
    'Other Income': 'অন্যান্য আয়',
    'Company Payment': 'কোম্পানিকে পরিশোধ',
    'Bank Deposit': 'ক্যাশ থেকে ব্যাংক',
    'Bank Withdraw': 'ব্যাংক থেকে ক্যাশ',
  };
  return c.w.language == 'bn' ? (labels[value] ?? value) : value;
}

Future<Json?> pickRecord(
  BuildContext context, {
  required bool products,
  bool allowNew = false,
}) => showModalBottomSheet<Json>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (c) => _RecordPicker(products: products, allowNew: allowNew),
);

class _RecordPicker extends StatefulWidget {
  const _RecordPicker({required this.products, required this.allowNew});
  final bool products, allowNew;
  @override
  State<_RecordPicker> createState() => _RecordPickerState();
}

class _RecordPickerState extends State<_RecordPicker> {
  String query = '', category = '';
  @override
  Widget build(BuildContext c) {
    final list = rows(c.w.view, widget.products ? 'products' : 'customers')
        .where(
          (r) =>
              (category.isEmpty || r['category'] == category) &&
              '${r['name']} ${r['product_code'] ?? ''} ${r['mobile'] ?? ''}'
                  .toLowerCase()
                  .contains(query.toLowerCase()),
        )
        .take(100)
        .toList();
    return SizedBox(
      height: MediaQuery.sizeOf(c).height * .86,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            SectionTitle(
              widget.products
                  ? c.t('Choose product', 'পণ্য নির্বাচন')
                  : c.t('Choose customer', 'কাস্টমার নির্বাচন'),
            ),
            SearchField(
              hint: c.t('Name, code or mobile', 'নাম, কোড বা মোবাইল'),
              onChanged: (v) => setState(() => query = v),
            ),
            if (widget.products)
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final value in [
                      '',
                      'Fish feed',
                      'Cattle feed',
                      'Poultry feed',
                    ])
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(
                            value.isEmpty
                                ? c.t('All', 'সব')
                                : enumLabel(c, value),
                          ),
                          selected: category == value,
                          onSelected: (_) => setState(() => category = value),
                        ),
                      ),
                  ],
                ),
              ),
            if (widget.allowNew)
              ListTile(
                leading: const Icon(Icons.person_add_alt_1),
                title: Text(c.t('New customer', 'নতুন কাস্টমার')),
                onTap: () => Navigator.pop(c, {'id': 'new', 'name': ''}),
              ),
            Expanded(
              child: list.isEmpty
                  ? EmptyState(
                      title: c.t('No matches', 'মিল পাওয়া যায়নি'),
                      message: c.t(
                        'Try a different name or code.',
                        'অন্য নাম বা কোড দিয়ে খুঁজুন।',
                      ),
                    )
                  : ListView.builder(
                      itemCount: list.length,
                      itemBuilder: (c, i) {
                        final r = list[i];
                        return ListTile(
                          contentPadding: const EdgeInsets.symmetric(
                            vertical: 6,
                            horizontal: 4,
                          ),
                          leading: CircleAvatar(
                            child: Icon(
                              widget.products
                                  ? Icons.inventory_2_outlined
                                  : Icons.person_outline,
                            ),
                          ),
                          title: Text(
                            text(r['name']),
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            widget.products
                                ? '${r['product_code'] ?? ''} · ${c.qty(r['current_stock'])} ${c.t('bags available', 'বস্তা আছে')} · ${c.cash(r['default_rate'])}'
                                : '${r['mobile'] ?? ''} · ${c.t('Due', 'বাকি')} ${c.cash(r['current_due'])}',
                          ),
                          onTap: () => Navigator.pop(c, r),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class FieldSpec {
  const FieldSpec(
    this.keyName,
    this.en,
    this.bn, {
    this.kind = 'text',
    this.required = false,
    this.options = const [],
  });
  final String keyName, en, bn, kind;
  final bool required;
  final List<String> options;
}

List<FieldSpec> specs(String entity, bool edit) => switch (entity) {
  'products' => [
    const FieldSpec('name', 'Product name', 'পণ্যের নাম', required: true),
    const FieldSpec('product_code', 'Product code', 'পণ্যের কোড'),
    const FieldSpec(
      'category',
      'Category',
      'ধরন',
      kind: 'choice',
      options: ['Fish feed', 'Cattle feed', 'Poultry feed'],
    ),
    const FieldSpec('feed_size', 'Feed size / texture', 'খাবারের আকার'),
    const FieldSpec(
      'protein_percent',
      'Protein (%)',
      'প্রোটিন (%)',
      kind: 'optionalMoney',
    ),
    const FieldSpec(
      'bag_weight',
      'Pack weight (kg)',
      'প্যাকেটের ওজন (কেজি)',
      kind: 'positive',
    ),
    const FieldSpec(
      'default_rate',
      'Price per bag',
      'প্রতি বস্তার দর',
      kind: 'money',
    ),
    const FieldSpec(
      'low_stock_level',
      'Low stock alert (bags)',
      'কম মজুতের সতর্কতা (বস্তা)',
      kind: 'integer',
    ),
    if (edit) ...[
      const FieldSpec(
        'current_stock',
        'Current bags',
        'বর্তমান বস্তা',
        kind: 'integer',
      ),
      const FieldSpec(
        'stock_reason',
        'Stock change reason',
        'মজুত পরিবর্তনের কারণ',
        kind: 'multiline',
      ),
    ] else
      const FieldSpec(
        'opening_stock',
        'Opening bags',
        'শুরুর বস্তা',
        kind: 'integer',
      ),
  ],
  'customers' => [
    const FieldSpec('name', 'Customer name', 'কাস্টমারের নাম', required: true),
    const FieldSpec('mobile', 'Mobile', 'মোবাইল', kind: 'phone'),
    const FieldSpec('address', 'Address', 'ঠিকানা', kind: 'multiline'),
    if (!edit)
      const FieldSpec(
        'opening_due',
        'Opening due',
        'শুরুর বাকি',
        kind: 'money',
      ),
  ],
  'payments' => [
    const FieldSpec(
      'payment_date',
      'Payment date',
      'পরিশোধের তারিখ',
      kind: 'date',
    ),
    const FieldSpec(
      'customer_id',
      'Customer',
      'কাস্টমার',
      kind: 'customer',
      required: true,
    ),
    const FieldSpec('amount', 'Amount', 'পরিমাণ', kind: 'positive'),
    const FieldSpec(
      'account',
      'Account',
      'হিসাব',
      kind: 'choice',
      options: ['Cash', 'Bank'],
    ),
    const FieldSpec('notes', 'Notes', 'নোট', kind: 'multiline'),
  ],
  'orders' => [
    const FieldSpec('order_date', 'Order date', 'অর্ডারের তারিখ', kind: 'date'),
    const FieldSpec(
      'product_id',
      'Product',
      'পণ্য',
      kind: 'product',
      required: true,
    ),
    const FieldSpec('quantity', 'Bags', 'বস্তা', kind: 'positiveInteger'),
    const FieldSpec(
      'bag_weight',
      'Pack weight (kg)',
      'প্যাকেটের ওজন (কেজি)',
      kind: 'positive',
    ),
    const FieldSpec(
      'rate',
      'Company rate per bag',
      'কোম্পানির প্রতি বস্তার দর',
      kind: 'money',
    ),
    const FieldSpec(
      'status',
      'Status',
      'অবস্থা',
      kind: 'choice',
      options: ['Pending', 'Confirmed', 'Delivered'],
    ),
    const FieldSpec(
      'delivery_date',
      'Delivery date',
      'পণ্য প্রাপ্তির তারিখ',
      kind: 'date',
    ),
    const FieldSpec('invoice_no', 'Challan number', 'চালান নম্বর'),
    const FieldSpec('notes', 'Notes', 'নোট', kind: 'multiline'),
  ],
  'adjustments' => [
    const FieldSpec(
      'adjust_date',
      'Adjustment date',
      'সমন্বয়ের তারিখ',
      kind: 'date',
    ),
    const FieldSpec(
      'product_id',
      'Product',
      'পণ্য',
      kind: 'product',
      required: true,
    ),
    const FieldSpec(
      'type',
      'Adjustment type',
      'সমন্বয়ের ধরন',
      kind: 'choice',
      options: ['Manual Add', 'Manual Minus', 'Damage', 'Loss', 'Return'],
    ),
    const FieldSpec('quantity', 'Bags', 'বস্তা', kind: 'positiveInteger'),
    const FieldSpec(
      'notes',
      'Reason / notes',
      'কারণ / নোট',
      kind: 'multiline',
      required: true,
    ),
  ],
  'transactions' => [
    const FieldSpec(
      'txn_date',
      'Transaction date',
      'লেনদেনের তারিখ',
      kind: 'date',
    ),
    const FieldSpec(
      'type',
      'Type',
      'ধরন',
      kind: 'choice',
      options: [
        'Other Income',
        'Company Payment',
        'Bank Deposit',
        'Bank Withdraw',
        'Expense',
        'Transport Cost',
        'Other Expense',
      ],
    ),
    const FieldSpec('amount', 'Amount', 'পরিমাণ', kind: 'positive'),
    const FieldSpec(
      'account',
      'Account',
      'হিসাব',
      kind: 'choice',
      options: ['Cash', 'Bank'],
    ),
    const FieldSpec('category', 'Expense category', 'খরচের বিভাগ'),
    const FieldSpec('reference', 'Reference', 'রেফারেন্স'),
    const FieldSpec('notes', 'Notes', 'নোট', kind: 'multiline'),
  ],
  'settings' => [
    const FieldSpec('name', 'Business name', 'ব্যবসার নাম', required: true),
    const FieldSpec('phone', 'Mobile', 'মোবাইল', kind: 'phone'),
    const FieldSpec('address', 'Address', 'ঠিকানা', kind: 'multiline'),
    const FieldSpec(
      'large_discount_percent',
      'Large discount confirmation (%)',
      'বড় ছাড় নিশ্চিতকরণের সীমা (%)',
      kind: 'money',
    ),
  ],
  _ => [],
};

class RecordEditor extends StatefulWidget {
  const RecordEditor({
    super.key,
    required this.entity,
    this.initial,
    this.defaults = const {},
  });
  final String entity;
  final Json? initial;
  final Json defaults;
  @override
  State<RecordEditor> createState() => _RecordEditorState();
}

class _RecordEditorState extends State<RecordEditor> {
  final form = GlobalKey<FormState>();
  late final List<FieldSpec> fields;
  final controls = <String, TextEditingController>{};
  final selected = <String, Json>{};
  bool saving = false, dirty = false;
  String? failure;
  Json? originalTransfer;
  bool capturedTransfer = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (capturedTransfer) return;
    capturedTransfer = true;
    final transfer = widget.initial?['transfer_id'];
    if (widget.entity == 'transactions' && transfer != null) {
      for (final row in rows(context.w.view, 'transactions')) {
        if (row['transfer_id'] == transfer &&
            !same(row['id'], widget.initial!['id'])) {
          originalTransfer = clone(row);
          break;
        }
      }
    }
  }

  @override
  void initState() {
    super.initState();
    var nextFields = specs(widget.entity, widget.initial != null);
    if (widget.entity == 'transactions' && widget.initial != null) {
      final transfer = widget.initial!['transfer_id'] != null;
      nextFields = nextFields
          .map(
            (f) => f.keyName != 'type'
                ? f
                : FieldSpec(
                    f.keyName,
                    f.en,
                    f.bn,
                    kind: 'choice',
                    options: f.options
                        .where(
                          (v) =>
                              ['Bank Deposit', 'Bank Withdraw'].contains(v) ==
                              transfer,
                        )
                        .toList(),
                  ),
          )
          .toList();
    }
    fields = nextFields;
    for (final f in fields) {
      final value = widget.initial?[f.keyName] ?? '';
      final controller = TextEditingController(
        text: value == null ? '' : text(value),
      );
      var previous = controller.text;
      controller.addListener(() {
        if (controller.text == previous) return;
        previous = controller.text;
        if (!dirty && mounted) setState(() => dirty = true);
      });
      controls[f.keyName] = controller;
    }
  }

  @override
  void dispose() {
    for (final c in controls.values) {
      c.dispose();
    }
    super.dispose();
  }

  String get titleEn => switch (widget.entity) {
    'products' => 'Product',
    'customers' => 'Customer',
    'payments' => 'Payment',
    'orders' => 'Company order',
    'adjustments' => 'Stock adjustment',
    'transactions' => 'Transaction',
    'settings' => 'Business settings',
    _ => 'Record',
  };
  String get titleBn => switch (widget.entity) {
    'products' => 'পণ্য',
    'customers' => 'কাস্টমার',
    'payments' => 'পরিশোধ',
    'orders' => 'কোম্পানির অর্ডার',
    'adjustments' => 'মজুত সমন্বয়',
    'transactions' => 'লেনদেন',
    'settings' => 'ব্যবসার তথ্য',
    _ => 'তথ্য',
  };
  Future<void> save() async {
    if (saving || !form.currentState!.validate()) return;
    setState(() {
      saving = true;
      failure = null;
    });
    try {
      final p = <String, dynamic>{};
      for (final f in fields) {
        final value = controls[f.keyName]!.text.trim();
        p[f.keyName] = f.kind == 'integer' || f.kind == 'positiveInteger'
            ? bags(value, minimum: f.kind == 'positiveInteger' ? 1 : 0)
            : ['money', 'positive', 'optionalMoney'].contains(f.kind)
            ? (f.kind == 'optionalMoney' && value.isEmpty
                  ? null
                  : number(value))
            : ['product', 'customer'].contains(f.kind)
            ? num.tryParse(value)
            : value;
      }
      if (widget.entity == 'products' && widget.initial != null) {
        p['adjust_date'] = today();
        if (number(p['current_stock']) ==
            number(widget.initial!['current_stock'])) {
          p.remove('current_stock');
        }
        if (p.containsKey('current_stock')) {
          if (!await confirm(
            context,
            title: context.t(
              'Confirm stock change',
              'মজুত পরিবর্তন নিশ্চিত করুন',
            ),
            message:
                '${widget.initial!['name']}\n${context.qty(widget.initial!['current_stock'])} → ${context.qty(p['current_stock'])} ${context.t('bags', 'বস্তা')}',
          )) {
            return;
          }
          p['confirmed_stock'] = true;
        }
      }
      if (!mounted) return;
      if (widget.entity == 'adjustments') {
        if (!await confirm(
          context,
          title: context.t(
            'Confirm stock adjustment',
            'মজুত সমন্বয় নিশ্চিত করুন',
          ),
          message:
              '${selected['product_id']?['name'] ?? context.w.find('products', p['product_id'])?['name'] ?? ''}\n${enumLabel(context, text(p['type']))}: ${context.qty(p['quantity'])} ${context.t('bags', 'বস্তা')}',
        )) {
          return;
        }
        p['confirmed'] = true;
      }
      if (!mounted) return;
      if (widget.entity == 'orders' && widget.initial != null) {
        if (!await confirm(
          context,
          title: context.t(
            'Confirm order changes',
            'অর্ডারের পরিবর্তন নিশ্চিত করুন',
          ),
          message: context.t(
            'Delivered quantities change stock and company payable.',
            'প্রাপ্ত পরিমাণ বদলালে মজুত ও কোম্পানির পাওনা বদলাবে।',
          ),
        )) {
          return;
        }
        p['confirmed'] = true;
      }
      if (widget.entity == 'settings') {
        p['expected_version'] = widget.initial!['version'];
      }
      if (widget.initial != null && widget.entity != 'settings') {
        p['original'] = widget.initial;
        if (originalTransfer != null) p['original_transfer'] = originalTransfer;
      }
      if (widget.entity == 'payments' && widget.initial != null) {
        p['customer_id'] = widget.initial!['customer_id'];
      }
      if (!mounted) return;
      if (widget.entity == 'transactions' &&
          ['Bank Deposit', 'Bank Withdraw'].contains(p['type'])) {
        p['account'] = p['type'] == 'Bank Deposit' ? 'Cash' : 'Bank';
        if (!await confirm(
          context,
          title: context.t('Confirm transfer', 'টাকা স্থানান্তর নিশ্চিত করুন'),
          message:
              '${enumLabel(context, text(p['type']))}\n${context.cash(p['amount'])}',
        )) {
          return;
        }
        p['confirmed'] = true;
      }
      if (!mounted) return;
      await context.w.command(
        widget.entity == 'settings'
            ? 'PUT'
            : widget.initial == null
            ? 'POST'
            : 'PATCH',
        '/api/${widget.entity}${widget.initial == null || widget.entity == 'settings' ? '' : '/${widget.initial!['id']}'}',
        p,
      );
      if (mounted) {
        toast(
          context,
          context.t(
            'Saved on this device. Sync status is shown above.',
            'ডিভাইসে সেভ হয়েছে। উপরে Sync-এর অবস্থা দেখুন।',
          ),
        );
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) setState(() => failure = errorMessage(context, e));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Widget field(FieldSpec f) {
    final c = controls[f.keyName]!, label = context.t(f.en, f.bn);
    if (f.kind == 'date') {
      return DateField(
        controller: c,
        label: label,
        optional: f.keyName == 'delivery_date',
      );
    }
    if ([
      'money',
      'positive',
      'integer',
      'positiveInteger',
      'optionalMoney',
    ].contains(f.kind)) {
      return NumberField(
        controller: c,
        label: label,
        integer: f.kind.contains('Integer') || f.kind == 'integer',
        allowZero: !f.kind.startsWith('positive'),
        required: f.kind != 'optionalMoney',
        minimum: f.keyName == 'current_stock' && widget.initial != null
            ? number(
                widget.initial!['current_stock'],
              ).clamp(-1e12, 0).toDouble()
            : 0,
      );
    }
    if (f.kind == 'choice') {
      return DropdownButtonFormField<String>(
        isExpanded: true,
        initialValue: f.options.contains(c.text) ? c.text : null,
        decoration: InputDecoration(labelText: label),
        items:
            (widget.entity == 'transactions' &&
                        f.keyName == 'type' &&
                        widget.defaults['expense_only'] == true
                    ? f.options.where(
                        (v) => [
                          'Expense',
                          'Transport Cost',
                          'Other Expense',
                        ].contains(v),
                      )
                    : f.options)
                .map(
                  (v) => DropdownMenuItem(
                    value: v,
                    child: Text(enumLabel(context, v)),
                  ),
                )
                .toList(),
        onChanged:
            widget.entity == 'transactions' &&
                f.keyName == 'account' &&
                [
                  'Bank Deposit',
                  'Bank Withdraw',
                ].contains(controls['type']?.text)
            ? null
            : (v) {
                if (v != null) {
                  setState(() {
                    final previous = c.text;
                    c.text = v;
                    if (widget.entity == 'transactions' &&
                        f.keyName == 'type') {
                      if (['Bank Deposit', 'Bank Withdraw'].contains(v)) {
                        controls['account']!.text = v == 'Bank Deposit'
                            ? 'Cash'
                            : 'Bank';
                      } else if ([
                        'Bank Deposit',
                        'Bank Withdraw',
                      ].contains(previous)) {
                        controls['account']!.clear();
                      }
                    }
                  });
                }
              },
        validator: (v) =>
            v == null ? context.t('Choose an option', 'নির্বাচন করুন') : null,
      );
    }
    if (['product', 'customer'].contains(f.kind)) {
      final product = f.kind == 'product',
          record =
              selected[f.keyName] ??
              context.w.find(product ? 'products' : 'customers', c.text) ??
              (product ? context.w.find('archived_products', c.text) : null);
      return FormField<String>(
        initialValue: c.text,
        validator: (_) => c.text.isEmpty
            ? context.t('Choose a record', 'নির্বাচন করুন')
            : null,
        builder: (state) => InkWell(
          onTap: widget.entity == 'payments' && widget.initial != null
              ? null
              : () async {
                  final row = await pickRecord(context, products: product);
                  if (row != null) {
                    setState(() {
                      selected[f.keyName] = row;
                      c.text = text(row['id']);
                    });
                    state.didChange(c.text);
                  }
                },
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: label,
              errorText: state.errorText,
              suffixIcon: const Icon(Icons.expand_more),
            ),
            child: Text(
              record == null
                  ? context.t('Tap to choose', 'নির্বাচন করতে চাপুন')
                  : text(record['name']),
            ),
          ),
        ),
      );
    }
    return TextFormField(
      controller: c,
      maxLines: f.kind == 'multiline' ? 3 : 1,
      keyboardType: f.kind == 'phone' ? TextInputType.phone : null,
      decoration: InputDecoration(labelText: label),
      maxLength: f.keyName == 'name'
          ? (widget.entity == 'settings' ? 120 : 200)
          : f.keyName == 'mobile'
          ? 50
          : null,
      validator: (v) => f.required && (v ?? '').trim().isEmpty
          ? context.t('This field is required', 'এই তথ্যটি দিন')
          : null,
    );
  }

  @override
  Widget build(BuildContext context) => DraftGuard(
    dirty: dirty,
    saving: saving,
    child: Scaffold(
      appBar: AppBar(
        title: Text(
          '${widget.initial == null ? context.t('New', 'নতুন') : context.t('Edit', 'সম্পাদনা')} ${context.t(titleEn, titleBn)}',
        ),
      ),
      body: Form(
        key: form,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.entity == 'products')
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    context.t(
                      'Prices are editable. Existing invoices keep their saved prices.',
                      'দর পরিবর্তন করা যায়। পুরোনো ইনভয়েসের দর অপরিবর্তিত থাকবে।',
                    ),
                  ),
                ),
              for (final f in fields)
                Padding(
                  padding: const EdgeInsets.only(bottom: 18),
                  child: field(f),
                ),
              if (failure != null)
                Text(
                  failure!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              const SizedBox(height: 100),
            ],
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton.icon(
            onPressed: saving ? null : save,
            icon: saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check),
            label: Text(context.t('Save', 'সেভ করুন')),
          ),
        ),
      ),
    ),
  );
}
