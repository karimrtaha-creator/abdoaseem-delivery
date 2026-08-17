import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/driver_order.dart';
import '../services/delivery_service.dart';

class ConfirmDeliveryScreen extends StatefulWidget {
  final DriverOrder order;
  const ConfirmDeliveryScreen({super.key, required this.order});

  @override
  State<ConfirmDeliveryScreen> createState() => _ConfirmDeliveryScreenState();
}

class _ConfirmDeliveryScreenState extends State<ConfirmDeliveryScreen> {
  final _deliveryService = DeliveryService();
  bool _submitting = false;
  String? _message;
  Color _messageColor = Colors.red;

  Future<void> _call(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone);
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Future<void> _confirm() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('تأكيد التسليم'),
        content: const Text('متأكد إنك سلّمت الأوردر ده للعميل؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('لأ')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('أيوه، اتسلّم')),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() {
      _submitting = true;
      _message = null;
    });
    try {
      await _deliveryService.confirmDelivery(orderId: widget.order.id);
      if (!mounted) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
    } on NoNetworkException {
      setState(() {
        _message = 'مفيش نت - اتأكد من الاتصال وحاول تاني';
        _messageColor = Colors.red;
      });
    } catch (e) {
      setState(() {
        _message = 'حصل خطأ في الاتصال بالسيرفر، حاول تاني';
        _messageColor = Colors.red;
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _customerNotFound() async {
    try {
      await _deliveryService.reportCustomerNotFound(orderId: widget.order.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اتسجلت الحالة - المدير هياخد إجراء')),
      );
    } on NoNetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('مفيش نت - البلاغ ماوصلش، حاول تاني')),
      );
    } on ComplaintNotRecordedException {
      // Never show the "تم الإبلاغ" success message here - the write
      // provably did not happen (either it threw, or it returned with no
      // row created), so the driver must be told explicitly.
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('البلاغ ماوصلش - حاول تاني أو كلم الديسباتشر')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('فشل تسجيل الحالة، حاول تاني')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تأكيد التسليم')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('اتأكد إنك سلّمت الأوردر للعميل قبل ما تدوس تأكيد', textAlign: TextAlign.center),
            if (_message != null) ...[
              const SizedBox(height: 12),
              Text(_message!, textAlign: TextAlign.center, style: TextStyle(color: _messageColor, fontWeight: FontWeight.bold)),
            ],
            const SizedBox(height: 20),
            SizedBox(
              height: 56,
              child: ElevatedButton(
                onPressed: _submitting ? null : _confirm,
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E6B52)),
                child: _submitting
                    ? const CircularProgressIndicator(color: Colors.white)
                    : const Text('تأكيد التسليم', style: TextStyle(fontSize: 18, color: Colors.white)),
              ),
            ),
            const SizedBox(height: 24),
            const Divider(),
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: _customerNotFound,
                  icon: const Icon(Icons.person_off),
                  label: const Text('العميل مش موجود'),
                ),
                OutlinedButton.icon(
                  onPressed: widget.order.customerPhone == null ? null : () => _call(widget.order.customerPhone!),
                  icon: const Icon(Icons.call),
                  label: const Text('اتصل بالعميل'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
