import 'dart:async';
import 'dart:io';
import 'package:supabase_flutter/supabase_flutter.dart';

/// No network connectivity at all - the request never reached the server,
/// so there's nothing server-side to report. Shown as "مفيش نت".
class NoNetworkException implements Exception {}

class DeliveryServerException implements Exception {
  final String message;
  DeliveryServerException(this.message);
}

/// Thrown when "customer not found" fails to actually save. Covers both
/// an exception from the insert call AND the case where the call returns
/// without throwing but created no row - deliberately not relying on
/// knowing exactly which of those a given SDK version does, since a wrong
/// assumption about SDK error-throwing behavior has already caused a bug
/// in this app before.
class ComplaintNotRecordedException implements Exception {
  final String? details;
  ComplaintNotRecordedException([this.details]);
}

class ConfirmDeliveryResult {
  final int? delayMinutes;
  final bool? isDelayed;

  ConfirmDeliveryResult({this.delayMinutes, this.isDelayed});

  factory ConfirmDeliveryResult.fromMap(Map<String, dynamic> map) => ConfirmDeliveryResult(
        delayMinutes: map['delay_minutes'] as int?,
        isDelayed: map['is_delayed'] as bool?,
      );
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

  Future<ConfirmDeliveryResult> confirmDelivery({required int orderId}) {
    return _invoke(
      'confirm-delivery',
      {'order_id': orderId},
      ConfirmDeliveryResult.fromMap,
    );
  }

  /// Section 5 exceptions table: "العميل مش موجود" logs a complaint against
  /// the order for manager follow-up - an explicitly required feature, and
  /// complaints is still the only place to put it even before a viewing
  /// screen exists.
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
