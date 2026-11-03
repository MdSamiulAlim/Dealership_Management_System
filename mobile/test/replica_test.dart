import 'package:flutter_test/flutter_test.dart';
import 'package:arafat_traders/core/replica.dart';
import 'package:arafat_traders/core/types.dart';
import 'support.dart';

void main() {
  test(
    '5000 rows load in pages and subsequent deltas update, insert and remove',
    () async {
      var pages = 0;
      final api = FakeApi((m, p, b) async {
        if (p.startsWith('/api/replica/start')) {
          return {
            'sync_revision': 0,
            'workspace_epoch': 2,
            'settings': {},
            'entities': ['sales'],
            'initial_page': {
              'groups': [],
              'done': false,
              'next': {'index': 0, 'after': ''},
            },
          };
        }
        final query = Uri.parse(p).queryParameters;
        if (p.startsWith('/api/replica/rows')) {
          pages++;
          final after = int.tryParse(query['after'] ?? '') ?? 0,
              stop = (after + 200).clamp(0, 5000);
          return {
            'rows': [
              for (var n = after; n < stop; n++)
                {
                  'id': n + 1,
                  'total_amount': n == 4500 ? 100 : 1,
                  'notes': n == 4500 ? 'x' * 200000 : '',
                },
            ],
            'done': stop == 5000,
            'next_cursor': '$stop',
          };
        }
        return {
          'changes': [
            {
              'entity': 'sales',
              'record_id': 1,
              'data': {'id': 1, 'total_amount': 7},
            },
            {'entity': 'sales', 'record_id': 2, 'data': null},
            {
              'entity': 'sales',
              'record_id': 5001,
              'data': {'id': 5001, 'total_amount': 9},
            },
          ],
          'next_revision': 3,
          'has_more': false,
        };
      });
      final result = await Replica(api).initial({'username': 'Samiul'});
      expect(pages, 25);
      expect(rows(result, 'sales').length, 5000);
      expect(rows(result, 'sales').first['total_amount'], 7);
      expect(rows(result, 'sales').any((r) => r['id'] == 2), false);
      expect(result['sync_revision'], 3);
      expect(
        text(
          rows(result, 'sales').firstWhere((r) => r['id'] == 4501)['notes'],
        ).length,
        200000,
      );
    },
  );
  test(
    'invoice row replacement retains items and item tombstones remove them',
    () {
      final base = fixture();
      base['invoices'] = [
        {
          'id': 'i',
          'items': [
            {'id': 'item', 'invoice_id': 'i'},
          ],
        },
      ];
      final mutable = clone(base);
      Replica(FakeApi((m, p, b) async => {})).apply(mutable, [
        {
          'entity': 'invoices',
          'record_id': 'i',
          'data': {'id': 'i', 'invoice_no': 'CUSTOM-1'},
        },
        {'entity': 'invoice_items', 'record_id': 'item', 'data': null},
      ]);
      expect(mutable['invoices'][0]['invoice_no'], 'CUSTOM-1');
      expect(mutable['invoices'][0]['items'], isEmpty);
    },
  );
}
