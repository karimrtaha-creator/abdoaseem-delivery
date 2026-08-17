import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/driver_order.dart';
import '../services/orders_service.dart';
import 'location_map_screen.dart';
import 'confirm_delivery_screen.dart';

class OrderDetailScreen extends StatefulWidget {
  final int orderId;
  const OrderDetailScreen({super.key, required this.orderId});

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  final _ordersService = OrdersService();
  DriverOrder? _order;
  Map<String, dynamic>? _address;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final order = await _ordersService.fetchOrder(widget.orderId);
    // address_id (the newer multi-address book) only exists for self-
    // checkout customer orders - call_center phone orders never set it,
    // so those keep falling back to the old single-address profile.
    final address = order.addressId != null
        ? await _ordersService.fetchSavedAddress(order.addressId!)
        : await _ordersService.fetchCustomerAddress(order.customerId);
    if (!mounted) return;
    setState(() {
      _order = order;
      _address = address;
      _loading = false;
    });
  }

  Future<void> _call(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone);
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Future<void> _openLocationMap() async {
    final order = _order!;
    final address = _address!;
    // Explicit null check instead of a force-unwrap - if the session has
    // expired since this screen opened (phone idle a long time, refresh
    // token failed), this used to crash the screen instead of just
    // failing to open the map.
    final driverId = Supabase.instance.client.auth.currentUser?.id;
    if (driverId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('لازم تسجل دخول تاني الأول')),
      );
      return;
    }
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => LocationMapScreen(
          addressId: order.addressId!,
          driverId: driverId,
          initialLatitude: address['latitude'] as double?,
          initialLongitude: address['longitude'] as double?,
        ),
      ),
    );
    if (saved == true) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اتحفظ موقع العميل')),
      );
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _order == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final order = _order!;
    final address = _address;

    return Scaffold(
      appBar: AppBar(title: Text('أوردر #${order.posOrderId ?? order.id}')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('عنوان العميل', style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    if (address != null)
                      Text(
                        [
                          if (address['street'] != null) 'الشارع: ${address['street']}',
                          if (address['landmark'] != null) 'علامة مميزة: ${address['landmark']}',
                          'منطقة: ${address['area'] ?? '-'}',
                          'عمارة: ${address['building'] ?? '-'} - دور: ${address['floor'] ?? '-'} - شقة: ${address['apartment'] ?? '-'}',
                        ].join('\n'),
                      )
                    else
                      const Text('مفيش عنوان مسجل للعميل ده - العنوان اتاخد شفهيًا من الكول سنتر وقت الطلب.',
                          style: TextStyle(color: Colors.black54)),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        const Icon(Icons.phone, size: 18, color: Colors.black54),
                        const SizedBox(width: 6),
                        Text(order.customerPhone),
                        const Spacer(),
                        TextButton.icon(
                          onPressed: () => _call(order.customerPhone),
                          icon: const Icon(Icons.call),
                          label: const Text('اتصال'),
                        ),
                      ],
                    ),
                    if (order.addressId != null && address != null) ...[
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _openLocationMap,
                        icon: const Icon(Icons.location_pin),
                        label: Text(
                          address['latitude'] != null ? 'تعديل موقع العميل على الخريطة' : 'تثبيت موقع العميل على الخريطة',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const Spacer(),
            SizedBox(
              height: 56,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E6B52)),
                icon: const Icon(Icons.check_circle, color: Colors.white),
                label: const Text('تأكيد التسليم', style: TextStyle(fontSize: 17, color: Colors.white)),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => ConfirmDeliveryScreen(order: order)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
