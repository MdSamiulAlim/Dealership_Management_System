import 'dart:convert';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../core/types.dart';
import '../core/documents.dart';
import '../widgets/common.dart';
import 'record_editor.dart';

Future<String?> askPassword(BuildContext c, {required String title}) async {
  final control = TextEditingController(), form = GlobalKey<FormState>();
  final result = await showDialog<String>(
    context: c,
    builder: (d) => AlertDialog(
      title: Text(title),
      content: Form(
        key: form,
        child: PasswordField(
          controller: control,
          label: c.t('Password', 'পাসওয়ার্ড'),
          autofocus: true,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(d),
          child: Text(c.t('Cancel', 'বাতিল')),
        ),
        FilledButton(
          onPressed: () {
            if (form.currentState!.validate()) Navigator.pop(d, control.text);
          },
          child: Text(c.t('Continue', 'চালিয়ে যান')),
        ),
      ],
    ),
  );
  // Dispose after the dialog route has released its text field.
  Future<void>.delayed(const Duration(milliseconds: 300), control.dispose);
  return result;
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});
  Future<void> restore(BuildContext c) async {
    final store = c.w;
    if (store.pending > 0) {
      toast(
        c,
        c.t(
          'Sync or export pending work before restoring.',
          'রিস্টোরের আগে অপেক্ষমাণ কাজ Sync বা Export করুন।',
        ),
      );
      return;
    }
    await runAction(c, () async {
      final files = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['json'],
      );
      if (files.isEmpty) return;
      final size = await files.first.length();
      if (size == null || size > 50 * 1024 * 1024) {
        throw const AppFailure('Backup exceeds 50 MB.');
      }
      final bytes = await files.first.readAsBytes();
      if (!c.mounted) return;
      if (!await confirm(
        c,
        title: c.t(
          'Restore encrypted backup?',
          'এনক্রিপ্ট করা ব্যাকআপ রিস্টোর করবেন?',
        ),
        message: c.t(
          'Current device records will be replaced. Server records are unchanged; pending operations retain their IDs.',
          'এই ডিভাইসের হিসাব প্রতিস্থাপন হবে। সার্ভারের তথ্য অপরিবর্তিত থাকবে; অপেক্ষমাণ কাজের ID অক্ষুণ্ণ থাকবে।',
        ),
      )) {
        return;
      }
      if (!c.mounted) return;
      final password = await askPassword(
        c,
        title: c.t('Backup password', 'ব্যাকআপের পাসওয়ার্ড'),
      );
      if (password == null) return;
      await store.restoreDevice(utf8.decode(bytes), password);
      if (c.mounted) {
        toast(
          c,
          c.t(
            'Backup restored. Check Sync status.',
            'ব্যাকআপ রিস্টোর হয়েছে। Sync-এর অবস্থা দেখুন।',
          ),
        );
      }
    });
  }

  Future<void> reset(BuildContext c) async {
    final store = c.w, control = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: c,
      builder: (d) => AlertDialog(
        title: Text(c.t('Reset all business data', 'সব হিসাব রিসেট')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                c.t(
                  'Sales, customers, payments, orders, expenses and stock balances will reset. Product lists and prices remain. Audit history remains.',
                  'বিক্রি, কাস্টমার, আদায়, অর্ডার, খরচ ও মজুতের হিসাব মুছে যাবে। পণ্যের তালিকা, দর ও অডিট ইতিহাস থাকবে।',
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: control,
                decoration: InputDecoration(
                  labelText: c.t('Type RESET ALL DATA', 'RESET ALL DATA লিখুন'),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(d, false),
            child: Text(c.t('Cancel', 'বাতিল')),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(d).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(d, true),
            child: Text(c.t('Reset data', 'হিসাব রিসেট')),
          ),
        ],
      ),
    );
    final phrase = control.text;
    Future<void>.delayed(const Duration(milliseconds: 300), control.dispose);
    if (confirmed == true && c.mounted) {
      await runAction(
        c,
        () => store.reset(phrase),
        success: c.t(
          'Business data reset. Product catalog retained.',
          'হিসাব রিসেট হয়েছে। পণ্যের তালিকা রাখা হয়েছে।',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext c) {
    final store = c.w, settings = object(store.view['settings'] ?? {});
    return PageBody(
      children: [
        SectionTitle(c.t('Settings & backup', 'সেটিংস ও ব্যাকআপ')),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Image.asset(
                      'assets/brand/arafat-growth-logo.png',
                      width: 70,
                      height: 70,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            text(settings['name'] ?? 'Arafat Traders'),
                            style: Theme.of(c).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            text(settings['phone'] ?? '+8801646130402'),
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          Text(
                            c.t(
                              'Business owner: Arafat',
                              'ব্যবসার মালিক: আরাফাত',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                if (text(settings['address']).isNotEmpty)
                  Text(text(settings['address'])),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => page(
                    c,
                    RecordEditor(entity: 'settings', initial: clone(settings)),
                  ),
                  icon: const Icon(Icons.store_outlined),
                  label: Text(
                    c.t('Edit business details', 'ব্যবসার তথ্য সম্পাদনা'),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  initialValue: store.language,
                  decoration: InputDecoration(
                    labelText: c.t('Language', 'ভাষা'),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'bn', child: Text('বাংলা')),
                    DropdownMenuItem(value: 'en', child: Text('English')),
                  ],
                  onChanged: (v) {
                    if (v != null) store.setLanguage(v);
                  },
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  c.t('Offline & sync', 'Offline ও Sync'),
                  style: Theme.of(c).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                Text(
                  store.offlineReady
                      ? c.t(
                          'Password-protected offline access is enabled on this device.',
                          'এই ডিভাইসে পাসওয়ার্ড দিয়ে Offline প্রবেশ চালু আছে.',
                        )
                      : c.t(
                          'Enable password-protected offline access after logging in online.',
                          'অনলাইনে লগইন করে পাসওয়ার্ড দিয়ে Offline চালু করুন।',
                        ),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () async {
                    final password = await askPassword(
                      c,
                      title: c.t(
                        'Verify your login password',
                        'আপনার লগইন পাসওয়ার্ড দিন',
                      ),
                    );
                    if (password != null && c.mounted) {
                      await runAction(
                        c,
                        () => store.enableOffline(password),
                        success: c.t(
                          'Offline access is ready.',
                          'Offline ব্যবহার প্রস্তুত।',
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.lock_outline),
                  label: Text(
                    c.t(
                      'Enable / update Offline password',
                      'Offline পাসওয়ার্ড চালু / আপডেট',
                    ),
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: store.syncing
                      ? null
                      : () => runAction(c, () => store.sync()),
                  icon: const Icon(Icons.sync),
                  label: Text(c.t('Sync now', 'এখন Sync করুন')),
                ),
                OutlinedButton.icon(
                  onPressed: store.online && !store.syncing
                      ? () => runAction(c, store.syncCodes)
                      : null,
                  icon: const Icon(Icons.inventory_2_outlined),
                  label: Text(
                    c.t('Sync product codes', 'পণ্যের কোড Sync করুন'),
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: () => page(c, const QueueScreen()),
                  icon: Badge(
                    label: Text('${store.pending}'),
                    isLabelVisible: store.pending > 0,
                    child: const Icon(Icons.pending_actions),
                  ),
                  label: Text(
                    c.t('Review pending work', 'অপেক্ষমাণ কাজ দেখুন'),
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: store.offlineReady && !store.syncing
                      ? () => runAction(c, () async => store.lock())
                      : null,
                  icon: const Icon(Icons.lock),
                  label: Text(c.t('Lock app', 'অ্যাপ লক করুন')),
                ),
              ],
            ),
          ),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  c.t(
                    'Encrypted device backup',
                    'ডিভাইসের এনক্রিপ্ট করা ব্যাকআপ',
                  ),
                  style: Theme.of(c).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                Text(
                  c.t(
                    'Includes device records and pending operation IDs. Import also accepts the previous app’s encrypted JSON export.',
                    'ডিভাইসের হিসাব ও অপেক্ষমাণ কাজের ID থাকে। আগের অ্যাপের এনক্রিপ্ট করা JSON ব্যাকআপও Import করা যায়।',
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton.tonalIcon(
                  onPressed: () => runAction(c, () async {
                    final source = await store.exportDevice();
                    await Documents.saveJson(
                      'Arafat-Device-${today()}.json',
                      source,
                    );
                  }),
                  icon: const Icon(Icons.download),
                  label: Text(
                    c.t(
                      'Export encrypted backup',
                      'এনক্রিপ্ট করা ব্যাকআপ Export',
                    ),
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: () => restore(c),
                  icon: const Icon(Icons.upload_file),
                  label: Text(
                    c.t('Import / restore backup', 'ব্যাকআপ Import / রিস্টোর'),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (store.admin) ...[
          const SizedBox(height: 18),
          SectionTitle(c.t('Admin tools', 'অ্যাডমিনের সুবিধা')),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.history),
                  title: Text(
                    c.t('Financial audit trail', 'লেনদেনের অডিট ইতিহাস'),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => page(c, const OperationsScreen(audit: true)),
                ),
                ListTile(
                  leading: const Icon(Icons.cloud_outlined),
                  title: Text(
                    c.t(
                      'Cloud backups & monitoring',
                      'ক্লাউড ব্যাকআপ ও পর্যবেক্ষণ',
                    ),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => page(c, const OperationsScreen()),
                ),
                ListTile(
                  leading: Icon(
                    Icons.delete_forever,
                    color: Theme.of(c).colorScheme.error,
                  ),
                  title: Text(c.t('Reset all business data', 'সব হিসাব রিসেট')),
                  subtitle: Text(
                    store.resetting
                        ? c.t('Reset is in progress…', 'রিসেট চলছে…')
                        : c.t(
                            'Product catalog is retained',
                            'পণ্যের তালিকা থাকবে',
                          ),
                  ),
                  onTap: store.resetting ? null : () => reset(c),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        ExpansionTile(
          title: Text(c.t('Archived products', 'পুরোনো পণ্য')),
          children: [
            for (final p in rows(store.view, 'archived_products'))
              ListTile(
                title: Text(text(p['name'])),
                subtitle: Text(
                  '${p['product_code']} · ${c.qty(p['current_stock'])} ${c.t('bags', 'বস্তা')}',
                ),
              ),
          ],
        ),
        const SizedBox(height: 18),
        Center(
          child: SvgPicture.asset(
            'assets/brand/akij-feed-logo.svg',
            width: 100,
            height: 45,
          ),
        ),
        const SizedBox(height: 12),
        Center(
          child: Text(
            c.t(
              'Arafat Traders · Flutter 3.0.3',
              'আরাফাত ট্রেডার্স · Flutter 3.0.3',
            ),
          ),
        ),
      ],
    );
  }
}

class QueueScreen extends StatelessWidget {
  const QueueScreen({super.key});
  @override
  Widget build(BuildContext c) => Scaffold(
    appBar: AppBar(title: Text(c.t('Pending work', 'অপেক্ষমাণ কাজ'))),
    body: PageBody(
      children: [
        Text(
          c.t(
            'The original operation ID is kept for every retry. A pending save may already exist on the server; Sync safely checks it.',
            'প্রতিবার Retry-তে মূল operation ID রাখা হয়। অপেক্ষমাণ হিসাব সার্ভারে সেভ হয়ে থাকতে পারে; Sync নিরাপদে যাচাই করে।',
          ),
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: c.w.syncing ? null : () => runAction(c, () => c.w.sync()),
          icon: const Icon(Icons.sync),
          label: Text(c.t('Sync now', 'এখন Sync করুন')),
        ),
        if (c.w.queue.isEmpty)
          EmptyState(
            title: c.t('No pending work', 'অপেক্ষমাণ কাজ নেই'),
            message: c.t(
              'Your device is up to date.',
              'আপনার ডিভাইসের হিসাব হালনাগাদ।',
            ),
          ),
        for (final op in c.w.queue)
          Card(
            child: ExpansionTile(
              title: Text('${op['method']} ${op['path']}'),
              subtitle: Text(
                op['error'] != null
                    ? errorMessage(c, AppFailure(text(op['error'])))
                    : c.t('Waiting to sync', 'Sync-এর অপেক্ষায়'),
              ),
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      SelectableText('ID: ${op['id']}'),
                      const SizedBox(height: 8),
                      SelectableText(
                        const JsonEncoder.withIndent(
                          '  ',
                        ).convert(op['payload']),
                      ),
                      Wrap(
                        spacing: 8,
                        children: [
                          OutlinedButton.icon(
                            onPressed: () =>
                                runAction(c, () => c.w.retry(text(op['id']))),
                            icon: const Icon(Icons.sync),
                            label: Text(c.t('Retry safely', 'নিরাপদে Retry')),
                          ),
                          if (op['rejected'] == true || op['sent'] != true)
                            OutlinedButton.icon(
                              onPressed: () async {
                                if (await confirm(
                                      c,
                                      title: c.t(
                                        'Remove failed action?',
                                        'ব্যর্থ কাজটি বাদ দেবেন?',
                                      ),
                                      message: c.t(
                                        'You can reapply the change after refreshing the latest records.',
                                        'সর্বশেষ হিসাব Sync করে পরিবর্তনটি আবার করতে পারবেন।',
                                      ),
                                    ) &&
                                    c.mounted) {
                                  await runAction(
                                    c,
                                    () => c.w.discard(text(op['id'])),
                                  );
                                }
                              },
                              icon: const Icon(Icons.delete_outline),
                              label: Text(c.t('Remove', 'বাদ দিন')),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    ),
  );
}

class OperationsScreen extends StatefulWidget {
  const OperationsScreen({super.key, this.audit = false});
  final bool audit;
  @override
  State<OperationsScreen> createState() => _OperationsScreenState();
}

class _OperationsScreenState extends State<OperationsScreen> {
  Json? data;
  String? failure;
  bool busy = false, started = false;
  dynamic cursor;
  Future<void> load({bool more = false}) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final path = widget.audit
          ? '/api/admin/audit${more && cursor != null ? '?before=$cursor' : ''}'
          : '/api/admin/operations';
      final result = await context.w.api.request('GET', path);
      if (mounted) {
        setState(() {
          if (more && data != null) {
            data!['rows'] = [...rows(data!, 'rows'), ...rows(result, 'rows')];
          } else {
            data = result;
          }
          cursor = result['next_cursor'];
          failure = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => failure = errorMessage(context, e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!started) {
      started = true;
      Future.microtask(load);
    }
  }

  @override
  Widget build(BuildContext c) {
    if (!c.w.admin) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(child: Text(c.t('Admin only', 'শুধু অ্যাডমিন'))),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.audit
              ? c.t('Audit trail', 'অডিট ইতিহাস')
              : c.t('Cloud backups', 'ক্লাউড ব্যাকআপ'),
        ),
        actions: [
          IconButton(
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: PageBody(
        children: [
          if (busy) const LinearProgressIndicator(),
          if (failure != null)
            Text(
              failure!,
              style: TextStyle(color: Theme.of(c).colorScheme.error),
            ),
          if (widget.audit) ...[
            for (final event in rows(data ?? {}, 'rows'))
              Card(
                child: ExpansionTile(
                  title: Text('#${event['seq']} · ${event['actor']}'),
                  subtitle: Text(
                    '${event['action']} ${event['entity']} · ${event['created_at']}',
                  ),
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            c.t('Before', 'আগে'),
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                          SelectableText(text(event['before_json'])),
                          const SizedBox(height: 14),
                          Text(
                            c.t('After', 'পরে'),
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                          SelectableText(text(event['after_json'])),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            if (cursor != null)
              OutlinedButton(
                onPressed: busy ? null : () => load(more: true),
                child: Text(c.t('Load older events', 'আগের ইতিহাস দেখুন')),
              ),
          ] else ...[
            Text(
              c.t(
                'Private cloud storage. External alerts are off.',
                'ব্যক্তিগত ক্লাউড স্টোরেজ। বাইরের সতর্কবার্তা বন্ধ।',
              ),
            ),
            const SizedBox(height: 12),
            if (data != null)
              Text(
                '${c.t('Database', 'ডেটাবেস')}: ${data!['database']} · ${c.t('Schedule registered', 'সময়সূচি সংরক্ষিত')}: ${data!['automatic_backups'] == true ? c.t('Yes', 'হ্যাঁ') : c.t('No', 'না')}',
              ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: busy
                  ? null
                  : () => runAction(c, () async {
                      await c.w.api.request(
                        'POST',
                        '/api/admin/backups/daily',
                        {},
                      );
                      await load();
                    }),
              icon: const Icon(Icons.cloud_upload_outlined),
              label: Text(
                c.t(
                  'Run verified daily backup',
                  'আজকের যাচাইকৃত ব্যাকআপ চালান',
                ),
              ),
            ),
            for (final backup in rows(data ?? {}, 'backups'))
              Card(
                child: ListTile(
                  title: Text(text(backup['created_at'])),
                  subtitle: Text(
                    '${(number(backup['bytes']) / 1024).toStringAsFixed(1)} KB · ${backup['actor']}',
                  ),
                  trailing: IconButton(
                    tooltip: c.t('Download backup', 'ব্যাকআপ নামান'),
                    icon: const Icon(Icons.download),
                    onPressed: () => runAction(c, () async {
                      final bytes = await c.w.api.download(
                        '/api/admin/backups/${backup['id']}',
                      );
                      await Documents.saveBytes(
                        'Arafat-Cloud-${backup['id']}.json',
                        bytes,
                        extension: 'json',
                      );
                    }),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
