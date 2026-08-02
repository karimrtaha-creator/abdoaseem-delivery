import 'package:flutter/material.dart';
import '../models/driver_order.dart';

class OrderCard extends StatelessWidget {
  final DriverOrder order;
  final VoidCallback onTap;

  const OrderCard({super.key, required this.order, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final overdue = order.isOverdueNow;
    final remaining = order.remaining;
    final color = overdue ? const Color(0xFFB3261E) : const Color(0xFF1E6B52);

    String timeLabel;
    if (remaining == null) {
      timeLabel = '--';
    } else if (overdue) {
      final over = remaining.abs();
      timeLabel = 'متأخر ${over.inMinutes} د';
    } else {
      timeLabel = 'متبقي ${remaining.inMinutes} د';
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      color: color.withOpacity(0.08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: color, width: 1.5),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(backgroundColor: color, child: const Icon(Icons.receipt_long, color: Colors.white)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('أوردر #${order.posOrderId ?? order.id}',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 4),
                    Text(order.customerPhone, style: const TextStyle(color: Colors.black54)),
                  ],
                ),
              ),
              Text(timeLabel, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 15)),
            ],
          ),
        ),
      ),
    );
  }
}
