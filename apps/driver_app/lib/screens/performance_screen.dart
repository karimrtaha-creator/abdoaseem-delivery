import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/orders_service.dart';

class PerformanceScreen extends StatefulWidget {
  const PerformanceScreen({super.key});

  @override
  State<PerformanceScreen> createState() => _PerformanceScreenState();
}

class _PerformanceScreenState extends State<PerformanceScreen> {
  final _ordersService = OrdersService();
  DailyPerformance? _performance;

  @override
  void initState() {
    super.initState();
    final uid = Supabase.instance.client.auth.currentUser!.id;
    _ordersService.fetchTodayPerformance(uid).then((p) {
      if (mounted) setState(() => _performance = p);
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = _performance;
    return Scaffold(
      appBar: AppBar(title: const Text('الأداء اليومي')),
      body: p == null
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  _StatCard(label: 'عدد الأوردرات المسلّمة النهاردة', value: '${p.deliveredCount}'),
                  const SizedBox(height: 12),
                  _StatCard(
                    label: 'متوسط وقت التوصيل',
                    value: p.deliveredCount == 0 ? '-' : '${p.avgDeliveryMinutes.toStringAsFixed(0)} دقيقة',
                  ),
                  const SizedBox(height: 12),
                  _StatCard(label: 'عدد مرات التأخير', value: '${p.delayedCount}', warning: p.delayedCount > 0),
                ],
              ),
            ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final bool warning;
  const _StatCard({required this.label, required this.value, this.warning = false});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        title: Text(label),
        trailing: Text(
          value,
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.bold,
            color: warning ? const Color(0xFFB3261E) : const Color(0xFF1E6B52),
          ),
        ),
      ),
    );
  }
}
