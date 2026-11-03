import 'dart:convert';

typedef Json = Map<String, dynamic>;
Json object(dynamic value) => Map<String, dynamic>.from(value as Map);
Json jsonObject(String value) => object(jsonDecode(value));
Json clone(Json value) => object(jsonDecode(jsonEncode(value)));
List<Json> rows(Json value, String key) =>
    (value[key] as List? ?? []).map(object).toList();
double number(dynamic value) => value is num
    ? value.toDouble()
    : double.tryParse(value?.toString() ?? '') ?? 0;
int cents(dynamic value) {
  final n = number(value);
  if (!n.isFinite || n.abs() > 90071992547409.9) {
    throw const AppFailure('Amount exceeds the supported precision.');
  }
  return ((n + 2.220446049250313e-16) * 100 + .5).floor();
}

double money(dynamic value) => cents(value) / 100;
String idKey(dynamic value) {
  final n = num.tryParse(text(value));
  return n != null && n.isFinite && n == n.truncateToDouble()
      ? n.toInt().toString()
      : text(value);
}

bool same(dynamic a, dynamic b) => idKey(a) == idKey(b);
bool flag(dynamic value) => value == true || value == 1;
String text(dynamic value) => value?.toString() ?? '';
int bags(dynamic value, {int minimum = 0}) {
  final parsed = double.tryParse(text(value));
  if (parsed == null ||
      !parsed.isFinite ||
      parsed != parsed.truncateToDouble() ||
      parsed < minimum ||
      parsed > 1e12) {
    throw StateError('Quantity must be a whole number.');
  }
  return parsed.toInt();
}

String today([DateTime? now]) => (now ?? DateTime.now())
    .toUtc()
    .add(const Duration(hours: 6))
    .toIso8601String()
    .substring(0, 10);
const collections = [
  'products',
  'archived_products',
  'customers',
  'orders',
  'sales',
  'payments',
  'adjustments',
  'transactions',
  'invoices',
  'returns',
];
const tableNames = {
  'company_orders': 'orders',
  'customer_payments': 'payments',
  'stock_adjustments': 'adjustments',
  'invoice_returns': 'returns',
};

class AppFailure implements Exception {
  const AppFailure(this.message, {this.status, this.uncertain = false});
  final String message;
  final int? status;
  final bool uncertain;
  @override
  String toString() => message;
}
