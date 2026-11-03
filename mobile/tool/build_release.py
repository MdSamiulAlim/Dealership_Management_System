#!/usr/bin/env python3
"""Build update-compatible Flutter APKs without putting signing secrets in source."""
import json, os, pathlib, subprocess, sys
mobile = pathlib.Path(__file__).resolve().parents[1]
private = mobile.parent / 'private-signing'
credentials = json.loads((private / 'signing.json').read_text())
env = dict(os.environ, ARAFAT_KEYSTORE=str(private / 'release-keystore.p12'),
           ARAFAT_SIGNING_PASSWORD=credentials['password'], ARAFAT_SIGNING_ALIAS=credentials['alias'],
           DASH__SUPPRESS_ANALYTICS='true')
flutter = env.get('FLUTTER_BIN', 'flutter')
subprocess.run([flutter, 'build', 'apk', '--release', '--split-per-abi', *sys.argv[1:]], cwd=mobile, env=env, check=True)
