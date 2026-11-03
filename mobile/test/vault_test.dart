import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:arafat_traders/core/vault.dart';
import 'package:arafat_traders/core/types.dart';
import 'support.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'native vault encrypts at rest and portable backup preserves queued IDs',
    () async {
      FlutterSecureStorage.setMockInitialValues({});
      final dir = await Directory.systemTemp.createTemp('arafat-vault-test');
      addTearDown(() => dir.delete(recursive: true));
      final vault = NativeVault(directory: () async => dir), s = state();
      s['queue'] = [
        op('POST', '/api/payments', {'amount': 100}, id: 'preserve-this-id'),
      ];
      await vault.save('Samiul', s, password: 'fixture-only-password');
      final stored = await Directory(
        '${dir.path}/secure_workspace',
      ).list().first;
      final raw = await File(stored.path).readAsString();
      expect(raw, isNot(contains('preserve-this-id')));
      expect(raw, isNot(contains('Fish feed')));
      expect(await vault.read('Samiul'), s);
      final exported = await vault.export('Samiul');
      final imported = await vault.decodeBackup(
        exported,
        'Samiul',
        'fixture-only-password',
      );
      expect(imported, s);
      await expectLater(
        vault.decodeBackup(exported, 'Samiul', 'wrong'),
        throwsA(
          predicate(
            (e) => e is AppFailure && e.message.contains('Incorrect password'),
          ),
        ),
      );
      expect(await vault.read('Samiul'), s);
      expect(await vault.unlock('Samiul', 'fixture-only-password'), s);
    },
    timeout: const Timeout(Duration(minutes: 3)),
  );
  test(
    'original JavaScript WebCrypto backup imports without changing operation IDs',
    () async {
      final vault = NativeVault();
      final source = await File('test/fixtures/legacy-v2.json').readAsString();
      final imported = await vault.decodeBackup(
        source,
        'Samiul',
        'fixture-only-password',
      );
      expect(imported['queue'][0]['id'], 'original-stable-operation');
      expect(imported['ids']['-3'], 12);
      expect(imported['base']['workspace_epoch'], 4);
      await expectLater(
        vault.decodeBackup(source, 'Samiul', 'wrong'),
        throwsA(
          predicate(
            (e) => e is AppFailure && e.message.contains('Incorrect password'),
          ),
        ),
      );
      await expectLater(
        vault.decodeBackup(source, 'Arafat', 'fixture-only-password'),
        throwsA(isA<AppFailure>()),
      );
    },
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
