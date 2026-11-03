import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/types.dart';
import 'package:arafat_traders/core/workspace.dart';
import 'support.dart';

class ResetGate {
  final entered = Completer<void>(), resume = Completer<void>();
  Future<void> wait() async {
    entered.complete();
    await resume.future;
  }

  void release() {
    if (!resume.isCompleted) resume.complete();
  }
}

class ResetVault extends MemoryVault {
  ResetVault({this.commitGate}) : super(state());
  final ResetGate? commitGate;
  @override
  Future<void> save(String account, Json next, {String? password}) async {
    if (next['base']['workspace_epoch'] == 1 &&
        commitGate != null &&
        !commitGate!.entered.isCompleted) {
      await commitGate!.wait();
    }
    await super.save(account, next, password: password);
  }
}

class ResetServer {
  ResetServer({this.requestGate, this.replicaGate, this.fail = false});
  final ResetGate? requestGate, replicaGate;
  bool fail;
  int resets = 0, syncs = 0;
  Future<Json> request(String method, String path, Json? body) async {
    if (path == '/api/reset-workspace') {
      resets++;
      await requestGate?.wait();
      if (fail) throw const AppFailure('Reset failed.', uncertain: true);
      return {};
    }
    if (path.startsWith('/api/replica/start')) {
      await replicaGate?.wait();
      final base = fixture();
      return {
        'workspace_epoch': 1,
        'sync_revision': 1,
        'settings': base['settings'],
        'initial_page': {
          'done': true,
          'groups': [
            {'entity': 'products', 'rows': base['products']},
          ],
        },
      };
    }
    if (path.startsWith('/api/replica/changes')) {
      return {'changes': [], 'next_revision': 1, 'has_more': false};
    }
    if (path == '/api/check-login') syncs++;
    throw const AppFailure('offline', uncertain: true);
  }
}

Json collection() => {
  'customer_id': 1,
  'payment_date': '2026-10-30',
  'amount': 100,
  'account': 'Cash',
};

void main() {
  for (final stage in ['request', 'replica', 'commit']) {
    test(
      'reset guards new payments throughout $stage and releases on completion',
      () async {
        final gate = ResetGate();
        final server = ResetServer(
          requestGate: stage == 'request' ? gate : null,
          replicaGate: stage == 'replica' ? gate : null,
        );
        final vault = ResetVault(commitGate: stage == 'commit' ? gate : null);
        final w = Workspace(
          api: FakeApi(server.request),
          vault: vault,
          polling: false,
        );
        addTearDown(w.dispose);
        await w.unlock('Samiul', 'test');
        w.language = 'en';
        final resetting = w.reset('RESET ALL DATA');
        try {
          await gate.entered.future;
          await expectLater(
            w.command('POST', '/api/payments', collection()),
            throwsA(
              isA<AppFailure>().having(
                (e) => e.message,
                'message',
                contains('Reset is in progress'),
              ),
            ),
          );
          await expectLater(
            w.reset('RESET ALL DATA'),
            throwsA(isA<AppFailure>()),
          );
          expect(server.resets, 1);
          await w.sync();
          expect(server.syncs, 0);
        } finally {
          gate.release();
          await resetting;
        }
        expect(w.pending, 0);
        expect(w.view['workspace_epoch'], 1);
        expect(w.view['customers'], isEmpty);
        // A new save after reset is durable and belongs to the new epoch.
        await w.command('POST', '/api/transactions', {
          'txn_date': '2026-10-30',
          'type': 'Other Income',
          'account': 'Cash',
          'amount': 100,
          'category': 'General',
        }, operationId: 'after-reset');
        expect(vault.saved!['queue'].single['id'], 'after-reset');
        expect(vault.saved!['queue'].single['workspace_epoch'], 1);
        final reopened = Workspace(
          api: FakeApi(server.request),
          vault: vault,
          polling: false,
        );
        addTearDown(reopened.dispose);
        await reopened.unlock('Samiul', 'test');
        expect(reopened.queue.single['id'], 'after-reset');
        await Future<void>.delayed(Duration.zero);
      },
    );
  }

  test(
    'a save queued before reset prevents reset and survives restart',
    () async {
      final server = ResetServer(), vault = MemoryVault(state());
      final w = Workspace(
        api: FakeApi(server.request),
        vault: vault,
        polling: false,
      );
      addTearDown(w.dispose);
      await w.unlock('Samiul', 'test');
      final saving = w.command(
        'POST',
        '/api/payments',
        collection(),
        operationId: 'before-reset',
      );
      final resetting = w.reset('RESET ALL DATA');
      await expectLater(resetting, throwsA(isA<AppFailure>()));
      await saving;
      expect(server.resets, 0);
      expect(vault.saved!['queue'].single['id'], 'before-reset');
      final reopened = Workspace(
        api: FakeApi(server.request),
        vault: vault,
        polling: false,
      );
      addTearDown(reopened.dispose);
      await reopened.unlock('Samiul', 'test');
      expect(reopened.queue.single['id'], 'before-reset');
      await Future<void>.delayed(Duration.zero);
    },
  );

  test(
    'a failed reset leaves existing data usable for a durable payment',
    () async {
      final server = ResetServer(fail: true), vault = MemoryVault(state());
      final w = Workspace(
        api: FakeApi(server.request),
        vault: vault,
        polling: false,
      );
      addTearDown(w.dispose);
      await w.unlock('Samiul', 'test');
      await expectLater(w.reset('RESET ALL DATA'), throwsA(isA<AppFailure>()));
      expect(w.view['workspace_epoch'], 0);
      await w.command(
        'POST',
        '/api/payments',
        collection(),
        operationId: 'after-failure',
      );
      expect(vault.saved!['queue'].single['id'], 'after-failure');
      await Future<void>.delayed(Duration.zero);
    },
  );

  test(
    'session expiry during reset cannot commit a replacement workspace',
    () async {
      final gate = ResetGate(), vault = MemoryVault(state());
      final server = ResetServer(replicaGate: gate);
      final w = Workspace(
        api: FakeApi((m, p, b) async {
          if (p == '/api/expire-test') {
            throw const AppFailure('expired', status: 401);
          }
          return server.request(m, p, b);
        }),
        vault: vault,
        polling: false,
      );
      addTearDown(w.dispose);
      await w.unlock('Samiul', 'test');
      final resetting = w.reset('RESET ALL DATA');
      await gate.entered.future;
      await expectLater(
        w.api.request('GET', '/api/expire-test'),
        throwsA(isA<AppFailure>()),
      );
      final rejected = expectLater(resetting, throwsA(isA<AppFailure>()));
      gate.release();
      await rejected;
      expect(w.view, isEmpty);
      expect(vault.saved!['base']['workspace_epoch'], 0);
    },
  );
}
