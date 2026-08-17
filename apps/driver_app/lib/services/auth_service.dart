import 'package:supabase_flutter/supabase_flutter.dart';

/// Same phone -> synthetic-email convention as apps/dispatcher-web
/// (src/lib/phoneAuth.ts). Must stay identical on both clients since
/// whatever creates staff accounts (Phase 3) uses this mapping too.
const _staffEmailDomain = 'abdoaseem.internal';

String phoneToStaffEmail(String phone) {
  final digitsOnly = phone.replaceAll(RegExp(r'\D'), '');
  return '$digitsOnly@$_staffEmailDomain';
}

class AuthService {
  final SupabaseClient _client = Supabase.instance.client;

  // Routed through the login edge function (same fix as dispatcher-web and
  // customer-web's AuthContext, security audit finding M-01) instead of
  // calling signInWithPassword directly - this app was the one client
  // still bypassing it, meaning driver logins had no server-side
  // per-account brute-force attempt limit at all. Same synthetic email,
  // same generic error on any failure.
  Future<void> signInWithPhone(String phone, String password) async {
    final FunctionResponse res;
    try {
      res = await _client.functions.invoke(
        'login',
        body: {'email': phoneToStaffEmail(phone), 'password': password},
      );
    } on FunctionException {
      throw const AuthException('رقم التليفون أو الباسورد غلط');
    }
    final data = res.data as Map<String, dynamic>;
    await _client.auth.setSession(data['refresh_token'] as String);
  }

  Future<void> signOut() => _client.auth.signOut();

  Session? get currentSession => _client.auth.currentSession;

  Stream<AuthState> get onAuthStateChange => _client.auth.onAuthStateChange;
}
