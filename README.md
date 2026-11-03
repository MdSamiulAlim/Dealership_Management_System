# Arafat Traders — Dealership Management

Dedicated Flutter mobile client, shared online web app, and the separate local Python app.

## Mobile: Flutter

Mobile source: [mobile/README.md](mobile/README.md). All dealership screens are Flutter Material Design 3 widgets, with Bengali/English, encrypted offline work, incremental server sync, native invoice PDFs and the existing Admin/General accounts. Android 7.0 or newer is required.

Before replacing the previous APK, finish Sync on every device and export an encrypted device backup. Update over the previous app; do not uninstall or clear data. Server records load after online login. The previous app's unsynced local records require encrypted backup import. See [migration instructions in Bengali](mobile/MIGRATION_BN.md).

The retired root `android/` was the Java/WebView client. Flutter's `mobile/android/` is its required platform build runner. The owner's original update-signing key is kept privately in `private-signing/`, excluded from source archives and version control.

## Web: mobile and laptop

Open **https://akij-dealership-sami.subscription-cellosc.chatgpt.site** and enter your configured User ID/password in the app login screen. ChatGPT sign-in is not required. Web and Flutter use the same server accounts, stock and financial records. The laptop can be switched off while phones use the hosted app. Web source is in `online-site/`; the original Python local database remains separate.

## What is included

- Dashboard: today's sales, orders, current stock, received amount, customer due, company payable, cash/bank balance, low stock alert
- Company Feed Order: pending, confirmed, delivered orders with challan and delivery date
- Stock Management: opening stock, delivered company order, sales deduction, return, damage/loss, manual adjustment
- Daily Sales: customer, product, quantity, rate, paid, due
- Customer Management: opening due, total purchase, total paid, current due
- Money: customer payment received, company payment, expense, transport cost, other income/expense, cash/bank balance
- Reports: daily, monthly, product-wise, customer-wise, stock, due/outstanding, company order, cash/bank
- Product dropdown: official Akij Feed shop product list seeded on startup
- Packet codes: numeric/printed packet-side codes are seeded where confirmed and editable in Stock Management
- Products are organized as Fish feed, Cattle feed and Poultry feed. Names, codes, feed size, protein and pack size follow the supplied catalog; prices are entered and changed by the owner.

## Local cash/bank transfers

Bank Deposit moves funds from Cash to Bank; Bank Withdraw moves funds from Bank
to Cash. One request saves a linked debit/credit pair atomically. Deleting either
entry removes the full transfer. On startup, the database upgrade links existing
matching pairs and creates a missing counterpart once. The upgrade is transactional;
product lists and other business records are retained.

## Run locally

```bash
cd /home/sami/Downloads/Dealership_Management_System
python3 app.py --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000
```


## Smartphone access

Create the owner's login (password: at least 12 characters), then run the app
on the computer/server with LAN access enabled:

```bash
python3 configure_access.py
python3 app.py --host 0.0.0.0 --port 8000
```

Then connect the smartphone to the same WiFi/network and open:

```text
http://COMPUTER_IP:8000
```

On Android Chrome, use menu -> Add to Home screen for app-like access. On iPhone Safari, use Share -> Add to Home Screen. The app still stays online/server-based; business data is saved on the server database, not in phone storage.
The browser asks for your username and password. Keep the laptop running for
this local-network setup. Restart the app after changing the login.

## Use from anywhere on mobile and laptop

The app is prepared for HTTPS hosting with password access and a persistent
SQLite disk. Both devices open the same hosted URL and use the same records;
the laptop can be switched off. An Android APK is not needed for browser access.
See [DEPLOYMENT.md](DEPLOYMENT.md) for setup and migrating the existing database.

Production start command (after installing `requirements.txt` and configuring
`DEALERSHIP_PASSWORD` and `DEALERSHIP_DATA_DIR`):

```bash
gunicorn --config gunicorn.conf.py 'wsgi:create_application()'
```

`render.yaml` configures one web service and a persistent disk. This requires a
paid hosting plan; review the provider's current price before creating it.
The Render alternative needs a connected hosting account and an accessible
source repository. No Render service has been created; the live password-protected app
above is hosted with Sites instead.


## Data

The database is created automatically at:

```text
data/dealership.db
```

Set `DEALERSHIP_DATA_DIR` to use another directory, such as the host's persistent
disk. The bundled product-price CSV stays in the source `data/` directory.

Use the `Export` button for JSON backup. Keep a regular copy of `data/dealership.db` for full backup.

The supplied fish feed price list is effective August 7, 2025. Its transcription
is saved in `data/akij_fish_prices_2025-08-07.csv`, including both per-kg and per-bag
MRP. The app imports it once on startup, preserving existing nonzero rates and
later manual edits. Sales and company orders use the per-bag default rate.
Generic shop products without an unambiguous printed-code/pack-size match keep
their existing rates; select the specific coded product to use a listed price.

## Notes

This version intentionally does not use browser localStorage or offline mode. All records are saved through the backend API into the server-side SQLite database.

## Akij product code sync

Use `Stock Management -> Sync Akij` to fetch the current Akij product list. If Tesseract OCR with Bengali language support is installed on the server, the app reads packet-side `কোড-###` text from product images and updates product codes automatically. Confirmed known codes, such as Broiler Grower `102`, are seeded even without OCR.

Ubuntu/Debian OCR install example:

```bash
sudo apt install tesseract-ocr tesseract-ocr-ben
```

## Verification

```bash
python3 -m unittest -v test_online
```

These checks use temporary databases and exercise the production WSGI routes,
login protection, price seeding, saving/restarting, and shared server records.
