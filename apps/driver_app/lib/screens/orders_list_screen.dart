import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/driver_order.dart';
import '../services/auth_service.dart';
import '../services/location_tracking_service.dart';
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
  final _locationService = LocationTrackingService();
  StreamSubscription<List<DriverOrder>>? _sub;
  Timer? _tickTimer;
  List<DriverOrder> _orders = [];
  bool _loading = true;
  final Set<int> _selectedToReceive = {};
  bool _receiving = false;

  @override
  void initState() {
    super.initState();
    _locationService.ensurePermissions();
    final uid = Supabase.instance.client.auth.currentUser!.id;
    _sub = _ordersService.activeOrdersStream(uid).listen((orders) {
      setState(() {
        _orders = orders;
        _loading = false;
        // An order that got delivered/reassigned since the last snapshot
        // won't be in the new list anymore - drop it from the pending
        // selection so a stale id can't be sent to receive-order.
        _selectedToReceive.removeWhere((id) => !orders.any((o) => o.id == id));
      });
      // Tracking is on for exactly as long as there's something out for
      // delivery - start()/stop() are both no-ops if already in that state.
      if (orders.isNotEmpty) {
        _locationService.start();
      } else {
        _locationService.stop();
      }
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
    _locationService.stop();
    super.dispose();
  }

  Future<void> _confirmReceive() async {
    if (_selectedToReceive.isEmpty) return;
    final loadedCount = _orders.where((o) => !o.isReceived).length;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('تأكيد الاستلام'),
        content: Text(
          'أنت بصدد تأكيد استلام ${_selectedToReceive.length} من أصل $loadedCount أوردر محمّل عليك.\n'
          'اتأكد إنك فعلاً استلمت العدد ده بالظبط قبل ما تكمل.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('لأ')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('أيوه، استلمتهم')),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _receiving = true);
    try {
      final result = await _ordersService.receiveOrders(_selectedToReceive.toList());
      if (!mounted) return;
      setState(() => _selectedToReceive.clear());
      if (result.notReceived.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('اتسلّم ${result.received.length}، و${result.notReceived.length} مقدرناش نأكدهم - حدّث الشاشة وجرب تاني')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم استلام ${result.received.length} أوردر')),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('فشل تأكيد الاستلام - اتأكد من النت وحاول تاني')),
      );
    } finally {
      if (mounted) setState(() => _receiving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final loaded = _orders.where((o) => !o.isReceived).toList();
    final received = _orders.where((o) => o.isReceived).toList();

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
              : ListView(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  children: [
                    if (loaded.isNotEmpty) ...[
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        child: Text('أوردرات محمّلة عليك - لسه ما استلمتهاش', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                      // Bare order number + countdown only - no customer name,
                      // phone, or address here on purpose: that data isn't
                      // even sent to the app for these ids yet (see
                      // list_my_driver_orders, 0072), not just hidden in the UI.
                      ...loaded.map((order) => CheckboxListTile(
                            value: _selectedToReceive.contains(order.id),
                            onChanged: _receiving
                                ? null
                                : (checked) => setState(() {
                                      if (checked == true) {
                                        _selectedToReceive.add(order.id);
                                      } else {
                                        _selectedToReceive.remove(order.id);
                                      }
                                    }),
                            title: Text('أوردر #${order.posOrderId ?? order.id}'),
                            subtitle: Text(order.isOverdueNow ? 'متأخر' : 'جاري التحميل'),
                          )),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                            onPressed: _selectedToReceive.isEmpty || _receiving ? null : _confirmReceive,
                            child: Text(_receiving ? 'جاري التأكيد...' : 'استلام الطلب (${_selectedToReceive.length})'),
                          ),
                        ),
                      ),
                      const Divider(),
                    ],
                    if (received.isNotEmpty) ...[
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        child: Text('أوردرات مستلمة', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                      ...received.map((order) => OrderCard(
                            order: order,
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: order.id)),
                            ),
                          )),
                    ],
                  ],
                ),
    );
  }
}
