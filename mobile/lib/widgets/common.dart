import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../core/types.dart';
import '../core/workspace.dart';

class WorkspaceScope extends InheritedNotifier<Workspace> {
  const WorkspaceScope({
    super.key,
    required Workspace workspace,
    required super.child,
  }) : super(notifier: workspace);
  static Workspace of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<WorkspaceScope>()!.notifier!;
}

extension WorkspaceContext on BuildContext {
  Workspace get w => WorkspaceScope.of(this);
  String t(String en, String bn) => w.tr(en, bn);
  String cash(dynamic value) => NumberFormat.currency(
    locale: w.language == 'bn' ? 'bn_BD' : 'en_BD',
    symbol: '৳',
    decimalDigits: 2,
  ).format(number(value));
  String qty(dynamic value) => NumberFormat(
    '#,##0.##',
    w.language == 'bn' ? 'bn_BD' : 'en_BD',
  ).format(number(value));
}

String errorMessage(BuildContext context, Object error) {
  final message = error is AppFailure
      ? error.message
      : error is StateError
      ? text(error.message)
      : 'Could not complete this action. Please try again.';
  const translations = {
    'Confirm the stock change first.': 'আগে মজুত পরিবর্তন নিশ্চিত করুন।',
    'Enter a stock adjustment reason.': 'মজুত সমন্বয়ের কারণ লিখুন।',
    'Reload the complete transfer before editing.':
        'সম্পাদনার আগে স্থানান্তরের সম্পূর্ণ তথ্য Sync করুন।',
    'Transfer changed on another device. Refresh first.':
        'অন্য ডিভাইসে স্থানান্তরের তথ্য বদলেছে। আগে Sync করুন।',
    'Confirm the transfer edit. Keep it as Cash to Bank or Bank to Cash.':
        'স্থানান্তর সম্পাদনা নিশ্চিত করুন। ক্যাশ থেকে ব্যাংক বা ব্যাংক থেকে ক্যাশ রাখুন।',
    'Create a new transfer instead of changing a single transaction into a transfer.':
        'একটি লেনদেনকে স্থানান্তর না বানিয়ে নতুন স্থানান্তর তৈরি করুন।',
    'Enter a valid amount or quantity.': 'সঠিক টাকা বা পরিমাণ দিন।',
    'Invoice subtotal cannot exceed 1,000,000,000,000.':
        'ইনভয়েসের মোট ১,০০০,০০০,০০০,০০০ টাকার বেশি হতে পারবে না।',
    'Total must match the calculated quantity and rate.':
        'মোট টাকার পরিমাণ দর ও পরিমাণের হিসাবের সঙ্গে মিলতে হবে।',
    'Quantity must be a whole number.': 'পরিমাণ পূর্ণ সংখ্যা হতে হবে।',
    'Rate cannot be negative.': 'দর ঋণাত্মক হতে পারবে না।',
    'Incorrect User ID or password.': 'ইউজার আইডি অথবা পাসওয়ার্ড সঠিক নয়।',
    'Incorrect password or damaged device backup.':
        'পাসওয়ার্ড ভুল অথবা ডিভাইসের ব্যাকআপ ক্ষতিগ্রস্ত।',
    'Check the discount and paid amount.':
        'ছাড় ও পরিশোধের পরিমাণ পরীক্ষা করুন।',
    'Insufficient stock. Refresh stock and reduce the quantity before saving.':
        'পর্যাপ্ত মজুত নেই। মজুত Sync করে বিক্রির পরিমাণ কমান।',
    'Connection unavailable. Saved work remains on this device.':
        'সংযোগ পাওয়া যাচ্ছে না। সেভ করা কাজ এই ডিভাইসে আছে।',
    'Save status is pending. Sync to safely check and retry.':
        'সেভের ফল নিশ্চিত হয়নি। নিরাপদে যাচাই করতে Sync করুন।',
    'This invoice number is already in use. Choose another number.':
        'এই ইনভয়েস নম্বর ব্যবহার হয়েছে। অন্য নম্বর দিন।',
    'Keep the invoice number within 100 characters on one line.':
        'ইনভয়েস নম্বর এক লাইনে ১০০ অক্ষরের মধ্যে রাখুন।',
    'Log in to continue.': 'চালিয়ে যেতে লগইন করুন।',
    'Could not complete this action. Please try again.':
        'কাজটি শেষ হয়নি। আবার চেষ্টা করুন।',
    'Could not complete the request. Please try again.':
        'কাজটি শেষ হয়নি। আবার চেষ্টা করুন।',
    'Sync pending work before logging out.':
        'লগআউটের আগে অপেক্ষমাণ কাজ Sync করুন।',
    'Sync pending work before switching accounts.':
        'অ্যাকাউন্ট বদলানোর আগে অপেক্ষমাণ কাজ Sync করুন।',
    'This record has transactions and cannot be deleted. Keep it for the account history.':
        'এই রেকর্ডে লেনদেন আছে। হিসাবের ইতিহাস রাখতে এটি মোছা যাবে না।',
    'Returned or cancelled invoices cannot be edited.':
        'ফেরত নেওয়া বা বাতিল ইনভয়েস পরিবর্তন করা যাবে না।',
    'Return quantity exceeds the remaining quantity.':
        'ফেরতের পরিমাণ অবশিষ্ট পরিমাণের বেশি।',
    'Choose Cash or Bank.': 'ক্যাশ অথবা ব্যাংক নির্বাচন করুন।',
    'Enter a positive amount.': 'শূন্যের বেশি পরিমাণ দিন।',
    'This save is too large. Shorten the note and try again.':
        'তথ্যের আকার অনেক বড়। নোট ছোট করে আবার সেভ করুন।',
    'Only the Admin can reset all app data.':
        'শুধু অ্যাডমিন অ্যাপের সব হিসাব রিসেট করতে পারবেন।',
    'Sync pending work before resetting.':
        'রিসেটের আগে অপেক্ষমাণ কাজ Sync করুন।',
    'Type RESET ALL DATA to confirm.': 'নিশ্চিত করতে RESET ALL DATA লিখুন।',
    'Sync or export pending work before restoring.':
        'রিস্টোরের আগে অপেক্ষমাণ কাজ Sync অথবা Export করুন।',
    'Backup belongs to a different account.': 'ব্যাকআপটি অন্য অ্যাকাউন্টের।',
    'Unsupported backup format.': 'এই ধরনের ব্যাকআপ সমর্থিত নয়।',
    'Invalid device backup.': 'ডিভাইস ব্যাকআপ সঠিক নয়।',
    'Enable password-protected Offline mode before exporting.':
        'Export-এর আগে পাসওয়ার্ড দিয়ে Offline চালু করুন।',
    'Enable Offline on this device after logging in online.':
        'অনলাইনে লগইন করে এই ডিভাইসে Offline চালু করুন।',
    'Connect once to load your records.':
        'হিসাব লোড করতে একবার ইন্টারনেট সংযোগ দিন।',
    'Document download failed.': 'ডকুমেন্ট ডাউনলোড হয়নি।',
  };
  return context.w.language == 'bn'
      ? (translations[message] ?? message)
      : message;
}

void toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
  );
}

Future<T?> page<T>(BuildContext context, Widget child, {String? title}) =>
    Navigator.of(context).push<T>(
      MaterialPageRoute(
        builder: (_) => title == null
            ? child
            : Scaffold(
                appBar: AppBar(title: Text(title)),
                body: child,
              ),
      ),
    );
Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String message,
  bool destructive = false,
}) async =>
    await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: Text(context.t('Cancel', 'বাতিল')),
          ),
          FilledButton(
            style: destructive
                ? FilledButton.styleFrom(
                    backgroundColor: Theme.of(c).colorScheme.error,
                  )
                : null,
            onPressed: () => Navigator.pop(c, true),
            child: Text(context.t('Confirm', 'নিশ্চিত করুন')),
          ),
        ],
      ),
    ) ??
    false;
Future<void> runAction(
  BuildContext context,
  Future<void> Function() action, {
  String? success,
}) async {
  try {
    await action();
    if (context.mounted && success != null) toast(context, success);
  } catch (e) {
    if (context.mounted) toast(context, errorMessage(context, e));
  }
}

class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children, this.onRefresh});
  final List<Widget> children;
  final Future<void> Function()? onRefresh;
  @override
  Widget build(BuildContext context) {
    final list = ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
      physics: const AlwaysScrollableScrollPhysics(),
      children: children,
    );
    return onRefresh == null
        ? list
        : RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.subtitle, this.action});
  final String title;
  final String? subtitle;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (subtitle != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    subtitle!,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
            ],
          ),
        ),
        ?action,
      ],
    ),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    required this.message,
    this.action,
    this.icon = Icons.inbox_outlined,
  });
  final String title, message;
  final Widget? action;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        children: [
          Icon(icon, size: 48, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 12),
          Text(
            title,
            style: Theme.of(context).textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center),
          if (action != null)
            Padding(padding: const EdgeInsets.only(top: 16), child: action!),
        ],
      ),
    ),
  );
}

class Metric extends StatelessWidget {
  const Metric({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.strong = false,
    this.onTap,
  });
  final String label, value;
  final IconData icon;
  final bool strong;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Card(
      color: strong ? colors.primaryContainer : null,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: colors.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      label,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  value,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SearchField extends StatelessWidget {
  const SearchField({super.key, required this.hint, required this.onChanged});
  final String hint;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextField(
      key: key,
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.search_rounded),
      ),
      onChanged: onChanged,
    ),
  );
}

class DateField extends StatelessWidget {
  const DateField({
    super.key,
    required this.controller,
    required this.label,
    this.optional = false,
  });
  final TextEditingController controller;
  final String label;
  final bool optional;
  @override
  Widget build(BuildContext context) => TextFormField(
    controller: controller,
    readOnly: true,
    decoration: InputDecoration(
      labelText: label,
      suffixIcon: const Icon(Icons.calendar_today_outlined),
    ),
    onTap: () async {
      final picked = await showDatePicker(
        context: context,
        initialDate: DateTime.tryParse(controller.text) ?? DateTime.now(),
        firstDate: DateTime(2000),
        lastDate: DateTime(2100),
      );
      if (picked != null) {
        controller.text = DateFormat('yyyy-MM-dd', 'en').format(picked);
      }
    },
    validator: (value) => optional && (value == null || value.isEmpty)
        ? null
        : value == null || DateTime.tryParse(value) == null
        ? context.t('Choose a date', 'তারিখ দিন')
        : null,
  );
}

class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    required this.label,
    this.autofocus = false,
    this.onSubmitted,
  });
  final TextEditingController controller;
  final String label;
  final bool autofocus;
  final VoidCallback? onSubmitted;
  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool hidden = true;
  @override
  Widget build(BuildContext context) => TextFormField(
    controller: widget.controller,
    obscureText: hidden,
    autofocus: widget.autofocus,
    autocorrect: false,
    enableSuggestions: false,
    keyboardType: TextInputType.visiblePassword,
    autofillHints: const [AutofillHints.password],
    onFieldSubmitted: (_) => widget.onSubmitted?.call(),
    validator: (v) => v == null || v.isEmpty
        ? context.t('Enter a password', 'পাসওয়ার্ড দিন')
        : null,
    decoration: InputDecoration(
      labelText: widget.label,
      suffixIcon: IconButton(
        tooltip: context.t(
          hidden ? 'Show password' : 'Hide password',
          hidden ? 'পাসওয়ার্ড দেখুন' : 'পাসওয়ার্ড লুকান',
        ),
        onPressed: () => setState(() => hidden = !hidden),
        icon: Icon(
          hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
        ),
      ),
    ),
  );
}

class NumberField extends StatelessWidget {
  const NumberField({
    super.key,
    required this.controller,
    required this.label,
    this.integer = false,
    this.required = true,
    this.onChanged,
    this.allowZero = true,
    this.minimum = 0,
    this.maximum = 1e12,
  });
  final TextEditingController controller;
  final String label;
  final bool integer, required, allowZero;
  final double minimum, maximum;
  final ValueChanged<String>? onChanged;
  @override
  Widget build(BuildContext context) => TextFormField(
    controller: controller,
    keyboardType: TextInputType.numberWithOptions(decimal: !integer),
    inputFormatters: integer
        ? [
            TextInputFormatter.withFunction(
              (before, after) =>
                  RegExp(r'^\d*$').hasMatch(after.text) ? after : before,
            ),
          ]
        : null,
    onChanged: onChanged,
    decoration: InputDecoration(labelText: label),
    validator: (v) {
      if (!required && (v ?? '').isEmpty) return null;
      final n = double.tryParse(v ?? '');
      if (n == null ||
          !n.isFinite ||
          n < minimum ||
          n > maximum ||
          (!allowZero && n == 0) ||
          (integer && n != n.truncateToDouble())) {
        return context.t('Enter a valid amount', 'সঠিক পরিমাণ দিন');
      }
      return null;
    },
  );
}

class ValueRow extends StatelessWidget {
  const ValueRow(this.label, this.value, {super.key, this.bold = false});
  final String label, value;
  final bool bold;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(label)),
        const SizedBox(width: 16),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: TextStyle(
              fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
            ),
          ),
        ),
      ],
    ),
  );
}

class ListPager extends StatelessWidget {
  const ListPager({
    super.key,
    required this.total,
    required this.page,
    required this.onPage,
    this.size = 50,
  });
  final int total, page, size;
  final ValueChanged<int> onPage;
  @override
  Widget build(BuildContext context) {
    if (total <= size) return const SizedBox.shrink();
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          tooltip: context.t('Previous page', 'আগের পৃষ্ঠা'),
          onPressed: page > 0 ? () => onPage(page - 1) : null,
          icon: const Icon(Icons.chevron_left),
        ),
        Text(
          '${context.qty(page * size + 1)}–${context.qty(((page + 1) * size).clamp(0, total))} / ${context.qty(total)}',
        ),
        IconButton(
          tooltip: context.t('Next page', 'পরের পৃষ্ঠা'),
          onPressed: (page + 1) * size < total ? () => onPage(page + 1) : null,
          icon: const Icon(Icons.chevron_right),
        ),
      ],
    );
  }
}

List<T> paged<T>(List<T> list, int page, {int size = 50}) =>
    list.skip(page * size).take(size).toList();

// All editors use the same Back/gesture guard, including non-text changes.
class DraftGuard extends StatefulWidget {
  const DraftGuard({
    super.key,
    required this.dirty,
    required this.saving,
    required this.child,
  });
  final bool dirty, saving;
  final Widget child;
  @override
  State<DraftGuard> createState() => _DraftGuardState();
}

class _DraftGuardState extends State<DraftGuard> {
  bool approved = false, prompting = false;
  @override
  Widget build(BuildContext c) => PopScope(
    canPop: (!widget.dirty || approved) && !widget.saving,
    onPopInvokedWithResult: (didPop, result) async {
      if (didPop || widget.saving || prompting) return;
      prompting = true;
      final discard = await confirm(
        c,
        title: c.t('Discard changes?', 'পরিবর্তন বাদ দেবেন?'),
        message: c.t(
          'Unsaved changes will be discarded.',
          'সেভ না করা তথ্য বাদ যাবে।',
        ),
      );
      if (!mounted) return;
      prompting = false;
      if (!discard) return;
      setState(() => approved = true);
      await WidgetsBinding.instance.endOfFrame;
      if (c.mounted) Navigator.of(c).pop(result);
    },
    child: widget.child,
  );
}
