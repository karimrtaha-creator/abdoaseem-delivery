import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/driver_order.dart';

class OrdersService {
  final SupabaseClient _client = Supabase.instance.client;

  static const _columns =
      'id, pos_order_id, customer_id, address_id, customer_phone, status, dispatch_time, sla_minutes, delivered_time, delay_minutes, is_delayed';

  /// Realtime feed of this driver's currently-active deliveries. Section 6:
  /// the order appears here automatically the moment the dispatcher confirms
  /// exit - the driver never has to pull/search for it.
  Stream<List<DriverOrder>> activeOrdersStream(String driverId) {
    return _client
        .from('orders')
        .stream(primaryKey: ['id'])
        .eq('driver_id', driverId)
        .order('dispatch_time')
        .map((rows) => rows
            .map(DriverOrder.fromMap)
            .where((o) => o.status == 'out_for_delivery' || o.status == 'delayed')
            .toList());
  }

  Future<DriverOrder> fetchOrder(int orderId) async {
    final row = await _client.from('orders').select(_columns).eq('id', orderId).single();
    return DriverOrder.fromMap(row);
  }

  Future<Map<String, dynamic>?> fetchCustomerAddress(String? customerId) async {
    if (customerId == null) return null;
    final row = await _client
        .from('customers_profile')
        .select('building, floor, apartment, area')
        .eq('user_id', customerId)
        .maybeSingle();
    return row;
  }

  /// The newer multi-address book (see migration 0005) - only self-checkout
  /// customer orders carry an address_id; call_center phone orders never
  /// set one (the address was taken verbally, nothing to look up here),
  /// which is why callers fall back to fetchCustomerAddress for those.
  Future<Map<String, dynamic>?> fetchSavedAddress(int addressId) async {
    final row = await _client
        .from('customer_addresses')
        .select('building, floor, apartment, area, street, landmark, latitude, longitude')
        .eq('id', addressId)
        .maybeSingle();
    return row;
  }

  /// Pins the customer's real delivery location for this address, standing
  /// at the door. RLS (customer_addresses_update_driver_current_order,
  /// migration 0005) already restricts this to a driver updating only the
  /// location fields on an address tied to one of their own orders - the
  /// same design that migration originally shipped with, just wired up
  /// from the app for the first time here.
  Future<void> saveAddressLocation({
    required int addressId,
    required double latitude,
    required double longitude,
    required String driverId,
  }) async {
    // Postgrest doesn't error when an UPDATE's WHERE clause (further
    // narrowed here by the customer_addresses_update_driver_current_order
    // RLS policy) matches zero rows - it just "succeeds" silently. Without
    // checking the returned rows, an order reassigned to a different
    // driver between opening this screen and saving would report "location
    // saved" while writing nothing.
    final updated = await _client
        .from('customer_addresses')
        .update({
          'latitude': latitude,
          'longitude': longitude,
          'location_saved_at': DateTime.now().toUtc().toIso8601String(),
          'location_saved_by': driverId,
        })
        .eq('id', addressId)
        .select('id');
    if (updated.isEmpty) {
      throw Exception('العنوان ده مش تابع لأوردر شغال عندك دلوقتي - جرب تحدّث الشاشة');
    }
  }

  /// Section 6 "سجل الأداء اليومي": today's delivered orders for this
  /// driver, aggregated client-side (RLS already scopes rows to this
  /// driver, so no separate backend endpoint is needed for this).
  Future<DailyPerformance> fetchTodayPerformance(String driverId) async {
    final startOfDay = DateTime.now().toUtc().copyWith(
          hour: 0,
          minute: 0,
          second: 0,
          millisecond: 0,
          microsecond: 0,
        );
    final rows = await _client
        .from('orders')
        .select('dispatch_time, delivered_time, is_delayed')
        .eq('driver_id', driverId)
        .eq('status', 'delivered')
        .gte('delivered_time', startOfDay.toIso8601String());

    final list = rows as List<dynamic>;
    if (list.isEmpty) {
      return DailyPerformance(deliveredCount: 0, avgDeliveryMinutes: 0, delayedCount: 0);
    }

    var totalMinutes = 0;
    var delayed = 0;
    for (final r in list) {
      final dispatch = DateTime.parse(r['dispatch_time'] as String);
      final delivered = DateTime.parse(r['delivered_time'] as String);
      totalMinutes += delivered.difference(dispatch).inMinutes;
      if (r['is_delayed'] == true) delayed++;
    }

    return DailyPerformance(
      deliveredCount: list.length,
      avgDeliveryMinutes: totalMinutes / list.length,
      delayedCount: delayed,
    );
  }
}

class DailyPerformance {
  final int deliveredCount;
  final double avgDeliveryMinutes;
  final int delayedCount;

  DailyPerformance({
    required this.deliveredCount,
    required this.avgDeliveryMinutes,
    required this.delayedCount,
  });
}
