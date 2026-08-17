import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'profile_service.dart';

const _channel = AndroidNotificationChannel(
  'driver_alerts',
  'تنبيهات الطيار',
  description: 'أوردر جديد اتحمّل عليك أو أوردر اتلغى',
  importance: Importance.max,
  playSound: true,
);

final _localNotifications = FlutterLocalNotificationsPlugin();

/// Must be a top-level function (not a class method) - this is the entry
/// point FCM calls in a separate background isolate when a push arrives
/// while the app is backgrounded or fully killed. Android already shows
/// the system notification automatically in that case (the payload has a
/// `notification` block and AndroidManifest.xml points to the
/// `driver_alerts` channel as the default) - this handler exists so the
/// plugin has one registered at all, not to do extra work itself.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {}

/// Registers this device for push (new dispatch / staff cancellation - see
/// migration 0026 and supabase/functions/_shared/fcm.ts) and shows a
/// heads-up alert with sound while the app is open, since Android does NOT
/// auto-display a system notification for a foreground FCM message the
/// way it does in background/killed state.
class PushService {
  final _profileService = ProfileService();

  Future<void> init() async {
    await _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_channel);
    await _localNotifications.initialize(
      const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')),
    );

    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(alert: true, badge: true, sound: true);

    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    FirebaseMessaging.onMessage.listen(_showForegroundNotification);

    await _registerToken();
    messaging.onTokenRefresh.listen((_) => _registerToken());
  }

  // init() is called un-awaited from main.dart (right after a driver logs
  // in) - a transient failure here (e.g. spotty mobile data at the start
  // of a shift) used to just become an unhandled Future error with no
  // retry, silently leaving fcm_token null/stale until FCM's own
  // onTokenRefresh happens to fire again (which can be days), meaning the
  // driver gets zero "new order" pushes for the rest of the shift. A few
  // quick retries covers the common transient case without needing a full
  // background job.
  Future<void> _registerToken() async {
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final token = await FirebaseMessaging.instance.getToken();
        if (token != null) await _profileService.saveFcmToken(token);
        return;
      } catch (e) {
        debugPrint('PushService: failed to register FCM token (attempt ${attempt + 1}/3): $e');
        if (attempt < 2) await Future.delayed(Duration(seconds: 2 * (attempt + 1)));
      }
    }
  }

  void _showForegroundNotification(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;
    _localNotifications.show(
      notification.hashCode,
      notification.title,
      notification.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.max,
          priority: Priority.high,
          color: const Color(0xFF1E6B52),
        ),
      ),
    );
  }
}
