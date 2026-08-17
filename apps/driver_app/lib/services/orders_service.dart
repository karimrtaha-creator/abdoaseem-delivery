import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/driver_order.dart';

class ReceiveOrdersResult {
  final List<int> received;
  final List<int> notReceived;
  ReceiveOrdersResult({required this.received, required this.notReceived});
}

class OrdersService {
  final SupabaseClient _client = Supabase.instance.client;

  /// Realtime feed of this driver's currently-active deliveries. Section 6:
  /// the order appears here automatically the moment the dispatcher confirms
  /// exit - the driver never has to pull/search for it.
  ///
  /// This no longer reads displayable data from the raw Realtime payload -
  /// the underlying orders.customer_phone column is present on that row the
  /// instant it's dispatched, before this driver has confirmed receiving it,
  /// and Postgres Realtime always broadcasts the full row for any change a
  /// subscriber's RLS allows (it has no column-level masking of its own).
  /// The stream below is used purely as a "something changed, refetch"
  /// signal; every emission re-fetches through list_my_driver_orders (0072),
  /// a masked RPC that only returns customer_phone once driver_received_at
  /// is set - that's the actual, server-enforced gate, not a client choice
  /// to ignore a field it already has.
  List<DriverOrder>? _lastKnownOrders;

  Stream<List<DriverOrder>> activeOrdersStream(String driverId) async* {
    final first = await _fetchMaskedOrdersOrLastKnown();
    if (first != null) yield first;
    await for (final _ in _client.from('orders').stream(primaryKey: ['id']).eq('driver_id', driverId)) {
      final orders = await _fetchMaskedOrdersOrLastKnown();
      if (orders != null) yield orders;
    }
  }

  // A thrown exception here (e.g. a dropped connection right as a realtime
  // tick fires) would otherwise propagate out of the async* generator above
  // and terminate the whole stream permanently - the driver would stop
  // getting live order updates for the rest of the session with no error
  // shown and no way to recover short of force-closing the app. Falling
  // back to the last-known list (or null, on the very first call with
  // nothing to fall back to) keeps the feed alive through a transient
  // failure; the next realtime tick or reconnect naturally retries.
  Future<List<DriverOrder>?> _fetchMaskedOrdersOrLastKnown() async {
    try {
      final orders = await _fetchMaskedOrders();
      _lastKnownOrders = orders;
      return orders;
    } catch (_) {
      return _lastKnownOrders;
    }
  }

  Future<List<DriverOrder>> _fetchMaskedOrders() async {
    final rows = await _client.rpc('list_my_driver_orders');
    return (rows as List).map((r) => DriverOrder.fromMap(r as Map<String, dynamic>)).toList();
  }

  /// Same masking as activeOrdersStream, for a single order (order_detail_screen).
  Future<DriverOrder> fetchOrder(int orderId) async {
    final rows = await _client.rpc('get_my_driver_order', params: {'p_order_id': orderId});
    final list = rows as List;
    if (list.isEmpty) throw Exception('الأوردر ده مش موجود أو مش تابع ليك');
    return DriverOrder.fromMap(list.first as Map<String, dynamic>);
  }

  /// "استلام الطلب" - the explicit acknowledgement step that didn't exist
  /// before (see receive-order, migration 0071). The server is the only
  /// thing that decides which ids actually get received (must be this
  /// driver's own, still out_for_delivery/delayed, not already received) -
  /// this can never result in "received more than loaded" no matter what's
  /// passed in, and customer_phone only becomes visible for an id once it
  /// comes back in `received`.
  Future<ReceiveOrdersResult> receiveOrders(List<int> orderIds) async {
    final res = await _client.functions.invoke('receive-order', body: {'order_ids': orderIds});
    final data = res.data as Map<String, dynamic>;
    return ReceiveOrdersResult(
      received: (data['received'] as List).cast<int>(),
      notReceived: (data['not_received'] as List).cast<int>(),
    );
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
  /// at the door ("الموقع غلط" -> "إضافة لوكيشن جديد" flow). RLS
  /// (customer_addresses_update_driver_current_order, migrations 0005/0071)
  /// restricts this to a driver updating only the location fields on an
  /// address tied to an order they're CURRENTLY delivering (narrowed from
  /// "any order ever assigned" - Karim confirmed this 2026-08-17). Every
  /// real change this makes is archived automatically by a database
  /// trigger into customer_address_location_history, visible to
  /// general_manager - no extra call needed here for that.
  Future<void> saveAddressLocation({
    required int addressId,
    required double latitude,
    required double longitude,
    required String driverId,
  }) async {
    // Basic plausibility check - a (0,0) "null island" pin or a value
    // clearly outside Egypt is almost certainly a GPS glitch, not a real
    // correction; reject before it ever reaches the server.
    if (latitude == 0 && longitude == 0) {
      throw Exception('الموقع ده مش منطقي - جرب تاني وانت واقف مكان التسليم');
    }
    if (latitude < 22 || latitude > 32 || longitude < 25 || longitude > 37) {
      throw Exception('الموقع ده برا مصر - اتأكد إن الـGPS شغال صح وحاول تاني');
    }
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
  /// driver, so no separate backend endpoint is needed for this). Delivered
  /// orders carry no pre-receipt PII concern (the driver already saw
  /// everything while delivering them), so this keeps reading the base
  /// table directly rather than going through the masked RPCs.
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
