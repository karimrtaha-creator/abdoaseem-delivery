import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/driver_order.dart';
import '../services/orders_service.dart';
import 'otp_confirm_screen.dart';

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
    final address = await _ordersService.fetchCustomerAddress(order.customerId);
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
                        'منطقة: ${address['area'] ?? '-'}\n'
                        'عمارة: ${address['building'] ?? '-'} - دور: ${address['floor'] ?? '-'} - شقة: ${address['apartment'] ?? '-'}',
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
                  ],
                ),
              ),
            ),
            const Spacer(),
            SizedBox(
              height: 56,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E6B52)),
                icon: const Icon(Icons.password, color: Colors.white),
                label: const Text('تأكيد التسليم بكود OTP', style: TextStyle(fontSize: 17, color: Colors.white)),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => OtpConfirmScreen(order: order)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
