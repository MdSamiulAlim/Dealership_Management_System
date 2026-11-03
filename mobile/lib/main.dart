import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'core/api.dart';
import 'core/types.dart';
import 'core/vault.dart';
import 'core/workspace.dart';
import 'widgets/common.dart';
import 'screens/activity.dart';
import 'screens/catalog.dart';
import 'screens/invoices.dart';
import 'screens/overview.dart';
import 'screens/reports.dart';
import 'screens/settings.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('bn');
  final workspace = Workspace(api: HttpWorkspaceApi(), vault: NativeVault());
  runApp(ArafatApp(workspace: workspace));
  unawaited(workspace.init());
}

class ArafatApp extends StatelessWidget {
  const ArafatApp({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context) => WorkspaceScope(
    workspace: workspace,
    child: AnimatedBuilder(
      animation: workspace,
      builder: (c, _) {
        final colors = ColorScheme.fromSeed(seedColor: const Color(0xff006b50));
        return MaterialApp(
          // A locked/expired account owns no private Navigator routes or dialogs.
          key: ValueKey((workspace.authenticated, workspace.account)),
          title: 'Arafat Traders',
          debugShowCheckedModeBanner: false,
          locale: Locale(workspace.language),
          supportedLocales: const [Locale('en'), Locale('bn')],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          theme: ThemeData(
            useMaterial3: true,
            colorScheme: colors,
            fontFamily: workspace.language == 'bn' ? 'NotoBengali' : 'Manrope',
            fontFamilyFallback: const ['NotoBengali', 'Manrope'],
            scaffoldBackgroundColor: const Color(0xfff5faf6),
            cardTheme: CardThemeData(
              elevation: 0,
              margin: const EdgeInsets.all(4),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: colors.outlineVariant),
              ),
              color: colors.surface,
            ),
            inputDecorationTheme: InputDecorationTheme(
              filled: true,
              fillColor: colors.surface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 16,
              ),
            ),
            filledButtonTheme: FilledButtonThemeData(
              style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
            ),
            outlinedButtonTheme: OutlinedButtonThemeData(
              style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
            ),
            appBarTheme: AppBarTheme(
              backgroundColor: colors.surface,
              surfaceTintColor: Colors.transparent,
            ),
          ),
          home: !workspace.ready
              ? const Scaffold(body: Center(child: CircularProgressIndicator()))
              : workspace.authenticated
              ? const AppShell()
              : const LoginScreen(),
        );
      },
    ),
  );
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final username = TextEditingController(),
      password = TextEditingController(),
      form = GlobalKey<FormState>();
  bool offline = false, loaded = false;
  String error = '';
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!loaded) {
      username.text = context.w.account;
      loaded = true;
    }
  }

  @override
  void dispose() {
    username.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (!form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => error = '');
    final store = context.w;
    try {
      if (offline) {
        await store.unlock(username.text.trim(), password.text);
      } else {
        await store.signIn(username.text, password.text);
      }
    } catch (e) {
      if (mounted) setState(() => error = errorMessage(context, e));
    }
  }

  @override
  Widget build(BuildContext c) {
    final w = c.w;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Form(
                  key: form,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Align(
                        alignment: Alignment.centerRight,
                        child: SegmentedButton<String>(
                          segments: const [
                            ButtonSegment(value: 'bn', label: Text('বাংলা')),
                            ButtonSegment(value: 'en', label: Text('English')),
                          ],
                          selected: {w.language},
                          onSelectionChanged: w.busy
                              ? null
                              : (v) => w.setLanguage(v.first),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Center(
                        child: Image.asset(
                          'assets/brand/arafat-growth-logo.png',
                          height: 138,
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        c.t('Welcome back', 'স্বাগতম'),
                        style: Theme.of(c).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        c.t(
                          'Sign in to your Arafat Traders workspace.',
                          'আরাফাত ট্রেডার্সের হিসাব দেখতে লগইন করুন।',
                        ),
                      ),
                      const SizedBox(height: 24),
                      TextFormField(
                        controller: username,
                        enabled: !w.busy,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        autocorrect: false,
                        decoration: InputDecoration(
                          labelText: c.t('User ID', 'ইউজার আইডি'),
                          prefixIcon: const Icon(Icons.person_outline),
                        ),
                        validator: (v) => (v ?? '').trim().isEmpty
                            ? c.t('Enter your User ID', 'ইউজার আইডি দিন')
                            : null,
                      ),
                      const SizedBox(height: 16),
                      PasswordField(
                        controller: password,
                        label: c.t('Password', 'পাসওয়ার্ড'),
                        onSubmitted: w.busy ? null : submit,
                      ),
                      const SizedBox(height: 12),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          c.t(
                            'Unlock without internet',
                            'ইন্টারনেট ছাড়া খুলুন',
                          ),
                        ),
                        subtitle: Text(
                          c.t(
                            'Requires a previous online sign-in on this device.',
                            'আগে এই ডিভাইসে অনলাইনে লগইন করতে হবে।',
                          ),
                        ),
                        value: offline,
                        onChanged: w.busy
                            ? null
                            : (v) => setState(() => offline = v),
                      ),
                      if (error.isNotEmpty || w.error.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          child: Text(
                            error.isEmpty ? w.error : error,
                            style: TextStyle(
                              color: Theme.of(c).colorScheme.error,
                            ),
                          ),
                        ),
                      FilledButton.icon(
                        onPressed: w.busy ? null : submit,
                        icon: w.busy
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Icon(offline ? Icons.lock_open : Icons.login),
                        label: Text(
                          w.busy
                              ? c.t('Opening records…', 'হিসাব খোলা হচ্ছে…')
                              : c.t(
                                  offline ? 'Unlock' : 'Sign in',
                                  offline ? 'খুলুন' : 'লগইন',
                                ),
                        ),
                      ),
                      if (w.progress > 0)
                        Text(
                          c.t(
                            '${w.progress} records loaded',
                            '${c.qty(w.progress)}টি রেকর্ড লোড হয়েছে',
                          ),
                        ),
                      const SizedBox(height: 28),
                      const PoweredBy(),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Destination {
  const _Destination(this.en, this.bn, this.icon, this.screen);
  final String en, bn;
  final IconData icon;
  final Widget screen;
}

const destinations = [
  _Destination(
    'Overview',
    'সারসংক্ষেপ',
    Icons.dashboard_outlined,
    OverviewScreen(),
  ),
  _Destination('Sales', 'বিক্রি', Icons.receipt_long_outlined, SalesScreen()),
  _Destination(
    'Orders',
    'অর্ডার',
    Icons.local_shipping_outlined,
    ActivityScreen(kind: 'orders'),
  ),
  _Destination('Products', 'পণ্য', Icons.inventory_2_outlined, CatalogScreen()),
  _Destination(
    'Stock',
    'মজুত',
    Icons.warehouse_outlined,
    CatalogScreen(stock: true),
  ),
  _Destination(
    'Customers',
    'কাস্টমার',
    Icons.people_outline,
    CustomersScreen(),
  ),
  _Destination(
    'Customer due',
    'কাস্টমারের বাকি',
    Icons.account_balance_wallet_outlined,
    CustomersScreen(dueOnly: true),
  ),
  _Destination(
    'Money',
    'অর্থ ও লেনদেন',
    Icons.account_balance_outlined,
    ActivityScreen(kind: 'transactions'),
  ),
  _Destination('Reports', 'রিপোর্ট', Icons.bar_chart_outlined, ReportsScreen()),
  _Destination(
    'Expenses',
    'খরচ',
    Icons.payments_outlined,
    ActivityScreen(kind: 'expenses'),
  ),
  _Destination(
    'Settings & backup',
    'সেটিংস ও ব্যাকআপ',
    Icons.tune,
    SettingsScreen(),
  ),
];

class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  final scaffold = GlobalKey<ScaffoldState>();
  int selected = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && context.w.authenticated) {
      unawaited(context.w.sync(silent: true));
    }
  }

  Future<void> accountAction(String action) async {
    final w = context.w;
    if (action == 'lock') {
      await runAction(context, () async => w.lock());
      return;
    }
    if (!await confirm(
      context,
      title: context.t(
        action == 'switch' ? 'Switch account?' : 'Log out?',
        action == 'switch' ? 'অ্যাকাউন্ট বদলাবেন?' : 'লগআউট করবেন?',
      ),
      message: context.t(
        'Finish syncing saved work before logging out.',
        'লগআউটের আগে সেভ করা কাজ Sync শেষ করুন।',
      ),
    )) {
      return;
    }
    if (mounted) await runAction(context, w.signOut);
  }

  Widget drawer(BuildContext c) => Drawer(
    width: 300,
    child: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(10),
        children: [
          Row(
            children: [
              Image.asset(
                'assets/brand/arafat-growth-logo.png',
                height: 80,
                width: 100,
              ),
              const Spacer(),
              IconButton(
                tooltip: c.t('Close menu', 'মেনু বন্ধ করুন'),
                onPressed: () => Navigator.pop(c),
                icon: const Icon(Icons.close),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 8),
            child: Text(c.t('Business workspace', 'ব্যবসার হিসাব')),
          ),
          for (var i = 0; i < destinations.length; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: ListTile(
                shape: const StadiumBorder(),
                selected: selected == i,
                selectedTileColor: Theme.of(c).colorScheme.primaryContainer,
                leading: Icon(destinations[i].icon),
                title: Text(c.t(destinations[i].en, destinations[i].bn)),
                onTap: () {
                  setState(() => selected = i);
                  Navigator.pop(c);
                },
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: SvgPicture.asset(
              'assets/brand/akij-feed-logo.svg',
              height: 48,
            ),
          ),
          const PoweredBy(),
          const SizedBox(height: 12),
        ],
      ),
    ),
  );
  @override
  Widget build(BuildContext c) {
    final w = c.w, wide = MediaQuery.sizeOf(c).width >= 1100;
    const bottomIndices = [0, 1, 4, 6];
    final content = Column(
      children: [
        if (w.pending > 0 || !w.online || w.error.isNotEmpty)
          Material(
            color: w.error.isEmpty
                ? Theme.of(c).colorScheme.secondaryContainer
                : Theme.of(c).colorScheme.errorContainer,
            child: ListTile(
              dense: true,
              leading: Icon(
                w.error.isNotEmpty
                    ? Icons.warning_amber
                    : Icons.cloud_upload_outlined,
              ),
              title: Text(
                w.error.isNotEmpty
                    ? errorMessage(c, AppFailure(w.error))
                    : w.pending > 0
                    ? c.t(
                        '${w.pending} actions pending Sync',
                        '${c.qty(w.pending)}টি কাজ Sync অপেক্ষমাণ',
                      )
                    : c.t(
                        'Offline · saved on this device',
                        'Offline · এই ডিভাইসে সেভ হচ্ছে',
                      ),
              ),
              trailing: IconButton(
                tooltip: c.t('View sync queue', 'Sync তালিকা দেখুন'),
                onPressed: () => page(c, const QueueScreen()),
                icon: const Icon(Icons.chevron_right),
              ),
            ),
          ),
        Expanded(
          child: KeyedSubtree(
            key: ValueKey(selected),
            child: destinations[selected].screen,
          ),
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(8, 0, 16, 4),
          child: Align(alignment: Alignment.centerRight, child: PoweredBy()),
        ),
      ],
    );
    return PopScope(
      canPop: selected == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) setState(() => selected = 0);
      },
      child: Scaffold(
        key: scaffold,
        drawer: drawer(c),
        appBar: AppBar(
          automaticallyImplyLeading: false,
          leading: wide
              ? null
              : IconButton(
                  tooltip: c.t('Open menu', 'মেনু খুলুন'),
                  onPressed: () => scaffold.currentState?.openDrawer(),
                  icon: const Icon(Icons.menu),
                ),
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Arafat Traders',
                style: Theme.of(
                  c,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const HeaderClock(),
            ],
          ),
          actions: [
            IconButton(
              tooltip: c.t('Search', 'খুঁজুন'),
              onPressed: () async {
                final id = await showSearch<String?>(
                  context: c,
                  delegate: RecordSearch(w),
                );
                if (id != null && c.mounted) {
                  await page(c, InvoiceScreen(id: id));
                }
              },
              icon: const Icon(Icons.search),
            ),
            IconButton(
              tooltip: c.t('Sync now', 'এখন Sync করুন'),
              onPressed: w.syncing ? null : () => runAction(c, () => w.sync()),
              icon: w.syncing
                  ? const SizedBox(
                      width: 19,
                      height: 19,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(
                      w.online
                          ? Icons.cloud_done_outlined
                          : Icons.cloud_off_outlined,
                    ),
            ),
            PopupMenuButton<String>(
              tooltip: c.t(
                'Account · ${w.account}',
                'অ্যাকাউন্ট · ${w.account}',
              ),
              onSelected: accountAction,
              itemBuilder: (_) => [
                PopupMenuItem(
                  enabled: false,
                  child: Text(
                    '${w.account} · ${c.t(w.admin ? 'Admin' : 'General', w.admin ? 'অ্যাডমিন' : 'সাধারণ')}',
                  ),
                ),
                PopupMenuItem(
                  value: 'switch',
                  child: Text(c.t('Switch account', 'অ্যাকাউন্ট বদলান')),
                ),
                PopupMenuItem(
                  value: 'logout',
                  child: Text(c.t('Log out', 'লগআউট')),
                ),
                PopupMenuItem(
                  value: 'lock',
                  child: Text(c.t('Lock app', 'অ্যাপ লক করুন')),
                ),
              ],
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Image.asset(
                  'assets/brand/arafat-app-icon.png',
                  height: 36,
                  width: 36,
                ),
              ),
            ),
            const SizedBox(width: 4),
          ],
        ),
        body: SafeArea(
          top: false,
          child: wide
              ? Row(
                  children: [
                    SizedBox(
                      width: 220,
                      child: ListView(
                        children: [
                          for (var i = 0; i < destinations.length; i++)
                            ListTile(
                              selected: selected == i,
                              leading: Icon(destinations[i].icon),
                              title: Text(
                                c.t(destinations[i].en, destinations[i].bn),
                              ),
                              onTap: () => setState(() => selected = i),
                            ),
                        ],
                      ),
                    ),
                    const VerticalDivider(width: 1),
                    Expanded(child: content),
                  ],
                )
              : content,
        ),
        bottomNavigationBar: wide
            ? null
            : NavigationBar(
                selectedIndex: bottomIndices.contains(selected)
                    ? bottomIndices.indexOf(selected)
                    : 4,
                onDestinationSelected: (v) {
                  if (v == 4) {
                    scaffold.currentState?.openDrawer();
                  } else {
                    setState(() => selected = bottomIndices[v]);
                  }
                },
                destinations: [
                  for (final i in bottomIndices)
                    NavigationDestination(
                      icon: Icon(destinations[i].icon),
                      label: c.t(
                        i == 6 ? 'Due' : destinations[i].en,
                        i == 6 ? 'বাকি' : destinations[i].bn,
                      ),
                    ),
                  NavigationDestination(
                    icon: const Icon(Icons.menu),
                    label: c.t('More', 'আরও'),
                  ),
                ],
              ),
      ),
    );
  }
}

class HeaderClock extends StatefulWidget {
  const HeaderClock({super.key});
  @override
  State<HeaderClock> createState() => _HeaderClockState();
}

class _HeaderClockState extends State<HeaderClock> {
  Timer? timer;
  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => Text(
    DateFormat(
      'EEE, d MMM · hh:mm a',
      c.w.language,
    ).format(DateTime.now().toUtc().add(const Duration(hours: 6))),
    style: Theme.of(c).textTheme.labelSmall,
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
  );
}

class PoweredBy extends StatelessWidget {
  const PoweredBy({super.key});
  @override
  Widget build(BuildContext c) => Text.rich(
    TextSpan(
      text: c.t('Powered by ', 'প্রযুক্তি সহায়তায় '),
      children: [
        TextSpan(
          text: 'Samiul Alim',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontStyle: FontStyle.italic,
            color: Theme.of(c).colorScheme.primary,
          ),
        ),
      ],
    ),
    style: Theme.of(c).textTheme.labelSmall,
  );
}

class RecordSearch extends SearchDelegate<String?> {
  RecordSearch(this.workspace)
    : super(
        searchFieldLabel: workspace.tr(
          'Invoice or customer',
          'ইনভয়েস বা কাস্টমার',
        ),
      );
  final Workspace workspace;
  @override
  List<Widget> buildActions(BuildContext context) => [
    IconButton(onPressed: () => query = '', icon: const Icon(Icons.clear)),
  ];
  @override
  Widget buildLeading(BuildContext context) =>
      BackButton(onPressed: () => close(context, null));
  @override
  Widget buildResults(BuildContext context) => buildSuggestions(context);
  @override
  Widget buildSuggestions(BuildContext c) {
    final found = rows(workspace.view, 'invoices')
        .where(
          (i) => '${i['invoice_no']} ${i['customer_name']}'
              .toLowerCase()
              .contains(query.toLowerCase()),
        )
        .toList();
    return ListView.builder(
      itemCount: found.length.clamp(0, 50),
      itemBuilder: (c, n) {
        final i = found[n];
        return ListTile(
          leading: const Icon(Icons.receipt_long),
          title: Text(text(i['invoice_no'])),
          subtitle: Text(text(i['customer_name'])),
          onTap: () => close(c, text(i['id'])),
        );
      },
    );
  }
}
