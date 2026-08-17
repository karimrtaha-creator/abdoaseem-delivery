import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import '../services/orders_service.dart';

// Cairo, used only as a default starting point when there's no saved
// location yet and GPS hasn't returned a fix - never saved anywhere as-is.
const _defaultCenter = LatLng(30.0444, 31.2357);

/// "Drop pin" flow: the map stays fixed, a pin icon is drawn at the center
/// of the screen, and the driver pans the map underneath it - the same
/// pattern used by most delivery apps' address pickers. Saves whatever
/// point is under the pin when the driver confirms, onto the shared
/// customer_addresses row (see migration 0005 - the driver-can-update-
/// only-location-fields RLS policy already exists for exactly this).
class LocationMapScreen extends StatefulWidget {
  final int addressId;
  final String driverId;
  final double? initialLatitude;
  final double? initialLongitude;

  const LocationMapScreen({
    super.key,
    required this.addressId,
    required this.driverId,
    this.initialLatitude,
    this.initialLongitude,
  });

  @override
  State<LocationMapScreen> createState() => _LocationMapScreenState();
}

class _LocationMapScreenState extends State<LocationMapScreen> {
  final _mapController = MapController();
  final _ordersService = OrdersService();
  late LatLng _center;
  bool _locating = false;
  bool _saving = false;
  String? _message;

  @override
  void initState() {
    super.initState();
    _center = (widget.initialLatitude != null && widget.initialLongitude != null)
        ? LatLng(widget.initialLatitude!, widget.initialLongitude!)
        : _defaultCenter;
    if (widget.initialLatitude == null) {
      // No saved pin yet for this address - go straight to the driver's
      // current GPS position instead of leaving them centered on Cairo.
      WidgetsBinding.instance.addPostFrameCallback((_) => _useCurrentLocation());
    }
  }

  Future<void> _useCurrentLocation() async {
    setState(() {
      _locating = true;
      _message = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() => _message = 'خدمة الموقع مقفولة على الجهاز - افتحها من الإعدادات');
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        setState(() => _message = 'محتاجين إذن الموقع علشان نحدد مكانك - اسمح بيه من إعدادات التطبيق');
        return;
      }
      final position = await Geolocator.getCurrentPosition();
      final point = LatLng(position.latitude, position.longitude);
      setState(() => _center = point);
      _mapController.move(point, 17);
    } catch (e) {
      setState(() => _message = 'مقدرناش نحدد موقعك دلوقتي، حاول تاني');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _message = null;
    });
    try {
      await _ordersService.saveAddressLocation(
        addressId: widget.addressId,
        latitude: _center.latitude,
        longitude: _center.longitude,
        driverId: widget.driverId,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _message = 'فشل حفظ الموقع - اتأكد من النت وحاول تاني');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.initialLatitude != null ? 'إضافة لوكيشن جديد' : 'تثبيت موقع العميل')),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: _center,
              initialZoom: widget.initialLatitude != null ? 17 : 15,
              onPositionChanged: (position, hasGesture) {
                if (hasGesture) _center = position.center;
              },
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.abdoaseem.driver_app',
              ),
              const RichAttributionWidget(
                attributions: [TextSourceAttribution('OpenStreetMap contributors')],
              ),
            ],
          ),
          const IgnorePointer(
            child: Center(
              child: Padding(
                padding: EdgeInsets.only(bottom: 36),
                child: Icon(Icons.location_pin, size: 44, color: Color(0xFFC23616)),
              ),
            ),
          ),
          const Positioned(
            top: 12,
            left: 12,
            right: 12,
            child: Card(
              child: Padding(
                padding: EdgeInsets.all(10),
                child: Text(
                  'حرّك الخريطة لحد ما الدبوس يبقى بالظبط على باب العميل، وبعدين احفظ.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13),
                ),
              ),
            ),
          ),
          if (_message != null)
            Positioned(
              bottom: 96,
              left: 12,
              right: 12,
              child: Card(
                color: Colors.red.shade50,
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Text(_message!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
                ),
              ),
            ),
          Positioned(
            bottom: 16,
            left: 16,
            right: 16,
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _locating ? null : _useCurrentLocation,
                    icon: _locating
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.my_location),
                    label: const Text('موقعي الحالي'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E6B52)),
                    onPressed: _saving ? null : _save,
                    icon: _saving
                        ? const SizedBox(
                            width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.check, color: Colors.white),
                    label: const Text('احفظ الموقع هنا', style: TextStyle(color: Colors.white)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
