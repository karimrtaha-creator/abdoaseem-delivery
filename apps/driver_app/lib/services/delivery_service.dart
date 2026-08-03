import 'dart:async';
import 'dart:io';
import 'package:supabase_flutter/supabase_flutter.dart';

/// No network connectivity at all - the request never reached the server,
/// so there's nothing server-side to report. Shown as "مفيش نت".
class NoNetworkException implements Exception {}

/// The server responded but with a real HTTP error (401/403/404/409/500) -
/// these are NOT expected outcomes of a normal verify/resend attempt
/// anymore (see verify-otp/index.ts: wrong/expired/locked all come back as
/// 200 + result). Reaching this means something is actually wrong
/// (unauthorized session, order reassigned, server bug, etc.).
class DeliveryServerException implements Exception {
  final String message;
  DeliveryServerException(this.message);
}

/// Thrown when "customer not found" fails to actually save. Covers both
/// an exception from the insert call AND the case where the call returns
/// without throwing but created no row - deliberately not relying on
/// knowing exactly which of those a given SDK version does, since a wrong
/// assumption about SDK error-throwing behavior has already caused one
/// bug in this app (see verify-otp/resend-otp history).
class ComplaintNotRecordedException implements Exception {
  final String? details;
  ComplaintNotRecordedException([this.details]);
}

class VerifyOtpResult {
  final String result; // delivered | wrong_code | expired | locked | no_active_code
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

class ResendOtpResult {
  final String result; // resent | resend_limit_reached

  ResendOtpResult({required this.result});

  factory ResendOtpResult.fromMap(Map<String, dynamic> map) =>
      ResendOtpResult(result: map['result'] as String);
}

class DeliveryService {
  final SupabaseClient _client = Supabase.instance.client;

  Future<T> _invoke<T>(
    String functionName,
    Map<String, dynamic> body,
    T Function(Map<String, dynamic>) parse,
  ) async {
    try {
      final res = await _client.functions.invoke(functionName, body: body);
      return parse(res.data as Map<String, dynamic>);
    } on FunctionException catch (e) {
      throw DeliveryServerException(e.details?.toString() ?? e.reasonPhrase ?? 'server error');
    } on SocketException {
      throw NoNetworkException();
    } on TimeoutException {
      throw NoNetworkException();
    }
  }

  Future<VerifyOtpResult> verifyOtp({required int orderId, required String code}) {
    return _invoke(
      'verify-otp',
      {'order_id': orderId, 'code': code},
      VerifyOtpResult.fromMap,
    );
  }

  Future<ResendOtpResult> resendOtp({required int orderId}) {
    return _invoke(
      'resend-otp',
      {'order_id': orderId},
      ResendOtpResult.fromMap,
    );
  }

  /// Section 5 exceptions table: "العميل مش موجود" logs a complaint against
  /// the order for manager follow-up. Unlike the OTP-lockout/resend-limit
  /// cases (now console.warn only - see verify-otp/resend-otp), this one
  /// stays a real complaints row: it's an explicitly required feature, not
  /// something added on top, and complaints is still the only place to put
  /// it even before a viewing screen exists.
  Future<void> reportCustomerNotFound({required int orderId}) async {
    try {
      final rows = await _client
          .from('complaints')
          .insert({
            'order_id': orderId,
            'type': 'other',
            'description': 'العميل مش موجود وقت وصول الطيار.',
          })
          .select('id');
      if (rows.isEmpty) {
        throw ComplaintNotRecordedException('insert returned no row');
      }
    } on SocketException {
      throw NoNetworkException();
    } on TimeoutException {
      throw NoNetworkException();
    } on NoNetworkException {
      rethrow;
    } on ComplaintNotRecordedException {
      rethrow;
    } catch (e) {
      throw ComplaintNotRecordedException(e.toString());
    }
  }
}
