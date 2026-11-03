import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:arafat_traders/core/api.dart';
import 'package:arafat_traders/core/types.dart';

void main() {
  test(
    'default API uses the canonical deployed origin and does not forward login redirects',
    () async {
      var requests = 0;
      final api = HttpWorkspaceApi(
        client: MockClient((request) async {
          requests++;
          expect(
            request.url.origin,
            'https://akij-dealership-sami.subscription-cellosc.chatgpt.site',
          );
          expect(request.followRedirects, false);
          return http.Response(
            '',
            307,
            headers: {'location': 'https://elsewhere.example/api/login'},
          );
        }),
      );
      await expectLater(
        api.request('POST', '/api/login', {
          'username': 'fixture',
          'password': 'fixture-only',
        }),
        throwsA(
          isA<AppFailure>().having(
            (e) => e.message,
            'message',
            'Unexpected service redirect.',
          ),
        ),
      );
      expect(requests, 1);
      api.close();
    },
  );
  test(
    'native API captures session cookie and sends protocol, origin and workspace epoch',
    () async {
      var count = 0;
      final api = HttpWorkspaceApi(
        client: MockClient((r) async {
          expect(r.headers['Origin'], 'https://test.example');
          expect(r.headers['X-Workspace-Protocol'], '2');
          if (count++ == 0) {
            expect(jsonDecode(r.body)['username'], 'test-user');
            return http.Response(
              '{"ok":true}',
              200,
              headers: {
                'set-cookie':
                    'arafat_session=opaque-session; HttpOnly; Secure; SameSite=Strict',
              },
            );
          }
          expect(r.headers['Cookie'], 'arafat_session=opaque-session');
          expect(r.headers['X-Workspace-Epoch'], '3');
          return http.Response('{"ok":true}', 200);
        }),
        origin: Uri.parse('https://test.example'),
      );
      await api.request('POST', '/api/login', {
        'username': 'test-user',
        'password': 'fixture-only',
      });
      expect(api.cookie, 'arafat_session=opaque-session');
      await api.request('POST', '/api/sync-akij', {}, {
        'X-Workspace-Epoch': '3',
      });
      api.close();
    },
  );
  test(
    'malformed or failed response is uncertain, validation error is definitive',
    () async {
      var status = 502;
      var body = '<html>proxy error</html>';
      final api = HttpWorkspaceApi(
        client: MockClient((_) async => http.Response(body, status)),
        origin: Uri.parse('https://test.example'),
      );
      await expectLater(
        api.request('POST', '/api/commands', {}),
        throwsA(predicate((e) => e is AppFailure && e.uncertain)),
      );
      body = '{"error":"Invalid amount"}';
      status = 400;
      await expectLater(
        api.request('POST', '/api/commands', {}),
        throwsA(
          predicate((e) => e is AppFailure && e.status == 400 && !e.uncertain),
        ),
      );
      api.close();
    },
  );
  test('a non-JSON 401 still invalidates the private session', () async {
    var expired = false;
    final api = SessionApi(
      HttpWorkspaceApi(
        client: MockClient(
          (_) async => http.Response('<html>expired</html>', 401),
        ),
        origin: Uri.parse('https://test.example'),
      ),
      onUnauthorized: () async {
        expired = true;
      },
    );
    await expectLater(
      api.request('GET', '/api/check-login'),
      throwsA(predicate((e) => e is AppFailure && e.status == 401)),
    );
    expect(expired, true);
    api.close();
  });
  test('an old request cannot expire a replacement session', () async {
    final response = Completer<http.Response>();
    var expired = false;
    final api = SessionApi(
      HttpWorkspaceApi(
        client: MockClient((_) => response.future),
        origin: Uri.parse('https://test.example'),
      ),
      onUnauthorized: () async {
        expired = true;
      },
    );
    api.cookie = 'old-cookie';
    final request = api.request('GET', '/api/check-login');
    api.cookie = 'new-cookie';
    response.complete(http.Response('{"error":"expired"}', 401));
    await expectLater(request, throwsA(isA<AppFailure>()));
    expect(expired, false);
    expect(api.cookie, 'new-cookie');
    api.close();
  });
  test('API rejects insecure or cross-origin paths', () async {
    final api = HttpWorkspaceApi(origin: Uri.parse('http://example.com'));
    await expectLater(
      api.request('GET', '/api/check-login'),
      throwsA(isA<AppFailure>()),
    );
    api.close();
    final secure = HttpWorkspaceApi();
    await expectLater(
      secure.request('GET', 'https://elsewhere.example/api/check-login'),
      throwsA(isA<AppFailure>()),
    );
    secure.close();
  });
}
