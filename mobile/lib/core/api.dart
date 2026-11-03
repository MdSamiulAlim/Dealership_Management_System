import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'types.dart';

abstract class WorkspaceApi {
  String? cookie;
  Future<Json> request(
    String method,
    String path, [
    Json? payload,
    Map<String, String>? headers,
  ]);
  Future<Uint8List> download(String path);
  void close();
}

class HttpWorkspaceApi implements WorkspaceApi {
  HttpWorkspaceApi({http.Client? client, Uri? origin})
    : _client = client ?? http.Client(),
      origin =
          origin ??
          Uri.parse(
            const String.fromEnvironment(
              'API_ORIGIN',
              defaultValue:
                  'https://akij-dealership-sami.subscription-cellosc.chatgpt.site',
            ),
          );
  final http.Client _client;
  final Uri origin;
  @override
  String? cookie;
  Future<http.Response> _send(
    String method,
    String path, [
    Json? payload,
    Map<String, String>? headers,
  ]) async {
    if (!path.startsWith('/api/') ||
        path.startsWith('//') ||
        (origin.scheme != 'https' &&
            origin.host != '127.0.0.1' &&
            origin.host != 'localhost')) {
      throw const AppFailure('Invalid service address.');
    }
    final uri = origin.resolve(path);
    if (uri.host != origin.host ||
        uri.port != origin.port ||
        uri.scheme != origin.scheme) {
      throw const AppFailure('Invalid service address.');
    }
    final request = http.Request(method, uri)..followRedirects = false;
    request.headers.addAll({
      'Content-Type': 'application/json',
      'Origin': origin.origin,
      'Accept': 'application/json',
      'X-Workspace-Protocol': '2',
      'Cookie': ?cookie,
    });
    if (headers != null) request.headers.addAll(headers);
    if (payload != null) request.body = jsonEncode(payload);
    try {
      final response = await http.Response.fromStream(
        await _client.send(request).timeout(const Duration(seconds: 25)),
      ).timeout(const Duration(seconds: 40));
      final session = response.headers['set-cookie'];
      if (session != null) {
        final match = RegExp(
          r'(?:^|,)\s*(arafat_session=[^;,\s]+)',
        ).firstMatch(session);
        if (match != null) cookie = match.group(1);
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw const AppFailure('Unexpected service redirect.');
      }
      return response;
    } on AppFailure {
      rethrow;
    } catch (_) {
      throw const AppFailure(
        'Connection unavailable. Saved work remains on this device.',
        uncertain: true,
      );
    }
  }

  @override
  Future<Json> request(
    String method,
    String path, [
    Json? payload,
    Map<String, String>? headers,
  ]) async {
    final response = await _send(method, path, payload, headers);
    Json value;
    try {
      value = object(jsonDecode(utf8.decode(response.bodyBytes)));
    } catch (_) {
      if (response.statusCode == 401) {
        throw const AppFailure('Log in to continue.', status: 401);
      }
      throw const AppFailure('Unexpected server response.', uncertain: true);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AppFailure(
        text(value['error']).isEmpty ? 'Request failed.' : text(value['error']),
        status: response.statusCode,
        uncertain: response.statusCode >= 500,
      );
    }
    return value;
  }

  @override
  Future<Uint8List> download(String path) async {
    final response = await _send('GET', path);
    if (response.statusCode != 200) {
      throw AppFailure(
        'Document download failed.',
        status: response.statusCode,
        uncertain: response.statusCode >= 500,
      );
    }
    return response.bodyBytes;
  }

  @override
  void close() => _client.close();
}

// Apply the same session boundary to requests made by screens and background Sync.
class SessionApi implements WorkspaceApi {
  SessionApi(this.delegate, {required this.onUnauthorized});
  final WorkspaceApi delegate;
  final Future<void> Function() onUnauthorized;
  @override
  String? get cookie => delegate.cookie;
  @override
  set cookie(String? value) => delegate.cookie = value;
  Future<T> _guard<T>(String path, Future<T> Function() request) async {
    final requestCookie = delegate.cookie;
    try {
      return await request();
    } on AppFailure catch (e) {
      if (e.status == 401 &&
          path != '/api/login' &&
          delegate.cookie == requestCookie) {
        await onUnauthorized();
      }
      rethrow;
    }
  }

  @override
  Future<Json> request(
    String method,
    String path, [
    Json? payload,
    Map<String, String>? headers,
  ]) => _guard(path, () => delegate.request(method, path, payload, headers));
  @override
  Future<Uint8List> download(String path) =>
      _guard(path, () => delegate.download(path));
  @override
  void close() => delegate.close();
}
