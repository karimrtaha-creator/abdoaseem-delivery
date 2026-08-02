import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/driver_order.dart';
import '../services/delivery_service.dart';

class OtpConfirmScreen extends StatefulWidget {
  final DriverOrder order;
  const OtpConfirmScreen({super.key, required this.order});

  @override
  State<OtpConfirmScreen> createState() => _OtpConfirmScreenState();
}

class _OtpConfirmScreenState extends State<OtpConfirmScreen> {
  final _codeController = TextEditingController();
  final _deliveryService = DeliveryService();
  bool _submitting = false;
  bool _locked = false;
  String? _message;
  Color _messageColor = Colors.red;

  Future<void> _call(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone);
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Future<void> _verify() async {
    final code = _codeController.text.trim();
    if (code.length != 6) {
      setState(() {
        _message = 'اكتب كود مكوّن من 6 أرقام';
        _messageColor = Colors.red;
      });
      return;
    }
    setState(() {
      _submitting = true;
      _message = null;
    });
    try {
      final res = await _deliveryService.verifyOtp(orderId: widget.order.id, code: code);
      if (!mounted) return;
      switch (res.result) {
        case 'delivered':
          Navigator.of(context).popUntil((route) => route.isFirst);
          break;
        case 'wrong_code':
          setState(() {
            _message = 'الكود غلط - محاولات متبقية: ${res.attemptsRemaining}';
            _messageColor = Colors.red;
          });
          break;
        case 'expired':
          setState(() {
            _message = 'الكود انتهت صلاحيته - اضغط "إعادة إرسال الكود"';
            _messageColor = Colors.orange;
          });
          break;
        case 'locked':
          setState(() {
            _locked = true;
            _message = 'تم إيقاف الكود بعد 3 محاولات غلط. اتبلغ المدير تلقائيًا.';
            _messageColor = Colors.red;
          });
          break;
      }
    } catch (e) {
      setState(() {
        _message = 'حصل خطأ، حاول تاني';
        _messageColor = Colors.red;
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _resend() async {
    setState(() => _submitting = true);
    try {
      await _deliveryService.resendOtp(orderId: widget.order.id);
      if (!mounted) return;
      setState(() {
        _locked = false;
        _message = 'اتبعت كود جديد للعميل';
        _messageColor = Colors.green;
        _codeController.clear();
      });
    } catch (e) {
      setState(() {
        _message = 'فشل إعادة الإرسال، حاول تاني';
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
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('فشل تسجيل الحالة، حاول تاني')),
      );
    }
  }

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
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
            const Text('اطلب الكود من العميل شفهيًا واكتبه هنا', textAlign: TextAlign.center),
            const SizedBox(height: 20),
            TextField(
              controller: _codeController,
              enabled: !_locked,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 32, letterSpacing: 8, fontWeight: FontWeight.bold),
              decoration: const InputDecoration(counterText: '', border: OutlineInputBorder()),
            ),
            if (_message != null) ...[
              const SizedBox(height: 12),
              Text(_message!, textAlign: TextAlign.center, style: TextStyle(color: _messageColor, fontWeight: FontWeight.bold)),
            ],
            const SizedBox(height: 20),
            SizedBox(
              height: 56,
              child: ElevatedButton(
                onPressed: _submitting || _locked ? null : _verify,
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E6B52)),
                child: _submitting
                    ? const CircularProgressIndicator(color: Colors.white)
                    : const Text('تأكيد', style: TextStyle(fontSize: 18, color: Colors.white)),
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
                  onPressed: _submitting ? null : _resend,
                  icon: const Icon(Icons.refresh),
                  label: const Text('إعادة إرسال الكود'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _call(widget.order.customerPhone),
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
