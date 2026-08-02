class DriverOrder {
  final int id;
  final String? posOrderId;
  final String? customerId;
  final String customerPhone;
  final String status; // out_for_delivery | delayed | delivered | ...
  final DateTime? dispatchTime;
  final int? slaMinutes;
  final DateTime? deliveredTime;
  final int? delayMinutes;
  final bool isDelayed;

  DriverOrder({
    required this.id,
    required this.posOrderId,
    required this.customerId,
    required this.customerPhone,
    required this.status,
    required this.dispatchTime,
    required this.slaMinutes,
    required this.deliveredTime,
    required this.delayMinutes,
    required this.isDelayed,
  });

  factory DriverOrder.fromMap(Map<String, dynamic> map) {
    return DriverOrder(
      id: map['id'] as int,
      posOrderId: map['pos_order_id'] as String?,
      customerId: map['customer_id'] as String?,
      customerPhone: map['customer_phone'] as String? ?? '',
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
    );
  }

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
