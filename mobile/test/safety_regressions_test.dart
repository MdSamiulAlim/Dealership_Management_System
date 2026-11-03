import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/types.dart';
import 'package:arafat_traders/core/workspace.dart';
import 'support.dart';

class DelayedRestoreVault extends MemoryVault {
  DelayedRestoreVault() : super(state());
  final decoding = Completer<void>(), continueDecode = Completer<void>();
  @override
  Future<Json> decodeBackup(
    String source,
    String account,
    String password,
  ) async {
    decoding.complete();
    await continueDecode.future;
    return jsonObject(source);
  }
}

Workspace offlineWorkspace(MemoryVault vault) => Workspace(
  api: FakeApi(
    (m, p, b) async => throw const AppFailure('offline', uncertain: true),
  ),
  vault: vault,
  polling: false,
);
Json payment() => {
  'customer_id': 1,
  'payment_date': '2026-10-29',
  'amount': 100,
  'account': 'Cash',
};
void main() {
  test(
    'a save during restore decrypt waits and survives both commit and restart',
    () async {
      final vault = DelayedRestoreVault(), w = offlineWorkspace(vault);
      await w.unlock('Samiul', 'test');
      final restoring = w.restoreDevice(jsonEncode(state()), 'test');
      await vault.decoding.future;
      final saving = w.command(
        'POST',
        '/api/payments',
        payment(),
        operationId: 'new-payment',
      );
      vault.continueDecode.complete();
      await restoring;
      await saving;
      expect(w.queue.single['id'], 'new-payment');
      expect(vault.saved!['queue'].single['id'], 'new-payment');
      final reopened = offlineWorkspace(vault);
      await reopened.unlock('Samiul', 'test');
      expect(reopened.queue.single['id'], 'new-payment');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      w.dispose();
      reopened.dispose();
    },
  );
  test(
    'a save ahead of restore blocks overwrite of its pending operation',
    () async {
      final vault = MemoryVault(state()), w = offlineWorkspace(vault);
      await w.unlock('Samiul', 'test');
      final saving = w.command(
        'POST',
        '/api/payments',
        payment(),
        operationId: 'keep-payment',
      );
      final restoring = w.restoreDevice(jsonEncode(state()), 'test');
      await expectLater(restoring, throwsA(isA<AppFailure>()));
      await saving;
      expect(vault.saved!['queue'].single['id'], 'keep-payment');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      w.dispose();
    },
  );
  test(
    'persistent Lock suppresses valid-cookie startup and only password unlock clears it',
    () async {
      final vault = MemoryVault(state());
      vault.values.addAll({
        'last_account': 'Samiul',
        'session.Samiul': 'valid-cookie',
      });
      final first = offlineWorkspace(vault);
      await first.unlock('Samiul', 'test');
      await first.lock();
      expect(vault.values['locked.Samiul'], 'true');
      first.dispose();
      var requests = 0;
      final reopened = Workspace(
        api: FakeApi((m, p, b) async {
          requests++;
          return {
            'user': {'username': 'Samiul', 'role': 'admin'},
          };
        }),
        vault: vault,
        polling: false,
      );
      await reopened.init();
      expect(reopened.authenticated, false);
      expect(reopened.view, isEmpty);
      expect(requests, 0);
      await reopened.unlock('Samiul', 'test');
      expect(reopened.authenticated, true);
      expect(vault.values['locked.Samiul'], isNull);
      reopened.dispose();
    },
  );
  test(
    '401 from any private API hides records and persists the locked state',
    () async {
      final vault = MemoryVault(state()),
          w = Workspace(
            api: FakeApi(
              (m, p, b) async => throw const AppFailure('expired', status: 401),
            ),
            vault: vault,
            polling: false,
          );
      await w.unlock('Samiul', 'test');
      await expectLater(
        w.api.request('GET', '/api/admin/operations'),
        throwsA(isA<AppFailure>()),
      );
      expect(w.authenticated, false);
      expect(w.view, isEmpty);
      expect(vault.values['locked.Samiul'], 'true');
      w.dispose();
    },
  );
}
