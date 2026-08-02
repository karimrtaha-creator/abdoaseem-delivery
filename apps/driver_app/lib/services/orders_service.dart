import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/driver_order.dart';

class OrdersService {
  final SupabaseClient _client = Supabase.instance.client;

  static const _columns =
      'id, pos_order_id, customer_id, customer_phone, status, dispatch_time, sla_minutes, delivered_time, delay_minutes, is_delayed';

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
