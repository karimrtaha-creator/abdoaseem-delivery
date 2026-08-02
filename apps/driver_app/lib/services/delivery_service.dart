import 'package:supabase_flutter/supabase_flutter.dart';

class VerifyOtpResult {
  final String result; // delivered | wrong_code | expired | locked
  final int? attemptsRemaining;
  final int? delayMinutes;
  final bool? isDelayed;

  VerifyOtpResult({
    required this.result,
    this.attemptsRemaining,
    this.delayMinutes,
    this.isDelayed,
  });

  factory VerifyOtpResult.fromMap(Map<String, dynamic> map) => VerifyOtpResult(
        result: map['result'] as String,
        attemptsRemaining: map['attempts_remaining'] as int?,
        delayMinutes: map['delay_minutes'] as int?,
        isDelayed: map['is_delayed'] as bool?,
      );
}

class DeliveryService {
  final SupabaseClient _client = Supabase.instance.client;

  Future<VerifyOtpResult> verifyOtp({required int orderId, required String code}) async {
    final res = await _client.functions.invoke(
      'verify-otp',
      body: {'order_id': orderId, 'code': code},
    );
    return VerifyOtpResult.fromMap(res.data as Map<String, dynamic>);
  }

  Future<void> resendOtp({required int orderId}) async {
    await _client.functions.invoke('resend-otp', body: {'order_id': orderId});
  }

  /// Section 5 exceptions table: "العميل مش موجود" logs a complaint against
  /// the order for manager follow-up (no dedicated status exists for this
  /// in the schema, so it's recorded the same way OTP-lockout is - see
  /// supabase/functions/verify-otp/index.ts for the matching server-side case).
  Future<void> reportCustomerNotFound({required int orderId}) async {
    await _client.from('complaints').insert({
      'order_id': orderId,
      'type': 'other',
      'description': 'العميل مش موجود وقت وصول الطيار.',
    });
  }
}
