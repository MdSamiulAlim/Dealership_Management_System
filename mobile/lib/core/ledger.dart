import 'dart:math' as math;
import 'types.dart';

class Ledger {
  static int percentageDiscountCents(int subtotal, int basisPoints) {
    if (subtotal < 0 || basisPoints < 0 || basisPoints > 10000) {
      throw const AppFailure('Check the discount and paid amount.');
    }
    // Both operands are already normalized integers. Keep the product exact
    // until the final half-up division to avoid binary floating-point ties.
    return ((BigInt.from(subtotal) * BigInt.from(basisPoints) +
                BigInt.from(5000)) ~/
            BigInt.from(10000))
        .toInt();
  }

  static List<int> allocate(int total, List<int> weights) {
    if (total < 0 || weights.any((w) => w < 0)) {
      throw const AppFailure('Allocation amounts cannot be negative.');
    }
    final sum = weights.fold(BigInt.zero, (a, b) => a + BigInt.from(b));
    if (sum == BigInt.zero) {
      if (total != 0) {
        throw const AppFailure(
          'Cannot allocate a payment without an invoice total.',
        );
      }
      return List.filled(weights.length, 0);
    }
    final products = weights
        .map((w) => BigInt.from(total) * BigInt.from(w))
        .toList();
    final parts = products.map((p) => (p ~/ sum).toInt()).toList();
    final order = List.generate(weights.length, (i) => i)
      ..sort((a, b) {
        final cmp = (products[b] % sum).compareTo(products[a] % sum);
        return cmp == 0 ? a.compareTo(b) : cmp;
      });
    final remaining = total - parts.fold(0, (a, b) => a + b);
    if (remaining < 0 || remaining >= weights.length) {
      throw const AppFailure('Invalid allocation remainder.');
    }
    for (var i = 0; i < remaining; i++) {
      parts[order[i]]++;
    }
    return parts;
  }

  static double inputMoney(
    dynamic value, {
    bool signed = false,
    bool positive = false,
  }) {
    if (value != null && value is! num && value is! String) {
      throw const AppFailure('Enter a valid amount or quantity.');
    }
    final raw = value == null || text(value).trim().isEmpty
        ? 0.0
        : double.tryParse(text(value));
    if (raw == null ||
        !raw.isFinite ||
        raw.abs() > 1e12 ||
        (!signed && raw < 0)) {
      throw const AppFailure('Enter a valid amount or quantity.');
    }
    final result = money(raw);
    if (positive && result <= 0) {
      throw const AppFailure('Enter a positive amount.');
    }
    return result;
  }

  static void calculatedTotal(Json payload, double expected) {
    if (payload.containsKey('total_amount') &&
        payload['total_amount'] != '' &&
        inputMoney(payload['total_amount'], signed: true) != expected) {
      throw const AppFailure(
        'Total must match the calculated quantity and rate.',
      );
    }
  }

  static Json amounts(Json payload) {
    final items = rows(payload, 'items');
    if (items.isEmpty || items.length > 40) {
      throw const AppFailure('Add between 1 and 40 invoice items.');
    }
    final gross = <int>[], rates = <double>[];
    var subtotal = 0;
    for (final item in items) {
      if (item['rate'] == null || text(item['rate']).trim().isEmpty) {
        throw const AppFailure(
          'Enter a quantity and rate for every invoice item.',
        );
      }
      final quantity = bags(item['quantity'], minimum: 1),
          rate = inputMoney(item['rate']);
      final line = cents(inputMoney(quantity * rate));
      if (subtotal > 100000000000000 - line) {
        throw const AppFailure(
          'Invoice subtotal cannot exceed 1,000,000,000,000.',
        );
      }
      subtotal += line;
      gross.add(line);
      rates.add(rate);
    }
    final type = text(payload['discount_type']).trim();
    if (!['', 'amount', 'percent'].contains(type)) {
      throw const AppFailure('Choose amount or percent.');
    }
    final value = inputMoney(
      payload['discount_value'] ?? payload['discount'] ?? 0,
    );
    if (type == 'percent' && value > 100) {
      throw const AppFailure('Check the discount and paid amount.');
    }
    final discount = type == 'percent'
        ? percentageDiscountCents(subtotal, cents(value))
        : cents(value);
    final total = subtotal - discount,
        paid = cents(inputMoney(payload['paid_amount'] ?? 0));
    if (discount > subtotal || paid > total) {
      throw const AppFailure('Check the discount and paid amount.');
    }
    calculatedTotal(payload, total / 100);
    final net = allocate(total, gross), payments = allocate(paid, net);
    return {
      'subtotal': subtotal / 100,
      'discount': discount / 100,
      'total_amount': total / 100,
      'paid_amount': paid / 100,
      'items': List.generate(
        items.length,
        (i) => {
          ...items[i],
          'quantity': bags(items[i]['quantity'], minimum: 1),
          'rate': rates[i],
          'line_total': net[i] / 100,
          'paid_amount': payments[i] / 100,
        },
      ),
    };
  }

  static List<Json> allProducts(Json base) => [
    ...rows(base, 'products'),
    ...rows(base, 'archived_products'),
  ];
  static Json? find(List<Json> list, dynamic id) {
    for (final row in list) {
      if (same(row['id'], id)) return row;
    }
    return null;
  }

  static double sum(Iterable<Json> list, double Function(Json) amount) =>
      money(list.fold<double>(0, (total, row) => total + amount(row)));
  static double stock(Json base, Json product) => money(
    number(product['opening_stock']) +
        sum(
          rows(base, 'orders').where(
            (r) =>
                same(r['product_id'], product['id']) &&
                r['status'] == 'Delivered',
          ),
          (r) => number(r['quantity']),
        ) -
        sum(
          rows(
            base,
            'sales',
          ).where((r) => same(r['product_id'], product['id'])),
          (r) => number(r['quantity']),
        ) +
        sum(
          rows(
            base,
            'adjustments',
          ).where((r) => same(r['product_id'], product['id'])),
          (r) =>
              (['Return', 'Manual Add'].contains(r['type']) ? 1 : -1) *
              number(r['quantity']),
        ),
  );
  static void validate(Json base, Json command) {
    final p = object(command['payload']),
        parts = text(command['path']).split('/');
    final entity = parts[2],
        id = parts.length > 3 ? parts[3] : null,
        method = command['method'];
    if (method != 'DELETE') {
      final requiredDate = {
        'orders': 'order_date',
        'payments': 'payment_date',
        'transactions': 'txn_date',
        'adjustments': 'adjust_date',
        'invoices': text(command['path']).endsWith('/return')
            ? 'return_date'
            : 'sale_date',
      }[entity];
      if (requiredDate != null && text(p[requiredDate]).trim().isEmpty) {
        throw const AppFailure('Choose a valid date.');
      }
      void option(dynamic value, List<String> allowed, {String fallback = ''}) {
        final choice = text(value).trim().isEmpty
            ? fallback
            : text(value).trim();
        if (!allowed.contains(choice)) {
          throw AppFailure('Choose ${allowed.join(' or ')}.');
        }
      }

      if (entity == 'customers') {
        if (method == 'POST') {
          inputMoney(p['opening_due'], signed: true);
        } else if (p.containsKey('opening_due') ||
            p.containsKey('current_due')) {
          throw const AppFailure(
            'Use customer payments to change account balances.',
          );
        }
      }
      if (entity == 'orders') {
        option(p['status'], [
          'Pending',
          'Confirmed',
          'Delivered',
        ], fallback: 'Pending');
        bags(p['quantity'], minimum: 1);
        final rate = inputMoney(p['rate']);
        inputMoney(p['bag_weight'] ?? 50, positive: true);
        calculatedTotal(p, inputMoney(number(p['quantity']) * rate));
        final product = find(allProducts(base), p['product_id']);
        final old = method == 'PATCH' ? find(rows(base, entity), id) : null;
        if (product == null ||
            (flag(product['archived']) &&
                !same(old?['product_id'], p['product_id']))) {
          throw const AppFailure('Choose a current product.');
        }
      }
      if (entity == 'adjustments') {
        option(p['type'], [
          'Return',
          'Damage',
          'Loss',
          'Manual Add',
          'Manual Minus',
        ]);
        if (p['confirmed'] != true) {
          throw const AppFailure('Confirm the stock adjustment first.');
        }
      }
      if (entity == 'transactions') {
        option(p['type'], [
          'Company Payment',
          'Expense',
          'Transport Cost',
          'Other Income',
          'Other Expense',
          'Bank Deposit',
          'Bank Withdraw',
        ]);
      }
      if (['payments', 'transactions'].contains(entity)) {
        inputMoney(p['amount'], positive: true);
      }
      if (entity == 'products' && p.containsKey('category')) {
        option(p['category'], ['Fish feed', 'Cattle feed', 'Poultry feed']);
      }

      for (final key in [
        'sale_date',
        'payment_date',
        'txn_date',
        'order_date',
        'adjust_date',
        'return_date',
        'delivery_date',
      ]) {
        if (!p.containsKey(key) ||
            p[key] == null ||
            (key == 'delivery_date' && text(p[key]).isEmpty)) {
          continue;
        }
        final value = text(p[key]), parsed = DateTime.tryParse(value);
        if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) ||
            parsed == null ||
            parsed.toIso8601String().substring(0, 10) != value ||
            parsed.year < 2000 ||
            parsed.year > 2100) {
          throw const AppFailure('Choose a valid date.');
        }
      }
      void nonnegative(String key, {bool positive = false}) {
        final value = double.tryParse(text(p[key]));
        if (value == null ||
            !value.isFinite ||
            value < 0 ||
            (positive && value == 0) ||
            value > 1e12) {
          throw AppFailure('Enter a valid $key.');
        }
      }

      if (entity == 'settings' &&
          (text(p['name']).trim().isEmpty ||
              text(p['name']).length > 120 ||
              text(p['phone']).length > 50 ||
              text(p['address']).length > 500 ||
              number(p['large_discount_percent']) < 0 ||
              number(p['large_discount_percent']) > 100)) {
        throw const AppFailure('Check the business settings.');
      }
      if (entity == 'products') {
        if (text(p['name']).trim().isEmpty || text(p['name']).length > 200) {
          throw const AppFailure('Enter a product name within 200 characters.');
        }
        for (final key in ['default_rate', 'bag_weight']) {
          if (p.containsKey(key)) {
            nonnegative(key, positive: key == 'bag_weight');
          }
        }
        for (final key in [
          'opening_stock',
          'current_stock',
          'low_stock_level',
        ]) {
          if (p.containsKey(key)) bags(p[key]);
        }
        if (p['protein_percent'] != null &&
            text(p['protein_percent']).isNotEmpty) {
          nonnegative('protein_percent');
          if (number(p['protein_percent']) > 100) {
            throw const AppFailure(
              'Protein must be between 0 and 100 percent.',
            );
          }
        }
        if (text(p['product_code']).length > 100 ||
            text(p['feed_size']).length > 100) {
          throw const AppFailure(
            'Code and feed size must be within 100 characters.',
          );
        }
      }
      if (entity == 'customers' &&
          (text(p['name']).trim().isEmpty || text(p['name']).length > 200)) {
        throw const AppFailure('Enter a customer name within 200 characters.');
      }
      for (final prefix in ['', 'customer_']) {
        if (text(p['${prefix}mobile']).length > 50 ||
            text(p['${prefix}address']).length > 1000) {
          throw const AppFailure('Mobile or address is too long.');
        }
      }
      if (['payments', 'transactions', 'adjustments'].contains(entity) &&
          text(p['notes']).length > 1000) {
        throw const AppFailure('Keep the note within 1000 characters.');
      }
      if (entity == 'orders') {
        nonnegative('rate');
        if (p.containsKey('bag_weight')) {
          nonnegative('bag_weight', positive: true);
        }
      }
      if (entity == 'payments' &&
          find(rows(base, 'customers'), p['customer_id']) == null) {
        throw const AppFailure('Customer not found.');
      }
      if (entity == 'invoices' && !text(command['path']).endsWith('/return')) {
        if (p['customer_id'] == 'new') {
          if (text(p['customer_name']).trim().isEmpty ||
              text(p['customer_name']).length > 200) {
            throw const AppFailure(
              'Enter a customer name within 200 characters.',
            );
          }
        } else if (find(rows(base, 'customers'), p['customer_id']) == null) {
          throw const AppFailure('Customer not found.');
        }
      }
    }
    void failStock() => throw const AppFailure(
      'Insufficient stock. Refresh stock and reduce the quantity before saving.',
    );
    if (entity == 'invoices' &&
        !text(command['path']).endsWith('/return') &&
        method != 'DELETE') {
      final a = amounts(p),
          old = method == 'PATCH' ? find(rows(base, 'invoices'), id) : null;
      if (old != null &&
          (old['status'] == 'void' ||
              rows(
                old,
                'items',
              ).any((r) => number(r['returned_quantity']) > 0))) {
        throw const AppFailure(
          'Returned or cancelled invoices cannot be edited.',
        );
      }
      final demanded = <String, double>{};
      for (final item in rows(a, 'items')) {
        demanded.update(
          text(item['product_id']),
          (v) => v + number(item['quantity']),
          ifAbsent: () => number(item['quantity']),
        );
      }
      for (final entry in demanded.entries) {
        final product = find(allProducts(base), entry.key);
        if (product == null) throw const AppFailure('Product not found.');
        final released = old == null
            ? 0
            : sum(
                rows(
                  old,
                  'items',
                ).where((r) => same(r['product_id'], entry.key)),
                (r) => number(r['quantity']),
              );
        if (flag(product['archived']) && entry.value > released) {
          throw const AppFailure(
            'This product is archived. Choose a current product.',
          );
        }
        if (entry.value > money(stock(base, product) + released)) failStock();
      }
      final invoiceNumber = text(p['invoice_no']).trim();
      if (invoiceNumber.length > 100 ||
          RegExp(r'[\x00-\x1f\x7f]').hasMatch(invoiceNumber)) {
        throw const AppFailure(
          'Keep the invoice number within 100 characters on one line.',
        );
      }
      if (invoiceNumber.isNotEmpty &&
          rows(base, 'invoices').any(
            (r) =>
                r['invoice_no'] == invoiceNumber &&
                !same(r['id'], p['id'] ?? id),
          )) {
        throw const AppFailure(
          'This invoice number is already in use. Choose another number.',
        );
      }
    }
    if (method == 'DELETE' && ['products', 'customers'].contains(entity)) {
      final key = entity == 'products' ? 'product_id' : 'customer_id';
      final used =
          rows(base, 'sales').any((r) => same(r[key], id)) ||
          (entity == 'customers'
              ? rows(base, 'payments').any((r) => same(r[key], id))
              : [
                  ...rows(base, 'orders'),
                  ...rows(base, 'adjustments'),
                ].any((r) => same(r[key], id))) ||
          rows(base, 'invoices').any(
            (r) => entity == 'customers'
                ? same(r[key], id)
                : rows(r, 'items').any((i) => same(i[key], id)),
          );
      if (used) {
        throw const AppFailure(
          'This record has transactions and cannot be deleted. Keep it for the account history.',
        );
      }
    }
    if (method == 'PATCH' && ['orders', 'adjustments'].contains(entity)) {
      final old = find(rows(base, entity), id);
      if (old == null) throw const AppFailure('Record not found.');
      if (p['confirmed'] != true) {
        throw const AppFailure('Confirm the stock change first.');
      }
      final next = {...old, ...p};
      bags(next['quantity'], minimum: 1);
      double effect(Json r) => entity == 'orders'
          ? (r['status'] == 'Delivered' ? number(r['quantity']) : 0)
          : (['Return', 'Manual Add'].contains(r['type']) ? 1 : -1) *
                number(r['quantity']);
      final product = find(allProducts(base), next['product_id']);
      if (product == null ||
          (flag(product['archived']) &&
              !same(old['product_id'], next['product_id']))) {
        throw const AppFailure('Choose a current product.');
      }
      for (final feed in allProducts(base).where(
        (r) =>
            same(r['id'], old['product_id']) ||
            same(r['id'], next['product_id']),
      )) {
        final delta =
            (same(feed['id'], next['product_id']) ? effect(next) : 0) -
            (same(feed['id'], old['product_id']) ? effect(old) : 0);
        if (delta < 0 && stock(base, feed) + delta < 0) failStock();
      }
      if (entity == 'adjustments' && text(p['notes']).trim().isEmpty) {
        throw const AppFailure('Enter a stock adjustment reason.');
      }
    }
    if (entity == 'transactions' && method == 'PATCH') {
      final old = find(rows(base, entity), id);
      if (old == null) throw const AppFailure('Record not found.');
      final transfer = ['Bank Deposit', 'Bank Withdraw'].contains(p['type']);
      if (old['transfer_id'] != null) {
        final pair = rows(base, entity)
            .where(
              (r) =>
                  r['transfer_id'] == old['transfer_id'] && !same(r['id'], id),
            )
            .toList();
        if (!transfer || p['confirmed'] != true) {
          throw const AppFailure(
            'Confirm the transfer edit. Keep it as Cash to Bank or Bank to Cash.',
          );
        }
        if (pair.length != 1 ||
            p['original_transfer'] is! Map ||
            pair.single['account'] == old['account']) {
          throw const AppFailure(
            'Reload the complete transfer before editing.',
          );
        }
        final expected = object(p['original_transfer']);
        if (pair.single.entries.any(
          (e) =>
              ![
                'pending',
                'original',
                'original_transfer',
                'confirmed',
              ].contains(e.key) &&
              expected[e.key] != e.value,
        )) {
          throw const AppFailure(
            'Transfer changed on another device. Refresh first.',
          );
        }
      } else if (transfer) {
        throw const AppFailure(
          'Create a new transfer instead of changing a single transaction into a transfer.',
        );
      }
    }
    if (entity == 'adjustments' && method == 'POST') {
      final quantity = bags(p['quantity'], minimum: 1),
          product = find(allProducts(base), p['product_id']);
      if (product == null || flag(product['archived'])) {
        throw const AppFailure('Choose a current product.');
      }
      if (!['Return', 'Manual Add'].contains(p['type']) &&
          quantity > stock(base, product)) {
        failStock();
      }
    }
    if (method == 'DELETE' && ['orders', 'adjustments'].contains(entity)) {
      final row = find(rows(base, entity), id);
      if (row != null &&
          (entity == 'orders'
              ? row['status'] == 'Delivered'
              : ['Return', 'Manual Add'].contains(row['type']))) {
        final product = find(allProducts(base), row['product_id']);
        if (product != null && number(row['quantity']) > stock(base, product)) {
          failStock();
        }
      }
    }
    if (['orders', 'adjustments'].contains(entity) && method == 'POST') {
      bags(p['quantity'], minimum: 1);
    }
    if (['payments', 'transactions'].contains(entity) &&
        method != 'DELETE' &&
        (!number(p['amount']).isFinite || number(p['amount']) <= 0)) {
      throw const AppFailure('Enter a positive amount.');
    }
    if (p.containsKey('account') && !['Cash', 'Bank'].contains(p['account'])) {
      throw const AppFailure('Choose Cash or Bank.');
    }
  }

  static dynamic resolve(dynamic value, Json ids) {
    if (value is List) return value.map((v) => resolve(v, ids)).toList();
    if (value is Map) {
      return value.map(
        (k, v) => MapEntry(
          k,
          ['customer_id', 'product_id'].contains(k) && ids.containsKey(idKey(v))
              ? ids[idKey(v)]
              : resolve(v, ids),
        ),
      );
    }
    return value;
  }

  static void apply(Json base, Json command) {
    final path = text(command['path']).split('/'),
        entity = path[2],
        id = path.length > 3 ? path[3] : null;
    final p = clone(object(command['payload'])), method = command['method'];
    if (entity == 'invoices') {
      final invoices = rows(base, 'invoices'), old = find(invoices, id);
      if ((method == 'POST' && path.length == 3) || method == 'PATCH') {
        final a = amounts(p);
        if (p['customer_id'] == 'new') {
          p['customer_id'] = command['temp_id'];
          (base['customers'] as List).add({
            'id': command['temp_id'],
            'name': p['customer_name'],
            'mobile': p['customer_mobile'] ?? '',
            'address': p['customer_address'] ?? '',
            'opening_due': 0,
            'pending': true,
          });
        }
        final invoiceId = p['id'] ?? id;
        final invoice = <String, dynamic>{
          ...p,
          ...a,
          'id': invoiceId,
          'invoice_no': text(p['invoice_no']).trim().isNotEmpty
              ? text(p['invoice_no']).trim()
              : old?['invoice_no'] ??
                    'AT-${text(p['sale_date']).replaceAll('-', '')}-${text(invoiceId).replaceAll('-', '').substring(math.max(0, text(invoiceId).replaceAll('-', '').length - 12)).toUpperCase()}',
          'version': number(old?['version']).toInt() + 1,
          'status': 'active',
          'returned_total': 0,
          'refunded': 0,
          'pending': true,
        };
        invoice['items'] = List.generate(rows(a, 'items').length, (n) {
          final item = rows(a, 'items')[n],
              product = find(allProducts(base), item['product_id']);
          return {
            ...item,
            'id': '$invoiceId-line-$n',
            'invoice_id': invoiceId,
            'sale_id': 'local-$invoiceId-$n',
            'product_name': product?['name'] ?? '',
            'product_code': product?['product_code'] ?? '',
            'returned_quantity': 0,
          };
        });
        final oldSales = old == null
            ? <String>{}
            : rows(old, 'items').map((i) => text(i['sale_id'])).toSet();
        (base['sales'] as List).removeWhere(
          (r) => oldSales.contains(text(r['id'])),
        );
        for (final item in rows(invoice, 'items')) {
          (base['sales'] as List).add({
            ...item,
            'id': item['sale_id'],
            'sale_date': p['sale_date'],
            'customer_id': p['customer_id'],
            'total_amount': item['line_total'],
            'account': p['account'],
          });
        }
        (base['invoices'] as List).removeWhere((r) => same(r['id'], invoiceId));
        (base['invoices'] as List).insert(0, invoice);
      } else if (old != null && method == 'DELETE') {
        old['status'] = 'void';
        old['pending'] = true;
        old['version'] = number(old['version']).toInt() + 1;
        final saleIds = rows(
          old,
          'items',
        ).map((r) => text(r['sale_id'])).toSet();
        for (final sale in base['sales']) {
          if (saleIds.contains(text(sale['id']))) {
            sale.addAll({'quantity': 0, 'total_amount': 0, 'paid_amount': 0});
          }
        }
        base['invoices'] = invoices;
      } else if (old != null && path.last == 'return') {
        if (old['status'] == 'void') {
          throw const AppFailure('Invoice is cancelled.');
        }
        final requested = {
          for (final row in rows(p, 'items'))
            text(row['id']): bags(row['quantity']),
        };
        final items = rows(old, 'items');
        if (requested.isEmpty ||
            requested.keys.any((id) => !items.any((i) => same(i['id'], id)))) {
          throw const AppFailure('Choose valid return items.');
        }
        for (final item in items) {
          final quantity = requested[text(item['id'])] ?? 0;
          if (quantity >
              number(item['quantity']) - number(item['returned_quantity'])) {
            throw const AppFailure(
              'Return quantity exceeds the remaining quantity.',
            );
          }
          item['returned_quantity'] =
              number(item['returned_quantity']) + quantity;
          if (quantity > 0 && p['restock'] == false) {
            (base['adjustments'] as List).add({
              'id': '${command['id']}-${item['id']}',
              'product_id': item['product_id'],
              'type': 'Damage',
              'quantity': quantity,
              'adjust_date': p['return_date'],
              'pending': true,
            });
          }
        }
        final net = items
            .map(
              (i) =>
                  (cents(i['line_total']) *
                              (number(i['quantity']) -
                                  number(i['returned_quantity'])) /
                              number(i['quantity']) +
                          .5)
                      .floor(),
            )
            .toList();
        final total = net.fold(0, (a, b) => a + b) / 100,
            refunded = money(math.max(0, number(old['paid_amount']) - total));
        (base['returns'] as List).add({
          'id': command['id'],
          'invoice_id': old['id'],
          'return_date': p['return_date'],
          'credit': money(
            number(old['total_amount']) - number(old['returned_total']) - total,
          ),
          'refund': money(refunded - number(old['refunded'])),
          'reason': p['reason'],
          'items_json': p['items'],
          'pending': true,
        });
        old.addAll({
          'items': items,
          'returned_total': money(number(old['total_amount']) - total),
          'refunded': refunded,
          'version': number(old['version']).toInt() + 1,
          'pending': true,
        });
        final paid = allocate(
          cents(number(old['paid_amount']) - refunded),
          net,
        );
        for (var n = 0; n < items.length; n++) {
          final sale = find(rows(base, 'sales'), items[n]['sale_id']);
          if (sale != null) {
            // Replace the original maps too; rows() intentionally returns copies.
            final list = base['sales'] as List,
                index = list.indexWhere((r) => same(r['id'], sale['id']));
            list[index] = {
              ...sale,
              'quantity':
                  number(items[n]['quantity']) -
                  number(items[n]['returned_quantity']),
              'total_amount': net[n] / 100,
              'paid_amount': paid[n] / 100,
            };
          }
        }
        base['invoices'] = invoices;
      }
      return;
    }
    if (entity == 'settings') {
      base['settings'] = {
        ...p,
        'version': number(base['settings']['version']).toInt() + 1,
      };
      return;
    }
    if (!base.containsKey(entity)) {
      throw const AppFailure('Unsupported offline action.');
    }
    final list = base[entity] as List;
    if (method == 'POST') {
      final row = <String, dynamic>{
        ...p,
        'id': command['temp_id'],
        'created_at': DateTime.fromMillisecondsSinceEpoch(
          number(command['created_at']).toInt(),
          isUtc: true,
        ).toIso8601String(),
        'pending': true,
      };
      for (final field in [
        'product_id',
        'customer_id',
        'quantity',
        'rate',
        'paid_amount',
        'amount',
        'opening_stock',
        'opening_due',
        'default_rate',
        'bag_weight',
        'low_stock_level',
      ]) {
        if (row.containsKey(field)) {
          row[field] = ['product_id', 'customer_id'].contains(field)
              ? number(row[field]).toInt()
              : money(row[field]);
        }
      }
      if (entity == 'orders') {
        row['total_amount'] = money(
          number(row['quantity']) * number(row['rate']),
        );
      }
      if (entity == 'products') {
        row.addAll({
          'opening_stock': number(p['opening_stock']),
          'default_rate': number(p['default_rate']),
          'low_stock_level': p['low_stock_level'] ?? 5,
          'bag_weight': p['bag_weight'] ?? 50,
        });
      }
      if (entity == 'transactions' &&
          ['Bank Deposit', 'Bank Withdraw'].contains(p['type'])) {
        row['transfer_id'] = command['id'];
        row['account'] = p['type'] == 'Bank Deposit' ? 'Cash' : 'Bank';
        list.add({
          ...row,
          'id': '${command['temp_id']}-counter',
          'account': row['account'] == 'Cash' ? 'Bank' : 'Cash',
        });
      }
      list.insert(0, row);
    } else if (method == 'DELETE') {
      final deleted = find(rows(base, entity), id);
      list.removeWhere(
        (r) =>
            same(r['id'], id) ||
            (entity == 'transactions' &&
                deleted?['transfer_id'] != null &&
                r['transfer_id'] == deleted?['transfer_id']),
      );
    } else if (method == 'PATCH') {
      final index = list.indexWhere((r) => same(r['id'], id));
      if (index < 0) throw const AppFailure('Record not found.');
      final row = object(list[index]);
      if (entity == 'products' && p.containsKey('current_stock')) {
        final expected = number(p['original']?['current_stock']),
            actual = stock(base, row);
        if (actual != expected) {
          throw const AppFailure('Stock changed. Refresh before editing.');
        }
        final delta = money(number(p['current_stock']) - actual);
        if (delta != 0) {
          (base['adjustments'] as List).add({
            'id': '${command['id']}-stock',
            'product_id': row['id'],
            'adjust_date': p['adjust_date'] ?? today(),
            'type': delta > 0 ? 'Manual Add' : 'Manual Minus',
            'quantity': delta.abs(),
            'pending': true,
          });
        }
      }
      if (entity == 'customers') {
        for (final invoice in base['invoices']) {
          if (same(invoice['customer_id'], id) &&
              text(invoice['customer_name']).isEmpty) {
            invoice.addAll({
              'customer_name': row['name'],
              'customer_mobile': row['mobile'] ?? '',
              'customer_address': row['address'] ?? '',
            });
          }
        }
      }
      if (entity == 'orders') {
        p['total_amount'] = money(number(p['quantity']) * number(p['rate']));
      }
      if (entity == 'transactions' && row['transfer_id'] != null) {
        for (var i = 0; i < list.length; i++) {
          final side = object(list[i]);
          if (side['transfer_id'] != row['transfer_id']) continue;
          list[i] = {
            ...side,
            ...p,
            'id': side['id'],
            'account': side['account'],
            'transfer_id': side['transfer_id'],
            'pending': true,
          };
        }
      } else {
        list[index] = {...row, ...p, 'pending': true};
      }
    }
  }

  static void _orderInvoiceItems(Json base) {
    for (final invoice in base['invoices'] as List? ?? []) {
      final items = rows(object(invoice), 'items');
      if (items.every((i) => num.tryParse(text(i['sale_id'])) != null)) {
        items.sort(
          (a, b) => number(a['sale_id']).compareTo(number(b['sale_id'])),
        );
        invoice['items'] = items;
      }
    }
  }

  static Json project(Json state, {DateTime? now, bool strict = false}) {
    final base = clone(object(state['base']));
    for (final name in collections) {
      base[name] ??= <dynamic>[];
    }
    _orderInvoiceItems(base);
    final ids = object(state['ids'] ?? {});
    for (final operation in rows(state, 'queue')) {
      if (operation['rejected'] == true) continue;
      if (number(operation['workspace_epoch']) !=
          number(base['workspace_epoch'])) {
        continue;
      }
      final op = clone(operation);
      op['payload'] = resolve(op['payload'], ids);
      op['path'] = text(op['path']).replaceAllMapped(
        RegExp(r'/(-\d+)(?=/|$)'),
        (m) => '/${ids[m[1]] ?? m[1]}',
      );
      try {
        validate(base, op);
        apply(base, op);
      } catch (e) {
        if (strict) rethrow;
        (base['projection_errors'] ??= <dynamic>[]).add({
          'id': operation['id'],
          'message': e.toString(),
        });
      }
    }
    return recalculate(base, now: now);
  }

  static Json recalculate(Json base, {DateTime? now}) {
    _orderInvoiceItems(base);
    final date = today(now),
        products = allProducts(base),
        orders = rows(base, 'orders'),
        sales = rows(base, 'sales'),
        payments = rows(base, 'payments'),
        transactions = rows(base, 'transactions');
    for (final product in products) {
      product['current_stock'] = stock(base, product);
      product['received_stock'] = sum(
        orders.where(
          (r) =>
              same(r['product_id'], product['id']) &&
              r['status'] == 'Delivered',
        ),
        (r) => number(r['quantity']),
      );
      product['sold_stock'] = sum(
        sales.where((r) => same(r['product_id'], product['id'])),
        (r) => number(r['quantity']),
      );
    }
    base['products'] = products.where((p) => !flag(p['archived'])).toList();
    base['archived_products'] = products
        .where((p) => flag(p['archived']))
        .toList();
    final customers = rows(base, 'customers');
    for (final customer in customers) {
      customer['total_purchase'] = money(
        number(customer['opening_due']) +
            sum(
              sales.where((r) => same(r['customer_id'], customer['id'])),
              (r) => number(r['total_amount']),
            ),
      );
      customer['total_paid'] = money(
        sum(
              sales.where((r) => same(r['customer_id'], customer['id'])),
              (r) => number(r['paid_amount']),
            ) +
            sum(
              payments.where((r) => same(r['customer_id'], customer['id'])),
              (r) => number(r['amount']),
            ),
      );
      customer['current_due'] = money(
        number(customer['total_purchase']) - number(customer['total_paid']),
      );
    }
    base['customers'] = customers;
    for (final sale in sales) {
      sale['customer_name'] =
          find(customers, sale['customer_id'])?['name'] ??
          sale['customer_name'] ??
          '';
      sale['product_name'] =
          find(products, sale['product_id'])?['name'] ??
          sale['product_name'] ??
          '';
      sale['due_amount'] = money(
        number(sale['total_amount']) - number(sale['paid_amount']),
      );
    }
    base['sales'] = sales;
    final invoices = rows(base, 'invoices');
    for (final invoice in invoices) {
      final customer = find(customers, invoice['customer_id']);
      if (text(invoice['customer_name']).isEmpty) {
        invoice.addAll({
          'customer_name': customer?['name'] ?? '',
          'customer_mobile': customer?['mobile'] ?? '',
          'customer_address': customer?['address'] ?? '',
        });
      }
      invoice['net_total'] = invoice['status'] == 'void'
          ? 0
          : money(
              number(invoice['total_amount']) -
                  number(invoice['returned_total']),
            );
      invoice['net_paid'] = invoice['status'] == 'void'
          ? 0
          : money(number(invoice['paid_amount']) - number(invoice['refunded']));
      invoice['due_amount'] = money(
        number(invoice['net_total']) - number(invoice['net_paid']),
      );
    }
    base['invoices'] = invoices;
    for (final order in orders) {
      order['product_name'] =
          find(products, order['product_id'])?['name'] ?? '';
    }
    for (final payment in payments) {
      payment['customer_name'] =
          find(customers, payment['customer_id'])?['name'] ?? '';
    }
    base['orders'] = orders;
    base['payments'] = payments;
    double balance(String account) => money(
      sum(
            sales.where((r) => r['account'] == account),
            (r) => number(r['paid_amount']),
          ) +
          sum(
            payments.where((r) => r['account'] == account),
            (r) => number(r['amount']),
          ) +
          sum(
            transactions.where((r) => r['account'] == account),
            (r) =>
                ((account == 'Cash'
                            ? ['Other Income', 'Bank Withdraw']
                            : ['Other Income', 'Bank Deposit'])
                        .contains(r['type'])
                    ? 1
                    : -1) *
                number(r['amount']),
          ),
    );
    final reports = journal(base, date);
    base['reports'] = reports;
    final current = rows(
      reports,
      'daily_sales',
    ).where((r) => r['date'] == date).toList();
    base['dashboard'] = {
      'today': date,
      'total_sales_today': current.isEmpty ? 0 : current.first['net_sales'],
      'received_today': money(
        (current.isEmpty ? 0 : number(current.first['net_received'])) +
            sum(
              payments.where((r) => r['payment_date'] == date),
              (r) => number(r['amount']),
            ),
      ),
      'today_orders': orders.where((r) => r['order_date'] == date).length,
      'current_stock': sum(
        rows(base, 'products'),
        (r) => number(r['current_stock']),
      ),
      'archived_stock': sum(
        rows(base, 'archived_products'),
        (r) => number(r['current_stock']),
      ),
      'low_stock': rows(base, 'products')
          .where(
            (r) => number(r['current_stock']) <= number(r['low_stock_level']),
          )
          .toList(),
      'customer_due': sum(customers, (r) => number(r['current_due'])),
      'company_payable': money(
        sum(
              orders.where((r) => r['status'] == 'Delivered'),
              (r) => number(r['total_amount']),
            ) -
            sum(
              transactions.where((r) => r['type'] == 'Company Payment'),
              (r) => number(r['amount']),
            ),
      ),
      'cash_balance': balance('Cash'),
      'bank_balance': balance('Bank'),
    };
    return base;
  }

  static Json journal(Json base, String day) {
    final invoices = rows(base, 'invoices'),
        byInvoice = {for (final i in invoices) text(i['id']): i};
    final original = <String, Json>{}, voidLines = <String>{};
    for (final invoice in invoices) {
      final items = rows(invoice, 'items');
      if (invoice['status'] == 'void') {
        voidLines.addAll(items.map((i) => text(i['sale_id'])));
        continue;
      }
      final paid = allocate(
        cents(invoice['paid_amount']),
        items.map((i) => cents(i['line_total'])).toList(),
      );
      for (var n = 0; n < items.length; n++) {
        original[text(items[n]['sale_id'])] = {
          ...items[n],
          'sale_date': invoice['sale_date'],
          'customer_id': invoice['customer_id'],
          'account': invoice['account'],
          'total_amount': items[n]['line_total'],
          'paid_amount': paid[n] / 100,
        };
      }
    }
    final daily = <String, Json>{};
    Json dateRow(String date) => daily.putIfAbsent(
      date,
      () => {
        'date': date,
        'invoice_count': 0,
        'bags': 0.0,
        'sales': 0.0,
        'received': 0.0,
        'return_credit': 0.0,
        'refunds': 0.0,
      },
    );
    for (final sale in rows(base, 'sales')) {
      if (voidLines.contains(text(sale['id']))) continue;
      final row = original[text(sale['id'])] ?? sale,
          target = dateRow(text(row['sale_date']));
      target['bags'] = number(target['bags']) + number(row['quantity']);
      target['sales'] = number(target['sales']) + number(row['total_amount']);
      target['received'] =
          number(target['received']) + number(row['paid_amount']);
      if (invoices.isEmpty) {
        target['invoice_count'] = number(target['invoice_count']).toInt() + 1;
      }
    }
    for (final invoice in invoices.where((i) => i['status'] != 'void')) {
      final row = dateRow(text(invoice['sale_date']));
      row['invoice_count'] = number(row['invoice_count']).toInt() + 1;
    }
    final returns = <Json>[];
    for (final event in rows(base, 'returns')) {
      final invoice = byInvoice[text(event['invoice_id'])];
      if (invoice == null || invoice['status'] == 'void') continue;
      final row = dateRow(text(event['return_date']));
      row['return_credit'] =
          number(row['return_credit']) + number(event['credit']);
      row['refunds'] = number(row['refunds']) + number(event['refund']);
      returns.add({
        'date': event['return_date'],
        'invoice_no': invoice['invoice_no'],
        'customer_id': invoice['customer_id'],
        'name': invoice['customer_name'],
        'account': invoice['account'],
        'return_credit': event['credit'],
        'refunds': event['refund'],
        'reason': event['reason'],
      });
    }
    final monthly = <String, Json>{};
    for (final row in daily.values) {
      for (final field in [
        'bags',
        'sales',
        'received',
        'return_credit',
        'refunds',
      ]) {
        row[field] = money(row[field]);
      }
      row['due'] = money(number(row['sales']) - number(row['received']));
      row['net_sales'] = money(
        number(row['sales']) - number(row['return_credit']),
      );
      row['net_received'] = money(
        number(row['received']) - number(row['refunds']),
      );
      final key = text(row['date']).substring(0, 7),
          month = monthly.putIfAbsent(key, () => {'month': key});
      for (final field in [
        'bags',
        'sales',
        'received',
        'return_credit',
        'refunds',
        'net_sales',
        'net_received',
      ]) {
        month[field] = money(number(month[field]) + number(row[field]));
      }
    }
    final customerTotals = <String, Json>{}, productTotals = <String, Json>{};
    for (final sale in rows(base, 'sales')) {
      final id = text(sale['customer_id']),
          customer = customerTotals.putIfAbsent(
            id,
            () => {
              'customer_id': sale['customer_id'],
              'name':
                  find(rows(base, 'customers'), id)?['name'] ??
                  sale['customer_name'],
              'purchase': 0,
              'paid': 0,
            },
          );
      customer['purchase'] = money(
        number(customer['purchase']) + number(sale['total_amount']),
      );
      customer['paid'] = money(
        number(customer['paid']) + number(sale['paid_amount']),
      );
      customer['sale_due'] = money(
        number(customer['purchase']) - number(customer['paid']),
      );
      final product = productTotals.putIfAbsent(
        text(sale['product_id']),
        () => {
          'product_id': sale['product_id'],
          'name': sale['product_name'],
          'bags': 0,
          'amount': 0,
        },
      );
      product['bags'] = money(
        number(product['bags']) + number(sale['quantity']),
      );
      product['amount'] = money(
        number(product['amount']) + number(sale['total_amount']),
      );
    }
    final dates = daily.values.toList()
      ..sort((a, b) => text(b['date']).compareTo(text(a['date'])));
    final months = monthly.values.toList()
      ..sort((a, b) => text(b['month']).compareTo(text(a['month'])));
    return {
      'daily_sales': dates,
      'monthly_sales': months,
      'return_journal': returns,
      'customer_sales': customerTotals.values.toList(),
      'product_sales': productTotals.values.toList(),
      'stock_report': base['products'],
      'due_report': base['customers'],
    };
  }

  static Json due(Json base, Json customer) {
    final bills = rows(
          base,
          'invoices',
        ).where((i) => same(i['customer_id'], customer['id'])).toList(),
        active = bills.where((i) => i['status'] != 'void').toList();
    final payments = rows(
      base,
      'payments',
    ).where((i) => same(i['customer_id'], customer['id'])).toList();
    final activeIds = active.map((i) => text(i['id'])).toSet();
    final returns = rows(
      base,
      'returns',
    ).where((r) => activeIds.contains(text(r['invoice_id']))).toList();
    var balance = cents(customer['opening_due']);
    for (final invoice in active) {
      balance +=
          cents(invoice['total_amount']) -
          cents(invoice['returned_total']) -
          cents(invoice['paid_amount']) +
          cents(invoice['refunded']);
    }
    for (final payment in payments) {
      balance -= cents(payment['amount']);
    }
    final entries = <Json>[];
    for (final invoice in active) {
      entries.add({
        'kind': 'invoice',
        'id': invoice['id'],
        'invoice_id': invoice['id'],
        'date': invoice['sale_date'],
        'reference': invoice['invoice_no'],
        'debit': cents(invoice['total_amount']),
        'credit': cents(invoice['paid_amount']),
        'created_at': invoice['created_at'] ?? '',
        'notes': invoice['notes'] ?? '',
      });
    }
    for (final event in returns) {
      entries.add({
        'kind': 'return',
        'id': event['id'],
        'invoice_id': event['invoice_id'],
        'date': event['return_date'],
        'reference': find(active, event['invoice_id'])?['invoice_no'],
        'debit': cents(event['refund']),
        'credit': cents(event['credit']),
        'created_at': event['created_at'] ?? '',
        'notes': event['reason'] ?? '',
      });
    }
    for (final payment in payments) {
      entries.add({
        'kind': 'payment',
        'id': payment['id'],
        'date': payment['payment_date'],
        'reference': 'CP-${payment['id']}',
        'debit': 0,
        'credit': cents(payment['amount']),
        'created_at': payment['created_at'] ?? '',
        'notes': payment['notes'] ?? '',
      });
    }
    const rank = {'invoice': 0, 'return': 1, 'payment': 2};
    entries.sort((a, b) {
      for (final field in ['date', 'created_at']) {
        final cmp = text(a[field]).compareTo(text(b[field]));
        if (cmp != 0) return cmp;
      }
      final cmp = rank[a['kind']]!.compareTo(rank[b['kind']]!);
      return cmp != 0 ? cmp : text(a['id']).compareTo(text(b['id']));
    });
    var running = cents(customer['opening_due']);
    for (final entry in entries) {
      running += (entry['debit'] as int) - (entry['credit'] as int);
      entry['debit'] = (entry['debit'] as int) / 100;
      entry['credit'] = (entry['credit'] as int) / 100;
      entry['balance'] = running / 100;
    }
    return {
      'customer': customer,
      'invoices': bills,
      'payments': payments,
      'entries': entries,
      'opening_balance': number(customer['opening_due']),
      'balance': balance / 100,
      'due': math.max(0, balance) / 100,
      'credit': math.max(0, -balance) / 100,
      'invoice_count': active.length,
    };
  }
}
