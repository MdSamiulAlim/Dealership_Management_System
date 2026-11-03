// Run with: flutter test tool/generate_icons.dart
// Resizes the supplied brand image into platform icon slots; creates no new art.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'generate platform icons from the supplied Arafat Traders icon',
    () async {
      final source = await File(
        'assets/brand/arafat-app-icon.png',
      ).readAsBytes();
      Future<void> write(String path, int size) async {
        final codec = await ui.instantiateImageCodec(
              source,
              targetWidth: size,
              targetHeight: size,
            ),
            frame = await codec.getNextFrame(),
            data = await frame.image.toByteData(format: ui.ImageByteFormat.png);
        await File(path).writeAsBytes(data!.buffer.asUint8List());
        frame.image.dispose();
        codec.dispose();
      }

      for (final entry in {
        'mdpi': 48,
        'hdpi': 72,
        'xhdpi': 96,
        'xxhdpi': 144,
        'xxxhdpi': 192,
      }.entries) {
        await write(
          'android/app/src/main/res/mipmap-${entry.key}/ic_launcher.png',
          entry.value,
        );
      }
      final folder = 'ios/Runner/Assets.xcassets/AppIcon.appiconset',
          config =
              jsonDecode(await File('$folder/Contents.json').readAsString())
                  as Map<String, dynamic>;
      for (final image in config['images'] as List) {
        final size = double.parse((image['size'] as String).split('x').first),
            scale = double.parse(
              (image['scale'] as String).replaceAll('x', ''),
            );
        await write('$folder/${image['filename']}', (size * scale).round());
      }
    },
  );
}
