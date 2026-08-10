import 'dart:async';
import 'package:geolocator/geolocator.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Live location for the dispatcher/team_leader/general_manager map (see
/// migration 0028) - only ever runs while the driver actually has an
/// order out for delivery (start()/stop() are driven by
/// OrdersListScreen's existing activeOrdersStream, the same one that
/// already decides what shows in "أوردراتي الحالية"). Uses geolocator's
/// built-in Android foreground-service support (AndroidSettings.
/// foregroundNotificationConfig) rather than a separate background-task
/// package - it already does exactly what's needed: keep emitting
/// positions with the screen off, backed by a persistent notification
/// Android requires for that.
class LocationTrackingService {
  StreamSubscription<Position>? _positionSub;
  bool get isTracking => _positionSub != null;

  /// Foreground ("while in use") permission is enough to START the
  /// stream, but Android silently stops delivering updates the moment the
  /// app backgrounds unless "Allow all the time" was granted too - that
  /// can only be requested as a *second*, separate step (Android refuses
  /// to grant background + foreground in one dialog), so this always
  /// tries for it, but never blocks tracking on the driver saying yes.
  Future<void> ensurePermissions() async {
    if (!await Geolocator.isLocationServiceEnabled()) return;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.whileInUse) {
      // Second step - on Android 11+ this opens the system permission
      // screen directly (no custom UI needed), same call as the first.
      await Geolocator.requestPermission();
    }
  }

  Future<void> start() async {
    if (isTracking) return;
    if (!await Geolocator.isLocationServiceEnabled()) return;
    final permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return;

    final settings = AndroidSettings(
      accuracy: LocationAccuracy.high,
      intervalDuration: const Duration(seconds: 20),
      foregroundNotificationConfig: const ForegroundNotificationConfig(
        notificationTitle: 'التوصيل شغال',
        notificationText: 'بيتابع موقعك عشان الديسباتشر يشوف مكانك أثناء التوصيل',
        enableWakeLock: true,
        setOngoing: true,
      ),
    );

    _positionSub = Geolocator.getPositionStream(locationSettings: settings).listen(
      (position) => _pushLocation(position),
      onError: (_) {},
    );
  }

  Future<void> stop() async {
    await _positionSub?.cancel();
    _positionSub = null;
  }

  Future<void> _pushLocation(Position position) async {
    final uid = Supabase.instance.client.auth.currentUser?.id;
    if (uid == null) return;
    try {
      await Supabase.instance.client.from('users').update({
        'current_lat': position.latitude,
        'current_lng': position.longitude,
        'location_updated_at': DateTime.now().toUtc().toIso8601String(),
      }).eq('id', uid);
    } catch (_) {
      // Best-effort - a dropped location update isn't worth surfacing to
      // the driver mid-delivery, same reasoning as sendDriverPush's
      // swallow-and-log approach server-side.
    }
  }
}
