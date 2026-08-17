class DriverOrder {
  final int id;
  final String? posOrderId;
  final String? customerId;
  final int? addressId;
  // Null before driver_received_at is set (see receive-order / the masked
  // list_my_driver_orders/get_my_driver_order RPCs, migration 0071/0072) -
  // deliberately nullable, not '', so "not visible yet" can never be
  // confused with "genuinely blank".
  final String? customerPhone;
  final String status; // out_for_delivery | delayed | delivered | ...
  final DateTime? dispatchTime;
  final int? slaMinutes;
  final DateTime? deliveredTime;
  final int? delayMinutes;
  final bool isDelayed;
  final DateTime? driverReceivedAt;

  DriverOrder({
    required this.id,
    required this.posOrderId,
    required this.customerId,
    required this.addressId,
    required this.customerPhone,
    required this.status,
    required this.dispatchTime,
    required this.slaMinutes,
    required this.deliveredTime,
    required this.delayMinutes,
    required this.isDelayed,
    required this.driverReceivedAt,
  });

  factory DriverOrder.fromMap(Map<String, dynamic> map) {
    return DriverOrder(
      id: map['id'] as int,
      posOrderId: map['pos_order_id'] as String?,
      customerId: map['customer_id'] as String?,
      addressId: map['address_id'] as int?,
      customerPhone: map['customer_phone'] as String?,
      status: map['status'] as String? ?? '',
      dispatchTime: map['dispatch_time'] != null
          ? DateTime.parse(map['dispatch_time'] as String).toLocal()
          : null,
      slaMinutes: map['sla_minutes'] as int?,
      deliveredTime: map['delivered_time'] != null
          ? DateTime.parse(map['delivered_time'] as String).toLocal()
          : null,
      delayMinutes: map['delay_minutes'] as int?,
      isDelayed: map['is_delayed'] as bool? ?? false,
      driverReceivedAt: map['driver_received_at'] != null
          ? DateTime.parse(map['driver_received_at'] as String).toLocal()
          : null,
    );
  }

  bool get isReceived => driverReceivedAt != null;

  /// Deadline computed client-side purely for the live green/red
  /// countdown (section 6). The authoritative "delayed" flag on the
  /// server comes from the check-sla-breaches scheduled function.
  DateTime? get deadline {
    if (dispatchTime == null || slaMinutes == null) return null;
    return dispatchTime!.add(Duration(minutes: slaMinutes!));
  }

  bool get isOverdueNow {
    final d = deadline;
    if (d == null) return false;
    return DateTime.now().isAfter(d);
  }

  Duration? get remaining {
    final d = deadline;
    if (d == null) return null;
    return d.difference(DateTime.now());
  }
}
