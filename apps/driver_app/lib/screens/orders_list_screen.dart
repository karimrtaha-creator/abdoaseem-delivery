import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/driver_order.dart';
import '../services/auth_service.dart';
import '../services/orders_service.dart';
import '../widgets/order_card.dart';
import 'order_detail_screen.dart';
import 'performance_screen.dart';

class OrdersListScreen extends StatefulWidget {
  const OrdersListScreen({super.key});

  @override
  State<OrdersListScreen> createState() => _OrdersListScreenState();
}

class _OrdersListScreenState extends State<OrdersListScreen> {
  final _ordersService = OrdersService();
  final _authService = AuthService();
  StreamSubscription<List<DriverOrder>>? _sub;
  Timer? _tickTimer;
  List<DriverOrder> _orders = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final uid = Supabase.instance.client.auth.currentUser!.id;
    _sub = _ordersService.activeOrdersStream(uid).listen((orders) {
      setState(() {
        _orders = orders;
        _loading = false;
      });
    });
    // Re-render every 15s so the remaining/overdue time on each card stays
    // live even when nothing in the DB has changed (section 6: "لحظة بلحظة").
    _tickTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _tickTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('أوردراتي الحالية'),
        actions: [
          IconButton(
            icon: const Icon(Icons.bar_chart),
            tooltip: 'الأداء اليومي',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const PerformanceScreen()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'تسجيل خروج',
            onPressed: () => _authService.signOut(),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _orders.isEmpty
              ? const Center(child: Text('مفيش أوردرات معاك دلوقتي', style: TextStyle(color: Colors.black54)))
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  itemCount: _orders.length,
                  itemBuilder: (context, index) {
                    final order = _orders[index];
                    return OrderCard(
                      order: order,
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: order.id)),
                      ),
                    );
                  },
                ),
    );
  }
}
