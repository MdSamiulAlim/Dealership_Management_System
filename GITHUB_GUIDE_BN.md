# GitHub-এ সম্পূর্ণ project push

প্রস্তুত repository: `MdSamiulAlim/Dealership_Management_System`

এই directory-তে Flutter mobile (`mobile/`), web/backend (`online-site/`),
Python local app, assets, tests, dependency lockfiles, database migrations এবং
build/hosting instructions আছে। Flutter 3.0.4+10 ও live web Version 56-এর source
থেকে কপি করা হয়েছে। মূল project বা live app পরিবর্তন করা হয়নি।

## Push

GitHub account দিয়ে এই কম্পিউটারে Git authentication সম্পন্ন করে চালান:

```bash
cd /home/sami/Downloads/Dealership_Management_System/releases/github/Dealership_Management_System
git push -u origin main
```

GitHub account-এর password দিয়ে Git HTTPS push করা যায় না। আগে GitHub CLI
বা Git Credential Manager-এ sign in করতে পারেন। GitHub CLI আগে থেকেই থাকলে:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
git push -u origin main
```

অথবা GitHub Desktop-এ `File → Add local repository` থেকে এই directory যোগ
করে account sign in করে `Publish branch`/`Push origin` ব্যবহার করুন।
কোনো password/token chat-এ বা source code-এ লিখবেন না।

Remote-এ অন্য কেউ meantime commit করলে force push করবেন না; আগে পরিবর্তন
পর্যালোচনা করুন। GitHub-এ push করলে live hosting নিজে থেকে বদলাবে না।

## কী রাখা হয়েছে

- `mobile/`: dedicated Flutter Material Design 3 UI, tests, assets, Android/iOS runners এবং Gradle wrapper।
- `online-site/`: বর্তমান web/backend-এর সব tracked file; hosting bindings/config ও SQL migrations।
- Root Python app, static files, public product CSV এবং local-app tests।
- `releases/`: build verification-এর certificate baseline JSON এবং release instructions।
- `SOURCE_MANIFEST.json`: কপি করা প্রতিটি source file-এর SHA-256।

Signing key/password, session/config secrets, local business database/backups,
customer records, node_modules, SDK, build caches এবং বড় generated release
packages কপি করা হয়নি। বর্তমান APK/source ZIP মূল project-এর `releases/`-এ
রয়েছে। Web-এর tracked public download files source-এর অংশ হিসেবে রাখা হয়েছে।

Original update-signing key ছাড়া existing APK-র compatible release update বানানো
যাবে না; key আলাদাভাবে নিরাপদে সংরক্ষণ করবেন। Web/Python-এর server secrets ও
ব্যবসার database নতুন পরিবেশে আলাদাভাবে configure/restore করতে হবে।

## Run ও verification

Flutter: `cd mobile`, তারপর `flutter pub get`, `flutter analyze`, `flutter test`।
Web: `cd online-site`, তারপর `npm run install:ci`; development/build instructions
দেখুন `online-site/README.md`। Node >=22.13.0 প্রয়োজন।
Python: root-এ `pip install -r requirements.txt`; তারপর
`python3 -m unittest -v test_online test_access_concurrency`। নতুন local login
তৈরি করতে `python3 configure_access.py` ব্যবহার করুন।

Flutter release build/verification-এর জন্য `mobile/README.md` পড়ুন। iOS source
আছে, কিন্তু macOS/Xcode ও Apple signing ছাড়া iOS build যাচাই করা হয়নি।

এই source ZIP-এ `.git/` history নেই। ZIP থেকে শুরু করলে (শুধু তখনই):

```bash
git init -b main
git add .
git commit -m "Import complete Arafat Traders application source"
git remote add origin https://github.com/MdSamiulAlim/Dealership_Management_System.git
git push -u origin main
```
