import 'dart:io';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

/// Call-center receipt OCR (2026-08-11): on-device, free, offline-capable
/// (Google ML Kit's default Latin text recognizer - no server-side OCR
/// service, no per-request cost).
///
/// Disclosed limitation, not hidden: ML Kit's default/Latin recognizer
/// reliably reads Latin-script text and digits, but has weak-to-no support
/// for Arabic script. If the branch's printed receipts label the delivery
/// service line in Arabic, automatic extraction will likely miss it often
/// or every time - numbers/times printed in Latin numerals may still be
/// picked up even when the surrounding Arabic label isn't. This is exactly
/// why the manual-entry fallback below is mandatory, not an edge case:
/// the dispatcher always sees and can edit whatever was found (or nothing)
/// before confirming - nothing here ever auto-submits without that
/// confirmation step.
class ReceiptOcrResult {
  final String rawText;
  final String? guessedService;
  final int? guessedMinutes;
  ReceiptOcrResult({required this.rawText, required this.guessedService, required this.guessedMinutes});
}

class ReceiptOcrService {
  final _recognizer = TextRecognizer(script: TextRecognitionScript.latin);

  Future<ReceiptOcrResult> scan(File imageFile) async {
    final input = InputImage.fromFile(imageFile);
    final result = await _recognizer.processImage(input);
    final lines = result.blocks.expand((b) => b.lines).map((l) => l.text).toList();

    String? guessedService;
    int? guessedMinutes;

    // Look for a delivery-service line first ("توصيل"/"delivery"/"service"
    // - whichever fragment ML Kit actually managed to read), then pull the
    // first number-plus-minutes-unit pattern from anywhere in the receipt,
    // preferring one that's on or near that same line.
    final serviceLineIndex = lines.indexWhere(
      (l) => l.toLowerCase().contains('delivery') || l.toLowerCase().contains('service') || l.contains('توصيل') || l.contains('خدمة'),
    );
    if (serviceLineIndex != -1) {
      guessedService = lines[serviceLineIndex].trim();
    }

    final minutePattern = RegExp(r'(\d{1,3})\s*(?:min|mins|minute|minutes|دقيقة|دقايق|د)\b', caseSensitive: false);
    // Search the service line itself first, then fall back to the whole receipt.
    final searchOrder = [
      if (serviceLineIndex != -1) lines[serviceLineIndex],
      ...lines,
    ];
    for (final line in searchOrder) {
      final match = minutePattern.firstMatch(line);
      if (match != null) {
        guessedMinutes = int.tryParse(match.group(1)!);
        if (guessedMinutes != null) break;
      }
    }

    return ReceiptOcrResult(
      rawText: lines.join('\n'),
      guessedService: guessedService,
      guessedMinutes: guessedMinutes,
    );
  }

  void dispose() => _recognizer.close();
}
