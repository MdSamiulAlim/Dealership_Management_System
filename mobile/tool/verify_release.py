#!/usr/bin/env python3
"""Verify update identity, signatures and Android 16 KB alignment before handoff."""
from pathlib import Path
import hashlib,json,os,re,shutil,struct,subprocess
mobile=Path(__file__).resolve().parents[1]
root=mobile.parent
version,code=re.search(r'^version:\s*([^+\s]+)\+(\d+)',(mobile/'pubspec.yaml').read_text(),re.M).groups()
code=int(code)
sdk=Path(os.environ.get('ANDROID_HOME','/tmp/dealership-android-sdk'))
bin=sdk/'build-tools/36.0.0'
release=root/'releases'
evidence=release/f'flutter-v{version}-build-evidence'
evidence.mkdir(parents=True,exist_ok=True)
baseline=json.loads((release/'Arafat-Traders-Flutter-v3.0.3-verification.json').read_text())
certificate=baseline['certificate_sha256']
assert code>baseline['version_code']
report={'version':version,'version_code':code,'package':'com.samiul.akijdealership','min_android_api':24,'certificate_sha256':certificate,'physical_device_tested':False,'artifacts':[]}
for abi,label in [('arm64-v8a','arm64'),('armeabi-v7a','armv7'),('x86_64','x86_64')]:
    apk=mobile/f'build/app/outputs/flutter-apk/app-{abi}-release.apk'
    signature=subprocess.check_output([str(bin/'apksigner'),'verify','--verbose','--print-certs',str(apk)],text=True)
    assert certificate in signature and 'v2 scheme (APK Signature Scheme v2): true' in signature
    manifest=subprocess.check_output([str(bin/'aapt'),'dump','badging',str(apk)],text=True)
    assert f"name='{report['package']}' versionCode='{code}' versionName='{version}'" in manifest
    assert "sdkVersion:'24'" in manifest and f"native-code: '{abi}'" in manifest
    subprocess.run([str(bin/'zipalign'),'-c','-P','16','4',str(apk)],check=True,capture_output=True)
    import zipfile
    libraries=[]
    with zipfile.ZipFile(apk) as z:
        assert z.testzip() is None
        names=z.namelist()
        assert any(n.endswith('libapp.so') for n in names) and any(n.endswith('libflutter.so') for n in names)
        assert not any(n.endswith(('.p12','.jks','.keystore','.html','.js')) for n in names)
        for name in names:
            if not name.endswith('.so'):continue
            data=z.read(name)
            if data[4]!=2:continue
            phoff=struct.unpack_from('<Q',data,32)[0]
            stride,count=struct.unpack_from('<HH',data,54)
            aligns=[struct.unpack_from('<Q',data,phoff+i*stride+48)[0] for i in range(count) if struct.unpack_from('<I',data,phoff+i*stride)[0]==1]
            assert aligns and min(aligns)>=16384,(name,aligns)
            libraries.append({'path':name,'minimum_load_alignment':min(aligns)})
    target=release/f'Arafat-Traders-Flutter-v{version}-{label}.apk'
    shutil.copy2(apk,target)
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.apk.sha256').write_text(f'{digest}  {target.name}\n')
    (evidence/f'{label}-signature.txt').write_text(signature)
    (evidence/f'{label}-manifest.txt').write_text(manifest)
    report['artifacts'].append({'file':target.name,'abi':abi,'bytes':target.stat().st_size,'sha256':digest,'signature_verified':True,'zip_16kb_alignment':True,'elf_64bit_libraries':libraries})
    print('Verified:',target.name,target.stat().st_size,'bytes',flush=True)
report['source_sha256']=hashlib.sha256(b''.join(p.relative_to(mobile).as_posix().encode()+b'\0'+p.read_bytes() for p in sorted((mobile/'lib').rglob('*.dart')))).hexdigest()
report['pubspec_lock_sha256']=hashlib.sha256((mobile/'pubspec.lock').read_bytes()).hexdigest()
log_prefix=os.environ.get('ARAFAT_RELEASE_LOG_PREFIX','/tmp/arafat-'+version.replace('.',''))
for name,filename in [('analyzer',log_prefix+'-analyze.log'),('tests',log_prefix+'-tests.log'),('build',log_prefix+'-build.log')]:
    log=Path(filename)
    if log.exists():
        shutil.copy2(log,evidence/f'{name}.log')
        if name=='analyzer':
            assert 'No issues found' in log.read_text()
            report['analyzer']='No issues found'
        elif name=='tests':
            match=re.search(r'\+(\d+): All tests passed!',log.read_text())
            assert match,'Flutter test suite did not complete successfully'
            report['tests_passed']=int(match.group(1))
(release/f'Arafat-Traders-Flutter-v{version}-verification.json').write_text(json.dumps(report,indent=2)+'\n')
