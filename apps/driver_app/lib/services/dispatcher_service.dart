import 'dart:async';
import 'dart:io';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Mandatory dispatcher-photo gate (2026-08-11, approved design): mirrors
/// the error-handling pattern already established in delivery_service.dart
/// for calling edge functions from this app - not reinventing it.
class DispatcherServerException implements Exception {
  final String message;
  DispatcherServerException(this.message);
}

class NoNetworkException implements Exception {}

class QueuedOrder {
  final int id;
  final String? posOrderId;
  final String customerPhone;
  final DateTime orderTime;
  final DateTime? acceptedAt;
  final String status; // preparing | ready_for_driver | delayed
  final String orderSource; // customer_app | call_center
  final String? deliveryService;
  final int? deliveryTimeMinutes;

  QueuedOrder({
    required this.id,
    required this.posOrderId,
    required this.customerPhone,
    required this.orderTime,
    required this.acceptedAt,
    required this.status,
    required this.orderSource,
    required this.deliveryService,
    required this.deliveryTimeMinutes,
  });

  /// Website orders already carry delivery_service/delivery_time_minutes
  /// from create-order (the customer's zone + an SLA-tier lookup) - only
  /// call_center orders need the dispatcher's OCR-confirm step, since
  /// nothing else ever sets these for that source.
  bool get needsDeliveryTimeConfirmation => orderSource == 'call_center';

  factory QueuedOrder.fromMap(Map<String, dynamic> map) => QueuedOrder(
        id: map['id'] as int,
        posOrderId: map['pos_order_id'] as String?,
        customerPhone: map['customer_phone'] as String? ?? '',
        orderTime: DateTime.parse(map['order_time'] as String).toLocal(),
        acceptedAt: map['accepted_at'] != null ? DateTime.parse(map['accepted_at'] as String).toLocal() : null,
        status: map['status'] as String? ?? '',
        orderSource: map['order_source'] as String? ?? '',
        deliveryService: map['delivery_service'] as String?,
        deliveryTimeMinutes: map['delivery_time_minutes'] as int?,
      );
}

class ActiveDriver {
  final String id;
  final String name;
  ActiveDriver({required this.id, required this.name});
  factory ActiveDriver.fromMap(Map<String, dynamic> map) =>
      ActiveDriver(id: map['id'] as String, name: map['name'] as String? ?? '');
}

class DispatcherService {
  final SupabaseClient _client = Supabase.instance.client;

  /// Same queue Dispatch.tsx already shows on the web (branch-scoped,
  /// awaiting either a photo or a driver) - ported here, not redesigned.
  /// 'ready_for_driver' included so a photographed-but-unassigned order
  /// stays visible until a driver is actually picked.
  Stream<List<QueuedOrder>> queueStream(int branchId) {
    return _client
        .from('orders')
        .stream(primaryKey: ['id'])
        .eq('branch_id', branchId)
        .order('order_time')
        // .stream() always returns every column (no server-side .select()
        // support on realtime streams) - QueuedOrder.fromMap just reads
        // the ones it needs, including the new delivery_service/
        // delivery_time_minutes columns.
        .map((rows) => rows
            .map(QueuedOrder.fromMap)
            .where((o) => o.status == 'preparing' || o.status == 'ready_for_driver' || o.status == 'delayed')
            .toList());
  }

  Future<List<ActiveDriver>> activeDrivers(int branchId) async {
    final rows = await _client
        .from('users')
        .select('id, name')
        .eq('branch_id', branchId)
        .eq('role', 'driver')
        .eq('is_active', true)
        .order('name');
    return (rows as List<dynamic>).map((r) => ActiveDriver.fromMap(r as Map<String, dynamic>)).toList();
  }

  /// Uploads directly to the `receipts` bucket using this dispatcher's own
  /// session - storage RLS (receipts_insert_dispatcher, predates this
  /// feature) already restricts writes to `{their branch_id}/...`, so the
  /// path here must start with branchId to match it. Stores a PATH, not a
  /// public URL - same convention already used for payment_proof_url
  /// elsewhere in this codebase (the bucket is private; a signed URL gets
  /// generated on demand whenever someone actually needs to view it).
  Future<String> uploadPhoto({
    required int branchId,
    required int orderId,
    required File file,
  }) async {
    final path = '$branchId/$orderId/${DateTime.now().millisecondsSinceEpoch}.jpg';
    try {
      await _client.storage.from('receipts').upload(path, file, fileOptions: const FileOptions(contentType: 'image/jpeg'));
      return path;
    } on SocketException {
      throw NoNetworkException();
    } on TimeoutException {
      throw NoNetworkException();
    }
  }

  /// deliveryService/deliveryTimeMinutes are required by the server for
  /// call_center orders (see QueuedOrder.needsDeliveryTimeConfirmation) -
  /// null for website orders, which already have both set.
  Future<Map<String, dynamic>> photographOrder({
    required int orderId,
    required String photoPath,
    String? deliveryService,
    int? deliveryTimeMinutes,
  }) {
    return _invoke('photograph-order', {
      'order_id': orderId,
      'photo_url': photoPath,
      if (deliveryService != null) 'delivery_service': deliveryService,
      if (deliveryTimeMinutes != null) 'delivery_time_minutes': deliveryTimeMinutes,
    });
  }

  Future<Map<String, dynamic>> dispatchOrder({
    required int orderId,
    required String driverId,
    required num deliveryFeeAfterTax,
  }) {
    return _invoke('dispatch-order', {
      'order_id': orderId,
      'driver_id': driverId,
      'delivery_fee_after_tax': deliveryFeeAfterTax,
    });
  }

  Future<Map<String, dynamic>> _invoke(String functionName, Map<String, dynamic> body) async {
    try {
      final res = await _client.functions.invoke(functionName, body: body);
      return res.data as Map<String, dynamic>;
    } on FunctionException catch (e) {
      throw DispatcherServerException(e.details?.toString() ?? e.reasonPhrase ?? 'server error');
    } on SocketException {
      throw NoNetworkException();
    } on TimeoutException {
      throw NoNetworkException();
    }
  }
}
