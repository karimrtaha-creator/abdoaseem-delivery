# abdoaseem_driver

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Release signing (required before distributing to real drivers)

Release builds currently fall back to the debug keystore if no release
signing key is configured - fine for local testing, **not safe to hand out
to drivers as-is** (the debug keystore is a shared, publicly-known key, not
a real production identity for this app).

One-time setup:

```bash
keytool -genkey -v -keystore ~/abdoaseem-driver-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias abdoaseem_driver
```

You'll be prompted for a store password and a key password - **write these
down somewhere safe** (a password manager). If this keystore or its
password is ever lost, you will not be able to publish an update to an
already-installed app under the same identity; drivers would need to
uninstall and reinstall from scratch.

Then create `android/key.properties` (already gitignored - never commit
this file) with:

```
storePassword=<store password>
keyPassword=<key password>
keyAlias=abdoaseem_driver
storeFile=/full/path/to/abdoaseem-driver-release.jks
```

`flutter build apk --release` will then sign with this key automatically.
