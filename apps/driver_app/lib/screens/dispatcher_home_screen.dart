import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/auth_service.dart';
import '../services/dispatcher_service.dart';
import '../services/receipt_ocr_service.dart';

/// Mandatory dispatcher-photo gate (2026-08-11, approved design): the
/// mobile counterpart to apps/dispatcher-web/src/pages/Dispatch.tsx, now
/// with a required camera step before an order can ever reach a driver.
/// The actual enforcement lives server-side (photograph-order,
/// dispatch-order, and the hardened orders_select_driver RLS policy) -
/// this screen only has to call things in the right order; it can't
/// bypass anything even if it tried, by design.
///
/// Simplification, disclosed rather than silently dropped: Dispatch.tsx's
/// repeating audio alarm for orders stuck past the prep threshold isn't
/// ported here - this screen shows the same red highlight instead. A full
/// looping-sound alarm can be added later if wanted.
const int _prepAlertThresholdMinutes = 10;

class DispatcherHomeScreen extends StatefulWidget {
  final int branchId;
  const DispatcherHomeScreen({super.key, required this.branchId});

  @override
  State<DispatcherHomeScreen> createState() => _DispatcherHomeScreenState();
}

class _DispatcherHomeScreenState extends State<DispatcherHomeScreen> {
  final _service = DispatcherService();
  final _authService = AuthService();
  StreamSubscription<List<QueuedOrder>>? _sub;
  Timer? _tickTimer;
  List<QueuedOrder> _orders = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _sub = _service.queueStream(widget.branchId).listen((orders) {
      setState(() {
        _orders = orders;
        _loading = false;
      });
    });
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

  bool _isPastThreshold(QueuedOrder o) {
    if (o.acceptedAt == null) return false;
    return DateTime.now().difference(o.acceptedAt!) > const Duration(minutes: _prepAlertThresholdMinutes);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('طابور التجهيز - ديسباتشر'),
        actions: [
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
              ? const Center(child: Text('مفيش أوردرات في الطابور دلوقتي', style: TextStyle(color: Colors.black54)))
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  itemCount: _orders.length,
                  itemBuilder: (context, index) {
                    final order = _orders[index];
                    final overdue = _isPastThreshold(order);
                    return Card(
                      color: overdue ? Colors.red.shade50 : null,
                      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      child: ListTile(
                        title: Text('أوردر #${order.posOrderId ?? order.id}'),
                        subtitle: Text(
                          '${order.customerPhone} - ${_statusLabel(order.status)}'
                          '${overdue ? " - متأخر" : ""}',
                          style: overdue ? const TextStyle(color: Colors.red, fontWeight: FontWeight.bold) : null,
                        ),
                        trailing: const Icon(Icons.chevron_left),
                        onTap: () => _openOrder(order),
                      ),
                    );
                  },
                ),
    );
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'preparing':
        return 'محتاج تصوير';
      case 'ready_for_driver':
        return 'اتصور - محتاج طيار';
      case 'delayed':
        return 'متأخر';
      default:
        return status;
    }
  }

  void _openOrder(QueuedOrder order) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _OrderActionScreen(branchId: widget.branchId, order: order, service: _service),
      ),
    );
  }
}

/// Two steps, but not always both needed: an already-photographed
/// ('ready_for_driver', or a 'delayed' order that was already
/// photographed before it aged out) skips straight to driver assignment -
/// the server is the source of truth for whether that's actually allowed,
/// this screen just tries the natural next step and surfaces whatever
/// error comes back rather than duplicating the server's own state logic.
class _OrderActionScreen extends StatefulWidget {
  final int branchId;
  final QueuedOrder order;
  final DispatcherService service;
  const _OrderActionScreen({required this.branchId, required this.order, required this.service});

  @override
  State<_OrderActionScreen> createState() => _OrderActionScreenState();
}

class _OrderActionScreenState extends State<_OrderActionScreen> {
  final _picker = ImagePicker();
  final _ocrService = ReceiptOcrService();
  final _feeController = TextEditingController();
  final _serviceController = TextEditingController();
  final _minutesController = TextEditingController();
  String? _selectedDriverId;
  List<ActiveDriver> _drivers = [];
  bool _photographed = false;
  bool _busy = false;
  String? _error;
  // Set once a photo is taken for a call_center order and OCR has run -
  // the dispatcher must confirm (or correct) delivery_service/
  // delivery_time_minutes here before the photo actually gets submitted.
  // Nothing uploads or reaches the server until this is confirmed.
  File? _pendingPhotoFile;
  String? _ocrRawTextForDebug;

  @override
  void initState() {
    super.initState();
    _photographed = widget.order.status != 'preparing';
    widget.service.activeDrivers(widget.branchId).then((drivers) {
      if (mounted) setState(() => _drivers = drivers);
    });
  }

  @override
  void dispose() {
    _ocrService.dispose();
    _feeController.dispose();
    _serviceController.dispose();
    _minutesController.dispose();
    super.dispose();
  }

  Future<void> _takePhoto() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final shot = await _picker.pickImage(source: ImageSource.camera, imageQuality: 80);
      if (shot == null) {
        setState(() => _busy = false);
        return;
      }
      final file = File(shot.path);

      if (!widget.order.needsDeliveryTimeConfirmation) {
        // Website order - already has delivery_service/delivery_time_minutes
        // from create-order, nothing to confirm here. Upload and submit
        // straight away, same as before.
        final path = await widget.service.uploadPhoto(branchId: widget.branchId, orderId: widget.order.id, file: file);
        await widget.service.photographOrder(orderId: widget.order.id, photoPath: path);
        setState(() {
          _photographed = true;
          _busy = false;
        });
        return;
      }

      // Call-center order - run OCR on the receipt, pre-fill a confirm
      // screen. Nothing is uploaded or submitted yet.
      final ocr = await _ocrService.scan(file);
      setState(() {
        _pendingPhotoFile = file;
        _ocrRawTextForDebug = ocr.rawText;
        _serviceController.text = ocr.guessedService ?? '';
        _minutesController.text = ocr.guessedMinutes?.toString() ?? '';
        _busy = false;
      });
    } on NoNetworkException {
      setState(() {
        _busy = false;
        _error = 'مفيش نت - جرب تاني';
      });
    } on DispatcherServerException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _error = 'حصل خطأ، جرب تاني';
      });
    }
  }

  /// The dispatcher's explicit confirm step for a call_center order - the
  /// only place delivery_service/delivery_time_minutes get sent to the
  /// server for this source. Required fields, validated here AND again by
  /// photograph-order server-side (never trust client validation alone).
  Future<void> _confirmDeliveryInfoAndUpload() async {
    final service = _serviceController.text.trim();
    final minutes = int.tryParse(_minutesController.text.trim());
    if (service.isEmpty) {
      setState(() => _error = 'اكتب خدمة التوصيل (أو صحّح اللي القراءة الآلية طلعته)');
      return;
    }
    if (minutes == null || minutes <= 0) {
      setState(() => _error = 'اكتب وقت التوصيل بالدقايق (رقم صحيح أكبر من صفر)');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final path = await widget.service.uploadPhoto(
        branchId: widget.branchId,
        orderId: widget.order.id,
        file: _pendingPhotoFile!,
      );
      await widget.service.photographOrder(
        orderId: widget.order.id,
        photoPath: path,
        deliveryService: service,
        deliveryTimeMinutes: minutes,
      );
      setState(() {
        _photographed = true;
        _pendingPhotoFile = null;
        _busy = false;
      });
    } on NoNetworkException {
      setState(() {
        _busy = false;
        _error = 'مفيش نت - جرب تاني';
      });
    } on DispatcherServerException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _error = 'حصل خطأ، جرب تاني';
      });
    }
  }

  Future<void> _assignDriver() async {
    if (_selectedDriverId == null) {
      setState(() => _error = 'اختار الطيار الأول');
      return;
    }
    final fee = num.tryParse(_feeController.text.trim());
    if (fee == null || fee <= 0) {
      setState(() => _error = 'اكتب سعر التوصيل');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.service.dispatchOrder(
        orderId: widget.order.id,
        driverId: _selectedDriverId!,
        deliveryFeeAfterTax: fee,
      );
      if (mounted) Navigator.of(context).pop();
    } on DispatcherServerException catch (e) {
      // Covers the real backend gate: if this order somehow reached here
      // without a photo on file (e.g. a 'delayed' order that was never
      // photographed), the server refuses and says so - fall back to the
      // photo step instead of pretending it's assignable.
      setState(() {
        _busy = false;
        _error = e.message;
        if (e.message.contains('not been photographed')) _photographed = false;
      });
    } on NoNetworkException {
      setState(() {
        _busy = false;
        _error = 'مفيش نت - جرب تاني';
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _error = 'حصل خطأ، جرب تاني';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('أوردر #${widget.order.posOrderId ?? widget.order.id}')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('العميل: ${widget.order.customerPhone}'),
            const SizedBox(height: 20),
            if (_pendingPhotoFile != null) ...[
              // Call-center order, photo taken, OCR ran - dispatcher must
              // confirm/correct before anything gets submitted.
              const Text(
                'راجع بيانات التوصيل المستخرجة من الريسيت (أو صحّحها لو غلط) قبل ما تأكّد:',
                style: TextStyle(color: Colors.orange),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _serviceController,
                decoration: const InputDecoration(labelText: 'خدمة التوصيل'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _minutesController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'وقت التوصيل (دقايق)'),
              ),
              if (_ocrRawTextForDebug != null && _ocrRawTextForDebug!.trim().isNotEmpty) ...[
                const SizedBox(height: 12),
                ExpansionTile(
                  title: const Text('النص اللي القراءة الآلية شافته في الريسيت'),
                  children: [Padding(padding: const EdgeInsets.all(8), child: Text(_ocrRawTextForDebug!))],
                ),
              ],
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: _busy ? null : _confirmDeliveryInfoAndUpload,
                child: Text(_busy ? 'جاري الرفع...' : 'تأكيد ورفع الصورة'),
              ),
            ] else if (!_photographed) ...[
              const Text('لازم تصوّر الأوردر الأول قبل ما تقدر تعيّن طيار.'),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: _busy ? null : _takePhoto,
                icon: const Icon(Icons.camera_alt),
                label: Text(_busy ? 'جاري الرفع...' : 'صوّر الأوردر'),
              ),
            ] else ...[
              const Text('الأوردر اتصوّر. اختار الطيار وحدد السعر:', style: TextStyle(color: Colors.green)),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _selectedDriverId,
                decoration: const InputDecoration(labelText: 'الطيار'),
                items: _drivers
                    .map((d) => DropdownMenuItem(value: d.id, child: Text(d.name)))
                    .toList(),
                onChanged: (v) => setState(() => _selectedDriverId = v),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _feeController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'سعر التوصيل'),
              ),
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: _busy ? null : _assignDriver,
                child: Text(_busy ? 'جاري التعيين...' : 'تأكيد الخروج للطيار'),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
          ],
        ),
      ),
    );
  }
}
