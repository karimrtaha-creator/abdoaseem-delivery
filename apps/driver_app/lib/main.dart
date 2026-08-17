import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'supabase_config.dart';
import 'services/auth_service.dart';
import 'services/profile_service.dart';
import 'services/push_service.dart';
import 'services/secure_local_storage.dart';
import 'screens/login_screen.dart';
import 'screens/orders_list_screen.dart';
import 'screens/dispatcher_home_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  await Supabase.initialize(
    url: SupabaseConfig.url,
    publishableKey: SupabaseConfig.anonKey,
    authOptions: const FlutterAuthClientOptions(localStorage: SecureLocalStorage()),
  );
  runApp(const DriverApp());
}

class DriverApp extends StatelessWidget {
  const DriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'تطبيق التوصيل - كشري الغباشي',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ar'),
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF1E6B52),
        useMaterial3: true,
        textTheme: Theme.of(context).textTheme,
      ),
      builder: (context, child) => Directionality(textDirection: TextDirection.rtl, child: child!),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  final _authService = AuthService();
  final _profileService = ProfileService();
  final _pushService = PushService();
  // Keyed by user id, not a plain bool - AuthGate's State is never
  // recreated by sign-out/sign-in (only its build() output swaps), so a
  // plain "already started" flag would never reset when a different
  // driver signs in on the same device, leaving the FCM token registered
  // against the previous driver's account indefinitely.
  String? _pushInitForUserId;

  @override
  void initState() {
    super.initState();
    // A session going null (sign-out, or a refresh-token failure) must be
    // able to get back to LoginScreen even if the driver is several
    // screens deep (OrderDetailScreen, ConfirmDeliveryScreen, etc. are all
    // pushed on top of this root route and are otherwise unaffected by
    // AuthGate's own rebuild).
    _authService.onAuthStateChange.listen((state) {
      if (state.session == null && mounted) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      stream: _authService.onAuthStateChange,
      builder: (context, snapshot) {
        final session = _authService.currentSession;
        if (session == null) return const LoginScreen();

        return FutureBuilder(
          future: _profileService.fetchOwnProfile(),
          builder: (context, profileSnapshot) {
            if (profileSnapshot.connectionState != ConnectionState.done) {
              return const Scaffold(body: Center(child: CircularProgressIndicator()));
            }
            final profile = profileSnapshot.data;
            if (profile == null || !profile.isActive) {
              return Scaffold(
                body: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('الحساب مش مفعّل. كلم المدير.'),
                      TextButton(onPressed: () => _authService.signOut(), child: const Text('تسجيل خروج')),
                    ],
                  ),
                ),
              );
            }
            // Mandatory dispatcher-photo gate (2026-08-11, approved design,
            // Option A): dispatcher's whole workflow moved off the web and
            // into this app - it needs the device camera for the photo
            // step, so it can't be a website. Driver and dispatcher are
            // two modes of the same app, gated by role, same pattern
            // dispatcher-web's own TABS_BY_ROLE already uses.
            if (profile.role == 'dispatcher') {
              if (profile.branchId == null) {
                return Scaffold(
                  body: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text('حساب الديسباتشر ده مش متربط بفرع - كلم المدير العام.'),
                        TextButton(onPressed: () => _authService.signOut(), child: const Text('تسجيل خروج')),
                      ],
                    ),
                  ),
                );
              }
              return DispatcherHomeScreen(branchId: profile.branchId!);
            }
            if (profile.role != 'driver') {
              return Scaffold(
                body: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('التطبيق ده مخصص للطيار والديسباتشر بس. الدور الحالي: ${profile.role}'),
                      TextButton(onPressed: () => _authService.signOut(), child: const Text('تسجيل خروج')),
                    ],
                  ),
                ),
              );
            }
            // Registers the device's push token once we know this is a
            // real, active driver session - not on every rebuild, and not
            // before we've confirmed the account is allowed to be here.
            // Re-registers whenever the signed-in user id changes, so a
            // second driver signing in on the same device (shared/company
            // phone) always claims the token for their own account.
            if (_pushInitForUserId != session.user.id) {
              _pushInitForUserId = session.user.id;
              _pushService.init();
            }
            return const OrdersListScreen();
          },
        );
      },
    );
  }
}
