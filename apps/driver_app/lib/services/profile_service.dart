import 'package:supabase_flutter/supabase_flutter.dart';

class DriverProfile {
  final String id;
  final String name;
  final String role;
  final bool isActive;
  final int? branchId;

  DriverProfile({
    required this.id,
    required this.name,
    required this.role,
    required this.isActive,
    this.branchId,
  });

  factory DriverProfile.fromMap(Map<String, dynamic> map) => DriverProfile(
        id: map['id'] as String,
        name: map['name'] as String? ?? '',
        role: map['role'] as String? ?? '',
        isActive: map['is_active'] as bool? ?? false,
        branchId: map['branch_id'] as int?,
      );
}

class ProfileService {
  final SupabaseClient _client = Supabase.instance.client;

  Future<DriverProfile?> fetchOwnProfile() async {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) return null;
    final row = await _client
        .from('users')
        .select('id, name, role, is_active, branch_id')
        .eq('id', uid)
        .maybeSingle();
    return row == null ? null : DriverProfile.fromMap(row);
  }

  /// Lets dispatch-order/cancel-order push straight to this device - see
  /// push_service.dart, called once per login and again on token refresh.
  /// Already covered by the existing users_update_self RLS policy (0001),
  /// no new policy needed.
  Future<void> saveFcmToken(String token) async {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) return;
    await _client.from('users').update({'fcm_token': token}).eq('id', uid);
  }
}
