import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

// supabase_flutter's own default (SharedPreferencesLocalStorage) keeps the
// session - access token, refresh token - in plain SharedPreferences, which
// on Android is an unencrypted XML file inside the app's private storage.
// Anyone with root/adb-backup access to the device (see also
// android:allowBackup, fixed alongside this in AndroidManifest.xml) could
// read a driver's session straight out of it. flutter_secure_storage backs
// this with Android's EncryptedSharedPreferences (Keystore-backed AES) /
// iOS Keychain instead, so the token is encrypted at rest on the device.
class SecureLocalStorage extends LocalStorage {
  const SecureLocalStorage();

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _key = 'sb-driver-app-auth-token';

  @override
  Future<void> initialize() async {}

  @override
  Future<bool> hasAccessToken() async => (await _storage.read(key: _key)) != null;

  @override
  Future<String?> accessToken() => _storage.read(key: _key);

  @override
  Future<void> removePersistedSession() => _storage.delete(key: _key);

  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key: _key, value: persistSessionString);
}
