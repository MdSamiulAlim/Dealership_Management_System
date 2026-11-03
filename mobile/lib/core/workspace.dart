import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'api.dart';
import 'ledger.dart';
import 'replica.dart';
import 'types.dart';
import 'vault.dart';

class Workspace extends ChangeNotifier {
  Workspace({
    required WorkspaceApi api,
    required this.vault,
    bool polling = true,
  }) {
    this.api = SessionApi(api, onUnauthorized: _expireSession);
    if (polling) {
      _timer = Timer.periodic(const Duration(seconds: 20), (_) {
        if (authenticated && !busy && !syncing) unawaited(sync(silent: true));
      });
    }
  }
  late final WorkspaceApi api;
  int _accessRevision = 0;
  final Vault vault;
  final uuid = const Uuid();
  Timer? _timer;
  Json? _state;
  Json view = {};
  String language = 'bn', account = '', error = '';
  List<String> savedAccounts = [];
  bool ready = false,
      authenticated = false,
      busy = false,
      syncing = false,
      resetting = false,
      online = true,
      offlineReady = false;
  int progress = 0;
  bool _closed = false;
  Future<void> _serial = Future.value();
  Future<T> _exclusive<T>(Future<T> Function() action) async {
    final before = _serial, done = Completer<void>();
    _serial = done.future;
    await before;
    try {
      return await action();
    } finally {
      done.complete();
    }
  }

  List<Json> get queue => _state == null ? [] : rows(_state!, 'queue');
  int get pending => queue.length;
  bool get admin => view['user']?['role'] == 'admin';
  String tr(String en, String bn) => language == 'bn' ? bn : en;
  void _notify() {
    if (!_closed) notifyListeners();
  }

  void _refresh() {
    if (!authenticated || _state == null) {
      view = {};
      return;
    }
    view = Ledger.project(_state!);
  }

  Future<void> _commit(Json next, {String? password}) async {
    await vault.save(account, next, password: password);
    _state = next;
    _refresh();
    _notify();
  }

  Future<void> init() async {
    try {
      language = await vault.getValue('language') ?? 'bn';
      savedAccounts = await vault.accounts();
      account = await vault.getValue('last_account') ?? '';
      if (account.isNotEmpty) {
        offlineReady = await vault.offlineEnabled(account);
        final locked = await vault.getValue('locked.$account') == 'true';
        api.cookie = locked ? null : await vault.getValue('session.$account');
        if (api.cookie != null) {
          try {
            final result = await api.request('GET', '/api/check-login');
            final cached = await vault.read(account);
            _state =
                cached ??
                {
                  'base': await Replica(api).initial(object(result['user'])),
                  'queue': <dynamic>[],
                  'ids': <String, dynamic>{},
                };
            _state!['base']['user'] = result['user'];
            authenticated = true;
            _accessRevision++;
            online = true;
            _refresh();
          } on AppFailure catch (e) {
            online = !e.uncertain;
            if (e.status == 401) {
              api.cookie = null;
              await vault.setValue('session.$account', null);
            }
          }
        }
      }
    } catch (_) {
      error = 'Device storage is unavailable. Please try again.';
    } finally {
      ready = true;
      _notify();
    }
    if (authenticated) unawaited(sync(silent: true));
  }

  Future<void> setLanguage(String value) async {
    language = value == 'en' ? 'en' : 'bn';
    await vault.setValue('language', language);
    _notify();
  }

  Future<void> signIn(
    String username,
    String password, {
    bool offline = true,
  }) async {
    if (pending > 0 && account != username.trim()) {
      throw const AppFailure('Sync pending work before switching accounts.');
    }
    if (busy) return;
    busy = true;
    error = '';
    _notify();
    final oldCookie = api.cookie;
    try {
      api.cookie = null;
      final result = await api.request('POST', '/api/login', {
        'username': username.trim(),
        'password': password,
      });
      account = text(result['user']['username']);
      await vault.setValue('session.$account', api.cookie);
      final saved = await vault.read(account);
      final next =
          saved ??
          {
            'base': await Replica(api).initial(
              object(result['user']),
              progress: (count) {
                progress = count;
                _notify();
              },
            ),
            'queue': <dynamic>[],
            'ids': <String, dynamic>{},
          };
      next['base']['user'] = result['user'];
      await _commit(next, password: offline ? password : null);
      offlineReady = await vault.offlineEnabled(account);
      await vault.setValue('last_account', account);
      savedAccounts = await vault.accounts();
      await vault.setValue('locked.$account', null);
      authenticated = true;
      _accessRevision++;
      _refresh();
      online = true;
      progress = 0;
    } catch (e) {
      api.cookie = oldCookie;
      rethrow;
    } finally {
      busy = false;
      _notify();
    }
    unawaited(sync(silent: true));
  }

  Future<void> unlock(String username, String password) async {
    if (busy) return;
    busy = true;
    error = '';
    _notify();
    try {
      final next = await vault.unlock(username, password);
      await vault.setValue('locked.$username', null);
      account = username;
      _state = next;
      api.cookie = await vault.getValue('session.$account');
      authenticated = true;
      _accessRevision++;
      offlineReady = true;
      online = false;
      _refresh();
      await vault.setValue('last_account', account);
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> enableOffline(String password) => _exclusive(() async {
    if (!authenticated || !online) {
      throw const AppFailure('Connect and log in before enabling Offline.');
    }
    // Verify the actual account; never wrap a cached workspace with an
    // unverified password supplied on a shared device.
    final session = api.cookie;
    try {
      final verified = await api.request('POST', '/api/login', {
        'username': account,
        'password': password,
      });
      if (verified['user']['username'] != account) {
        throw const AppFailure('Account mismatch.');
      }
      await vault.setValue('session.$account', api.cookie);
      await vault.enableOffline(account, password);
      offlineReady = true;
      _notify();
    } catch (_) {
      api.cookie = session;
      rethrow;
    }
  });

  Future<void> signOut() => _exclusive(() async {
    if (pending > 0 || syncing) {
      throw const AppFailure('Sync pending work before logging out.');
    }
    await api.request('POST', '/api/logout', {});
    await vault.setValue('session.$account', null);
    api.cookie = null;
    _state = null;
    view = {};
    authenticated = false;
    _accessRevision++;
    _notify();
  });

  Future<void> lock() => _exclusive(() async {
    if (syncing || busy) {
      throw const AppFailure('Wait for Sync to finish before locking.');
    }
    await vault.setValue('locked.$account', 'true');
    _state = null;
    view = {};
    authenticated = false;
    _accessRevision++;
    error = '';
    _notify();
  });

  Future<void> _expireSession() async {
    final expiredAccount = account;
    authenticated = false;
    _accessRevision++;
    api.cookie = null;
    view = {};
    _notify();
    try {
      await vault.setValue('locked.$expiredAccount', 'true');
      await vault.setValue('session.$expiredAccount', null);
    } catch (_) {
      // Memory stays locked even when secure storage is temporarily unavailable.
    }
  }

  void _requireAccess() {
    if (!authenticated || _state == null) {
      throw const AppFailure('Log in to continue.');
    }
  }

  Json? find(String collection, dynamic id) =>
      Ledger.find(rows(view, collection), id);
  Future<void> command(
    String method,
    String path,
    Json payload, {
    String? operationId,
  }) async {
    if (resetting) {
      throw AppFailure(
        tr(
          'Reset is in progress. Wait for it to finish before saving.',
          'রিসেট চলছে। শেষ হলে আবার সেভ করুন।',
        ),
      );
    }
    if (!authenticated || _state == null) {
      throw const AppFailure('Log in to continue.');
    }
    final commandAccount = account, commandAccess = _accessRevision;
    await _exclusive(() async {
      _requireAccess();
      if (account != commandAccount || _accessRevision != commandAccess) {
        throw const AppFailure('Log in to continue.');
      }
      final p = clone(payload),
          parts = path.split('/'),
          entity = parts[2],
          id = parts.length > 3 ? parts[3] : null;
      if (['PATCH', 'DELETE'].contains(method) &&
          entity != 'invoices' &&
          entity != 'settings' &&
          p['original'] == null) {
        p['original'] = find(entity, id);
      }
      if (method == 'DELETE') p['confirmed'] = true;
      if (entity == 'invoices') {
        if (p.containsKey('invoice_no')) {
          p['invoice_no'] = text(p['invoice_no']).trim();
        }
        for (final item in rows(p, 'items')) {
          bags(item['quantity'], minimum: path.endsWith('/return') ? 0 : 1);
        }
      }
      final op = <String, dynamic>{
        'id': operationId ?? uuid.v4(),
        'method': method,
        'path': path,
        'payload': p,
        'workspace_epoch': _state!['base']['workspace_epoch'] ?? 0,
        'created_at': DateTime.now().millisecondsSinceEpoch,
        'temp_id': -DateTime.now().microsecondsSinceEpoch,
      };
      if (utf8.encode(jsonEncode(op)).length > 1024 * 1024) {
        throw const AppFailure(
          'This save is too large. Shorten the note and try again.',
        );
      }
      final next = clone(_state!);
      final candidate = rows(next, 'queue');
      if (candidate.any((q) => q['id'] == op['id'])) {
        throw const AppFailure('This operation is already pending.');
      }
      (next['queue'] as List).add(op);
      // Validate the whole ordered projected journal before persisting a write.
      Ledger.project(next, strict: true);
      await _commit(next);
    });
    unawaited(sync(silent: true));
  }

  Json _wire(Json operation) {
    final op = clone(operation), ids = object(_state!['ids'] ?? {});
    op['payload'] = Ledger.resolve(op['payload'], ids);
    op['path'] = text(op['path']).replaceAllMapped(
      RegExp(r'/(-\d+)(?=/|$)'),
      (m) => '/${ids[m[1]] ?? m[1]}',
    );
    final original = op['payload']['original'];
    if (original is Map && number(original['id']) < 0) {
      final parts = text(op['path']).split('/'),
          current = Ledger.find(
            rows(object(_state!['base']), parts[2]),
            parts[3],
          );
      if (current == null) {
        throw const AppFailure('A pending dependency has not synced yet.');
      }
      op['payload']['original'] = {...original, ...current};
    }
    for (final name in ['error', 'rejected', 'conflict', 'sent', 'wire']) {
      op.remove(name);
    }
    return op;
  }

  Future<void> sync({bool silent = false}) async {
    if (!authenticated || _state == null || syncing || resetting) return;
    syncing = true;
    error = '';
    _notify();
    try {
      await _exclusive(() async {
        // A verified session is required to send work saved while offline.
        final verified = await api.request('GET', '/api/check-login');
        if (verified['user']['username'] != account) {
          throw const AppFailure('Account mismatch.');
        }
        final repaired = clone(_state!);
        var repair = false;
        (repaired['queue'] as List).removeWhere((q) {
          final drop = q['path'] == '/api/sync-akij' && q['method'] == 'POST';
          repair |= drop;
          return drop;
        });
        for (final q in repaired['queue']) {
          if (q['error'] == 'Record exceeds the sync page limit.' &&
              (q['wire'] != null || q['sent'] == true)) {
            q.remove('rejected');
            q.remove('error');
            q.remove('conflict');
            repair = true;
          }
        }
        if (repair) await _commit(repaired);
        while (pending > 0) {
          final queued = queue.first;
          if (queued['rejected'] == true) {
            throw AppFailure(
              text(queued['error']).isEmpty
                  ? 'Review the failed action before retrying.'
                  : text(queued['error']),
            );
          }
          final wire = queued['wire'] == null
              ? _wire(queued)
              : object(queued['wire']);
          final reserved = clone(_state!);
          reserved['queue'][0]['wire'] = wire;
          reserved['queue'][0]['sent'] = true;
          await _commit(reserved);
          Json result;
          try {
            result = await api.request('POST', '/api/commands', wire);
          } on AppFailure catch (e) {
            final failed = clone(_state!);
            failed['queue'][0]['error'] = e.message;
            failed['queue'][0]['rejected'] =
                e.status != null &&
                e.status! >= 400 &&
                e.status! < 500 &&
                e.status != 401;
            failed['queue'][0]['conflict'] = e.status == 409;
            await _commit(failed);
            rethrow;
          }
          // Once acknowledged, ANY subsequent delta failure is reconciliation,
          // not a rejected sale. Retain the exact wire ID and payload for replay.
          Json refreshed;
          try {
            refreshed = result['sync_protocol'] == 2
                ? await Replica(api).pull(object(_state!['base']))
                : result;
          } catch (_) {
            throw const AppFailure(
              'Save status is pending. Sync to safely check and retry.',
              uncertain: true,
            );
          }
          final next = clone(_state!),
              response = object(result['command_result'] ?? {});
          if (number(queued['temp_id']) < 0) {
            if (queued['payload']['customer_id'] == 'new' &&
                response['customer_id'] != null) {
              next['ids'][text(queued['temp_id'])] = response['customer_id'];
            } else if (response['entity'] != 'invoices' &&
                response['id'] != null) {
              next['ids'][text(queued['temp_id'])] = response['id'];
            }
          }
          next['queue'] = (next['queue'] as List)
              .where((q) => q['id'] != queued['id'])
              .toList();
          refreshed['user'] = verified['user'];
          next['base'] = refreshed;
          next['saved_at'] = DateTime.now().toUtc().toIso8601String();
          await _commit(next);
        }
        Json refreshed;
        try {
          refreshed = await Replica(api).pull(object(_state!['base']));
        } on AppFailure catch (e) {
          if (e.status != 409) rethrow;
          refreshed = await Replica(api).initial(object(verified['user']));
        }
        refreshed['user'] = verified['user'];
        if (refreshed['sync_revision'] != _state!['base']['sync_revision'] ||
            refreshed['workspace_epoch'] !=
                _state!['base']['workspace_epoch']) {
          await _commit({
            ...clone(_state!),
            'base': refreshed,
            if (refreshed['workspace_epoch'] !=
                _state!['base']['workspace_epoch'])
              'ids': <String, dynamic>{},
            'saved_at': DateTime.now().toUtc().toIso8601String(),
          });
        }
        online = true;
      });
    } on AppFailure catch (e) {
      error = e.message;
      online = !e.uncertain;

      if (!silent) rethrow;
    } catch (e) {
      error = 'Sync could not finish. Saved work remains on this device.';
      if (!silent) rethrow;
    } finally {
      syncing = false;
      _notify();
    }
  }

  Future<void> discard(String id) async {
    await _exclusive(() async {
      final next = clone(_state!),
          entry = rows(next, 'queue').firstWhere((q) => q['id'] == id);
      if ((entry['wire'] != null || entry['sent'] == true) &&
          entry['rejected'] != true) {
        throw const AppFailure(
          'Save status is pending. Sync to safely check and retry.',
        );
      }
      if (rows(next, 'queue').any(
        (q) =>
            q['id'] != id &&
            jsonEncode(q['payload']).contains(text(entry['temp_id'])),
      )) {
        throw const AppFailure('Remove dependent pending actions first.');
      }
      (next['queue'] as List).removeWhere((q) => q['id'] == id);
      await _commit(next);
    });
  }

  Future<void> retry(String id) async {
    await _exclusive(() async {
      final next = clone(_state!);
      for (final q in next['queue']) {
        if (q['id'] == id) {
          q.remove('rejected');
          q.remove('error');
        }
      }
      await _commit(next);
    });
    await sync();
  }

  Future<void> syncCodes() async {
    await sync();
    if (pending > 0) {
      throw const AppFailure(
        'Sync pending work before updating product codes.',
      );
    }
    await api.request('POST', '/api/sync-akij', {}, {
      'X-Workspace-Epoch': text(view['workspace_epoch'] ?? 0),
    });
    await sync();
  }

  Future<String> exportDevice() => vault.export(account);
  Future<void> restoreDevice(
    String source,
    String password,
  ) => _exclusive(() async {
    _requireAccess();
    if (pending > 0) {
      throw const AppFailure('Sync or export pending work before restoring.');
    }
    final restoreAccount = account, restoreAccess = _accessRevision;
    // Decrypt, validate and commit under the same lock used by every queued save.
    // Saves ahead of us block restore; saves behind us append after the restore.
    final imported = await vault.decodeBackup(source, restoreAccount, password);
    _requireAccess();
    if (account != restoreAccount || _accessRevision != restoreAccess) {
      throw const AppFailure('Log in to continue.');
    }
    imported['base']['user'] = view['user'];
    (imported['queue'] as List).removeWhere(
      (q) => q['path'] == '/api/sync-akij' && q['method'] == 'POST',
    );
    Ledger.project(imported, strict: true);
    await _commit(imported, password: password);
    offlineReady = true;
    _notify();
    unawaited(sync(silent: true));
  });

  Future<void> reset(String confirmation) async {
    _requireAccess();
    if (!admin) {
      throw const AppFailure('Only the Admin can reset all app data.');
    }
    if (resetting) {
      throw AppFailure(
        tr('Reset is already in progress.', 'রিসেট ইতিমধ্যে চলছে।'),
      );
    }
    final resetAccount = account, resetAccess = _accessRevision;
    void requireResetAccess() {
      _requireAccess();
      if (account != resetAccount || _accessRevision != resetAccess) {
        throw const AppFailure('Log in to continue.');
      }
    }

    // Reserve the guard synchronously so new saves cannot slip into the gap
    // before the lock is acquired. Earlier saves keep their position and make
    // the pending-work check below reject reset instead of overwriting them.
    resetting = true;
    _notify();
    try {
      await _exclusive(() async {
        requireResetAccess();
        if (!admin) {
          throw const AppFailure('Only the Admin can reset all app data.');
        }
        if (pending > 0 || syncing) {
          throw const AppFailure('Sync pending work before resetting.');
        }
        final user = clone(object(view['user']));
        await api.request('POST', '/api/reset-workspace', {
          'id': uuid.v4(),
          'workspace_epoch': view['workspace_epoch'] ?? 0,
          'confirmation': confirmation,
        });
        requireResetAccess();
        final base = await Replica(api).initial(user);
        requireResetAccess();
        await _commit({
          'base': base,
          'queue': <dynamic>[],
          'ids': <String, dynamic>{},
        });
      });
    } finally {
      resetting = false;
      _notify();
    }
  }

  @override
  void dispose() {
    _closed = true;
    _timer?.cancel();
    api.close();
    super.dispose();
  }
}
