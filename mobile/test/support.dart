import 'dart:typed_data';
import 'package:arafat_traders/core/api.dart';
import 'package:arafat_traders/core/types.dart';
import 'package:arafat_traders/core/vault.dart';

Json fixture() => {
  for (final name in collections) name: <dynamic>[],
  'workspace_epoch': 0,
  'sync_revision': 0,
  'settings': {
    'name': 'Arafat Traders',
    'phone': '+8801646130402',
    'version': 1,
  },
  'user': {'username': 'Samiul', 'role': 'admin'},
  'products': [
    {
      'id': 1,
      'name': 'Fish feed',
      'product_code': '501',
      'category': 'Fish feed',
      'bag_weight': 25,
      'default_rate': 100,
      'opening_stock': 100,
      'low_stock_level': 5,
    },
  ],
  'customers': [
    {'id': 1, 'name': 'Same name', 'opening_due': 0},
    {'id': 2, 'name': 'Same name', 'opening_due': 0},
  ],
};
Json state([Json? base]) => {
  'base': base ?? fixture(),
  'queue': <dynamic>[],
  'ids': <String, dynamic>{},
};
Json op(
  String method,
  String path,
  Json payload, {
  int temp = -1,
  String id = 'operation',
}) => {
  'id': id,
  'method': method,
  'path': path,
  'payload': payload,
  'workspace_epoch': 0,
  'created_at': 0,
  'temp_id': temp,
};

class MemoryVault implements Vault {
  Json? saved;
  final values = <String, String>{};
  bool fail = false;
  MemoryVault([Json? initial]) : saved = initial;
  @override
  Future<List<String>> accounts() async => saved == null ? [] : ['Samiul'];
  @override
  Future<String?> getValue(String key) async => values[key];
  @override
  Future<void> setValue(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }

  @override
  Future<Json?> read(String account) async =>
      saved == null ? null : clone(saved!);
  @override
  Future<void> save(String account, Json next, {String? password}) async {
    if (fail) throw const AppFailure('disk full');
    saved = clone(next);
  }

  @override
  Future<bool> offlineEnabled(String account) async => true;
  @override
  Future<void> enableOffline(String account, String password) async {}
  @override
  Future<Json> unlock(String account, String password) async => clone(saved!);
  @override
  Future<String> export(String account) async => '';
  @override
  Future<Json> decodeBackup(
    String source,
    String account,
    String password,
  ) async => jsonObject(source);
}

class FakeApi implements WorkspaceApi {
  FakeApi(this.handler);
  final Future<Json> Function(String, String, Json?) handler;
  @override
  String? cookie;
  @override
  Future<Json> request(
    String method,
    String path, [
    Json? payload,
    Map<String, String>? headers,
  ]) => handler(method, path, payload);
  @override
  Future<Uint8List> download(String path) async => Uint8List(0);
  @override
  void close() {}
}
