import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/workspace.dart';
import 'package:arafat_traders/core/types.dart';
import 'support.dart';

Future<void> settled(Workspace w) async {
  for (var n = 0; n < 100; n++) {
    await Future<void>.delayed(const Duration(milliseconds: 2));
    if (!w.syncing) return;
  }
  fail('Sync did not finish');
}

void main() {
  test(
    'lost response replays exact persisted operation ID without duplicate payment',
    () async {
      final vault = MemoryVault(state());
      final wires = <Json>[];
      final accepted = <String>{};
      var reject = true;
      final api = FakeApi((m, p, b) async {
        if (p == '/api/check-login') {
          return {
            'user': {'username': 'Samiul', 'role': 'admin'},
          };
        }
        if (p == '/api/commands') {
          wires.add(clone(b!));
          accepted.add(text(b['id']));
          if (reject) throw const AppFailure('response lost', uncertain: true);
          return {
            'sync_protocol': 2,
            'command_result': {'entity': 'payments', 'id': 3},
          };
        }
        if (p.startsWith('/api/replica/changes')) {
          return {
            'changes': [
              {
                'entity': 'customer_payments',
                'record_id': 3,
                'data': {
                  'id': 3,
                  'customer_id': 1,
                  'payment_date': '2026-10-29',
                  'amount': 100,
                  'account': 'Cash',
                },
              },
            ],
            'next_revision': 1,
            'has_more': false,
          };
        }
        throw StateError(p);
      });
      final w = Workspace(api: api, vault: vault, polling: false);
      await w.unlock('Samiul', 'test');
      await w.command('POST', '/api/payments', {
        'customer_id': 1,
        'payment_date': '2026-10-29',
        'amount': 100,
        'account': 'Cash',
      });
      await settled(w);
      expect(w.pending, 1);
      expect(w.queue.first['wire'], isNotNull);
      expect(w.view['dashboard']['cash_balance'], 100);
      await expectLater(
        w.discard(text(w.queue.first['id'])),
        throwsA(isA<AppFailure>()),
      );
      reject = false;
      await w.sync();
      expect(w.pending, 0);
      expect(accepted.length, 1);
      expect(wires.length, 2);
      expect(wires[0], wires[1]);
      expect(w.view['dashboard']['cash_balance'], 100);
      w.dispose();
    },
  );
  test(
    'acknowledged payment remains pending if subsequent delta returns 4xx',
    () async {
      final vault = MemoryVault(state());
      var failDelta = true;
      final ids = <String>[];
      final api = FakeApi((m, p, b) async {
        if (p == '/api/check-login') {
          return {
            'user': {'username': 'Samiul', 'role': 'admin'},
          };
        }
        if (p == '/api/commands') {
          ids.add(text(b!['id']));
          return {
            'sync_protocol': 2,
            'command_result': {'entity': 'payments', 'id': 5},
          };
        }
        if (failDelta) throw const AppFailure('delta blocked', status: 413);
        return {'changes': [], 'next_revision': 1, 'has_more': false};
      });
      final w = Workspace(api: api, vault: vault, polling: false);
      await w.unlock('Samiul', 'test');
      await w.command('POST', '/api/payments', {
        'customer_id': 1,
        'payment_date': '2026-10-29',
        'amount': 100,
        'account': 'Cash',
      });
      await settled(w);
      expect(w.queue.first['rejected'], isNot(true));
      expect(w.pending, 1);
      failDelta = false;
      await w.sync();
      expect(ids.toSet().length, 1);
      expect(w.pending, 0);
      w.dispose();
    },
  );
  test(
    'failed durable save sends nothing and leaves queue unchanged',
    () async {
      final vault = MemoryVault(state());
      var sent = 0;
      final api = FakeApi((m, p, b) async {
        sent++;
        return {};
      });
      final w = Workspace(api: api, vault: vault, polling: false);
      await w.unlock('Samiul', 'test');
      vault.fail = true;
      await expectLater(
        w.command('POST', '/api/payments', {
          'customer_id': 1,
          'payment_date': '2026-10-29',
          'amount': 100,
          'account': 'Cash',
        }),
        throwsA(isA<AppFailure>()),
      );
      expect(w.pending, 0);
      expect(sent, 0);
      w.dispose();
    },
  );
  test(
    'pending work blocks switching and logging out; general user cannot reset',
    () async {
      final s = state();
      s['base']['user']['role'] = 'general';
      s['queue'] = [
        op('POST', '/api/payments', {
          'customer_id': 1,
          'payment_date': '2026-10-29',
          'amount': 1,
          'account': 'Cash',
        }),
      ];
      var requests = 0;
      final w = Workspace(
        api: FakeApi((m, p, b) async {
          requests++;
          return {};
        }),
        vault: MemoryVault(s),
        polling: false,
      );
      await w.unlock('Samiul', 'test');
      await expectLater(w.signIn('Arafat', 'test'), throwsA(isA<AppFailure>()));
      await expectLater(w.signOut(), throwsA(isA<AppFailure>()));
      await expectLater(w.reset('RESET ALL DATA'), throwsA(isA<AppFailure>()));
      expect(requests, 0);
      w.dispose();
    },
  );
  test('server revocation rejects cached session at startup', () async {
    final vault = MemoryVault(state());
    vault.values.addAll({
      'last_account': 'Samiul',
      'session.Samiul': 'old-cookie',
    });
    final w = Workspace(
      api: FakeApi(
        (m, p, b) async => throw const AppFailure('expired', status: 401),
      ),
      vault: vault,
      polling: false,
    );
    await w.init();
    expect(w.authenticated, false);
    expect(w.view, isEmpty);
    expect(vault.values['session.Samiul'], isNull);
    w.dispose();
  });
}
