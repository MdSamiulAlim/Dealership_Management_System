import 'api.dart';
import 'types.dart';

class Replica {
  Replica(this.api);
  final WorkspaceApi api;
  void _upsert(List<dynamic> list, dynamic id, Json? row) {
    final index = list.indexWhere((v) => same(v['id'], id));
    if (index >= 0) {
      if (row == null) {
        list.removeAt(index);
      } else {
        list[index] = row;
      }
    } else if (row != null) {
      list.add(row);
    }
  }

  void apply(Json base, List<Json> changes) {
    for (final event in changes) {
      final entity = text(event['entity']), id = event['record_id'];
      final row = event['data'] == null ? null : object(event['data']);
      if (entity == 'app_meta') {
        if (row?['key'] == 'business_settings_v1') {
          base['settings'] = jsonObject(text(row!['value']));
        }
        continue;
      }
      if (entity == 'products') {
        _upsert(base['products'], id, null);
        _upsert(base['archived_products'], id, null);
        if (row != null) {
          (base[flag(row['archived']) ? 'archived_products' : 'products']
                  as List)
              .add(row);
        }
      } else if (entity == 'invoice_items') {
        for (final invoice in base['invoices']) {
          invoice['items'] ??= [];
          _upsert(invoice['items'], id, null);
        }
        if (row != null) {
          for (final invoice in base['invoices']) {
            if (same(invoice['id'], row['invoice_id'])) {
              (invoice['items'] as List).add(row);
            }
          }
        }
      } else {
        final name = tableNames[entity] ?? entity;
        if (!collections.contains(name)) continue;
        if (entity == 'invoices' && row != null) {
          final old = (base['invoices'] as List).where(
            (v) => same(v['id'], id),
          );
          row['items'] = old.isEmpty ? [] : old.first['items'] ?? [];
        }
        _upsert(base[name], id, row);
      }
    }
  }

  Future<Json> pull(Json base) async {
    if (base['sync_revision'] == null) return initial(object(base['user']));
    final next = clone(base);
    while (true) {
      final page = await api.request(
        'GET',
        '/api/replica/changes?after=${next['sync_revision']}&epoch=${next['workspace_epoch'] ?? 0}',
      );
      apply(next, rows(page, 'changes'));
      next['sync_revision'] = page['next_revision'];
      next['server_time'] = page['server_time'];
      if (page['has_more'] != true) return next;
    }
  }

  Future<Json> initial(Json user, {void Function(int)? progress}) async {
    final start = await api.request('GET', '/api/replica/start?packed=1');
    final base = {
      ...start,
      'user': user,
      'reports': <String, dynamic>{},
      'dashboard': <String, dynamic>{},
    };
    base.remove('initial_page');
    for (final name in collections) {
      base[name] = <dynamic>[];
    }
    final items = <Json>[];
    var count = 0;
    void collect(String entity, List<Json> records) {
      if (entity == 'invoice_items') {
        items.addAll(records);
      } else if (entity == 'products') {
        for (final row in records) {
          (base[flag(row['archived']) ? 'archived_products' : 'products']
                  as List)
              .add(row);
        }
      } else {
        (base[tableNames[entity] ?? entity] as List).addAll(
          records.map(
            (row) =>
                entity == 'invoices' ? {...row, 'items': <dynamic>[]} : row,
          ),
        );
      }
      count += records.length;
      progress?.call(count);
    }

    final page = start['initial_page'] == null
        ? null
        : object(start['initial_page']);
    if (page != null) {
      for (final group in rows(page, 'groups')) {
        collect(text(group['entity']), rows(group, 'rows'));
      }
    }
    if (page == null || page['done'] != true) {
      final cursor = page?['next'] == null ? null : object(page!['next']);
      final entities = (start['entities'] as List).cast<String>();
      final offset = (number(cursor?['index'])).toInt();
      var position = offset;
      await Future.wait(
        List.generate((entities.length - offset).clamp(0, 4), (_) async {
          while (position < entities.length) {
            final index = position++, entity = entities[index];
            var after = index == offset ? text(cursor?['after']) : '';
            while (true) {
              final result = await api.request(
                'GET',
                '/api/replica/rows?entity=$entity&after=${Uri.encodeQueryComponent(after)}&epoch=${base['workspace_epoch'] ?? 0}',
              );
              collect(entity, rows(result, 'rows'));
              if (result['done'] == true) break;
              after = text(result['next_cursor']);
            }
          }
        }),
      );
    }
    final byInvoice = {
      for (final invoice in base['invoices'] as List)
        text(invoice['id']): invoice,
    };
    for (final item in items) {
      (byInvoice[text(item['invoice_id'])]?['items'] as List?)?.add(item);
    }
    return pull(base);
  }
}
