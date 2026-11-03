import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'types.dart';

abstract class Vault {
  Future<List<String>> accounts();
  Future<String?> getValue(String key);
  Future<void> setValue(String key, String? value);
  Future<Json?> read(String account);
  Future<void> save(String account, Json state, {String? password});
  Future<Json> unlock(String account, String password);
  Future<void> enableOffline(String account, String password);
  Future<bool> offlineEnabled(String account);
  Future<String> export(String account);
  Future<Json> decodeBackup(String source, String account, String password);
}

class NativeVault implements Vault {
  NativeVault({
    FlutterSecureStorage? secure,
    Future<Directory> Function()? directory,
  }) : _secure = secure ?? const FlutterSecureStorage(),
       _directory = directory ?? getApplicationSupportDirectory;
  final FlutterSecureStorage _secure;
  final Future<Directory> Function() _directory;
  final _cipher = AesGcm.with256bits();
  final _random = Random.secure();
  List<int> _nonce([int size = 12]) =>
      List.generate(size, (_) => _random.nextInt(256));
  Future<File> _file(String account) async {
    final hash = await Sha256().hash(utf8.encode(account));
    final folder = Directory('${(await _directory()).path}/secure_workspace');
    await folder.create(recursive: true);
    return File(
      '${folder.path}/${hash.bytes.map((v) => v.toRadixString(16).padLeft(2, '0')).join()}.json',
    );
  }

  @override
  Future<String?> getValue(String key) => _secure.read(key: 'arafat.$key');
  @override
  Future<void> setValue(String key, String? value) => value == null
      ? _secure.delete(key: 'arafat.$key')
      : _secure.write(key: 'arafat.$key', value: value);
  @override
  Future<List<String>> accounts() async =>
      ((jsonDecode(await getValue('accounts') ?? '[]')) as List).cast<String>();
  Future<SecretKey> _key(String account, {bool create = false}) async {
    var value = await getValue('key.$account');
    if (value == null) {
      if (!create) {
        throw const AppFailure(
          'Device records are unavailable. Log in online.',
        );
      }
      value = base64Encode(_nonce(32));
      await setValue('key.$account', value);
    }
    return SecretKey(base64Decode(value));
  }

  Future<Json?> _envelope(String account) async {
    final file = await _file(account);
    if (!await file.exists()) return null;
    return jsonObject(await file.readAsString());
  }

  Future<void> _atomic(File file, Json value) async {
    final temporary = File('${file.path}.next');
    await temporary.writeAsString(jsonEncode(value), flush: true);
    await temporary.rename(file.path);
  }

  Future<Json> _seal(List<int> bytes, SecretKey key) async {
    final nonce = _nonce(),
        box = await _cipher.encrypt(bytes, secretKey: key, nonce: nonce);
    return {
      'nonce': base64Encode(nonce),
      'cipher': base64Encode([...box.cipherText, ...box.mac.bytes]),
    };
  }

  Future<List<int>> _open(Json value, SecretKey key) async {
    final bytes = base64Decode(text(value['cipher']));
    if (bytes.length < 16) throw const AppFailure('Invalid encrypted backup.');
    return _cipher.decrypt(
      SecretBox(
        bytes.sublist(0, bytes.length - 16),
        nonce: base64Decode(text(value['nonce'])),
        mac: Mac(bytes.sublist(bytes.length - 16)),
      ),
      secretKey: key,
    );
  }

  Future<SecretKey> _password(String password, List<int> salt) async =>
      SecretKey(
        await compute(_derivePassword, {'password': password, 'salt': salt}),
      );
  Future<Json> _wrap(SecretKey key, String password) async {
    final salt = _nonce(16), derived = await _password(password, salt);
    return {
      ...await _seal(await key.extractBytes(), derived),
      'salt': base64Encode(salt),
    };
  }

  Future<SecretKey> _unwrap(Json wrap, String password) async => SecretKey(
    await _open(
      wrap,
      await _password(password, base64Decode(text(wrap['salt']))),
    ),
  );
  @override
  Future<Json?> read(String account) async {
    final envelope = await _envelope(account);
    if (envelope == null) return null;
    return jsonObject(utf8.decode(await _open(envelope, await _key(account))));
  }

  @override
  Future<void> save(String account, Json state, {String? password}) async {
    final key = await _key(account, create: true),
        previous = await _envelope(account);
    final envelope = {
      'format': 'arafat-flutter-v1',
      'username': account,
      ...await _seal(utf8.encode(jsonEncode(state)), key),
      'wrap': password == null
          ? (previous?['wrap'])
          : await _wrap(key, password),
    };
    // The whole replica + original operation IDs commit in one atomic rename.
    await _atomic(await _file(account), envelope);
    final names = await accounts();
    if (!names.contains(account)) {
      names.add(account);
      await setValue('accounts', jsonEncode(names));
    }
  }

  @override
  Future<Json> unlock(String account, String password) async {
    final envelope = await _envelope(account);
    if (envelope == null || envelope['wrap'] == null) {
      throw const AppFailure(
        'Enable Offline on this device after logging in online.',
      );
    }
    try {
      final key = await _unwrap(object(envelope['wrap']), password);
      final state = jsonObject(utf8.decode(await _open(envelope, key)));
      await setValue('key.$account', base64Encode(await key.extractBytes()));
      return state;
    } catch (_) {
      throw const AppFailure('Incorrect password or damaged device backup.');
    }
  }

  @override
  Future<bool> offlineEnabled(String account) async =>
      (await _envelope(account))?['wrap'] != null;
  @override
  Future<void> enableOffline(String account, String password) async {
    final envelope = await _envelope(account);
    if (envelope == null) {
      throw const AppFailure('Connect once to load your records.');
    }
    envelope['wrap'] = await _wrap(await _key(account), password);
    await _atomic(await _file(account), envelope);
  }

  @override
  Future<String> export(String account) async {
    final envelope = await _envelope(account);
    if (envelope == null || envelope['wrap'] == null) {
      throw const AppFailure(
        'Enable password-protected Offline mode before exporting.',
      );
    }
    return const JsonEncoder.withIndent('  ').convert(envelope);
  }

  @override
  Future<Json> decodeBackup(
    String source,
    String account,
    String password,
  ) async {
    try {
      final envelope = jsonObject(source);
      if (envelope['username'] != account) {
        throw const AppFailure('Backup belongs to a different account.');
      }
      Json state;
      if (envelope['format'] == 'arafat-encrypted-v2') {
        // Import the original WebCrypto export without using a WebView.
        final key = await _password(
          password,
          base64Decode(text(envelope['salt'])),
        );
        state = jsonObject(
          utf8.decode(
            await _open({
              'nonce': envelope['iv'],
              'cipher': envelope['cipher'],
            }, key),
          ),
        );
      } else if (envelope['format'] == 'arafat-flutter-v1' &&
          envelope['wrap'] != null) {
        state = jsonObject(
          utf8.decode(
            await _open(
              envelope,
              await _unwrap(object(envelope['wrap']), password),
            ),
          ),
        );
      } else {
        throw const AppFailure('Unsupported backup format.');
      }
      if (state['base'] is! Map ||
          state['queue'] is! List ||
          state['ids'] is! Map) {
        throw const AppFailure('Invalid device backup.');
      }
      return state;
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const AppFailure('Incorrect password or damaged device backup.');
    }
  }
}

// Password stretching runs outside the UI isolate so login remains responsive.
Future<List<int>> _derivePassword(Json input) async =>
    (await Pbkdf2(
          macAlgorithm: Hmac.sha256(),
          iterations: 250000,
          bits: 256,
        ).deriveKey(
          secretKey: SecretKey(utf8.encode(text(input['password']))),
          nonce: (input['salt'] as List).cast<int>(),
        ))
        .extractBytes();
