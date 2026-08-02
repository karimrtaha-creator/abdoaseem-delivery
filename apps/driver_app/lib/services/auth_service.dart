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

  Future<void> signInWithPhone(String phone, String password) async {
    await _client.auth.signInWithPassword(
      email: phoneToStaffEmail(phone),
      password: password,
    );
  }

  Future<void> signOut() => _client.auth.signOut();

  Session? get currentSession => _client.auth.currentSession;

  Stream<AuthState> get onAuthStateChange => _client.auth.onAuthStateChange;
}
