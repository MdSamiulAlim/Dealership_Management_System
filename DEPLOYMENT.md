# Mobile and laptop access over the internet

The password-protected Sites version is live at:

**https://akij-dealership-sami.tangylark256.chatgpt.site**

Use the configured User ID and password on mobile and laptop; ChatGPT sign-in
is not required. The app verifies credentials before any business database
read or write. Its shared online D1
database is independent of the original local SQLite database after migration.
The source and maintenance notes are in `online-site/`. No Render account or
personal domain is needed for this deployed version. The instructions below
describe the optional Python/Render alternative; no paid Render service was
created.

Open the same HTTPS URL on both devices. Your records live on the server, so
the laptop does not need to stay on. The existing responsive web interface works
in Android/iPhone and laptop browsers. A signed Android APK is also available
through `/install.html`; its source and build instructions are in `android/`.

## Render setup

1. Connect a Render account and put the source in an accessible repository.
   Keep credentials, `data/dealership.db`, and backups out of source control.
2. Review and approve the current cost of a web service with a persistent disk.
   The supplied `render.yaml` selects the Starter plan and a 1 GB disk. Do not
   substitute an ephemeral/free disk for the business database.
3. Create a Blueprint from the repository's `render.yaml`.
4. Set the secret `DEALERSHIP_PASSWORD` to a unique password of at least 12
   characters in the hosting dashboard. The default username is `admin`; change
   `DEALERSHIP_USERNAME` if desired. Do not place the password in the repository.
5. Wait for `/healthz` to pass. Open the service's HTTPS URL and enter the login
   in the browser prompt. Repeat on the other device using the same URL/login.
6. For an existing business database, migrate it before entering new cloud
   records, following the next section. A fresh deployment initially contains
   the seeded products and Cash Customer, without your local sales/customers.

The persistent disk is `/var/data`, and the database is
`/var/data/dealership.db`. Deploy **one instance** using the supplied Gunicorn
configuration; separate SQLite disks would not share records. Cloud startup
does not run the optional website/OCR sync. Use the existing Sync Akij button
when required.

The configuration does not create a service or incur charges on its own.
An account/repository connection and approval of the hosting cost are still
needed to deploy. A personal domain is optional.

## Move existing records safely

1. Pause new entries on the local app while moving to the cloud.
2. Create a consistent SQLite backup:

   ```bash
   python3 backup_database.py
   ```

   The script prints the backup's path. Keep it private.
3. Stop the cloud app before replacing its database. Through the host's secure
   administration/file-transfer facilities, back up any existing cloud database
   and transfer the local backup to the persistent disk as `dealership.db`.
   Do not upload it into a public repository or a public static directory.
4. Restart the service. Product-price seeding is idempotent; saved rates and
   records remain intact. Compare customer balances and sales with the local
   backup before resuming entries.
5. From then on, enter records through the hosted URL on both devices. The old
   local database is a separate copy and does not synchronize with the cloud.

Use the in-app Export button for JSON snapshots. Also keep regular full SQLite
backups using `backup_database.py` on the server, and store copies away from
that server. It reads `DEALERSHIP_DATA_DIR` just like the app.

## Other Python hosts or a VPS

Use Python 3.10+ and configure these environment variables:

| Variable | Value |
| --- | --- |
| `DEALERSHIP_DATA_DIR` | Absolute path to durable writable storage |
| `DEALERSHIP_USERNAME` | Owner login; default `admin` |
| `DEALERSHIP_PASSWORD` | Secret password, at least 12 characters |
| `PORT` | Internal HTTP port, default `8000` |
| `TZ` | `Asia/Dhaka` |
| `DEALERSHIP_PUBLIC_ORIGIN` | Optional exact public origin, e.g. `https://feed.example.com` |

```bash
python3 -m pip install -r requirements.txt
gunicorn --config gunicorn.conf.py 'wsgi:create_application()'
```

Run Gunicorn behind the host's HTTPS proxy with automatic restart. On a VPS,
keep Gunicorn's port private to the proxy; only HTTPS should be publicly
reachable. The built-in `python3 app.py` server is for local use.

Production refuses to start without a login. Business pages, assets, export,
and all data APIs require it. `/healthz` only returns a status for the host.
Cross-origin browser changes are rejected, responses are not cached, and
repeated invalid credentials are temporarily limited. The database reset API
is disabled by default. A password change requires a service restart and makes
the old login invalid on both devices. This version has one shared owner login,
without separate employee roles. To finish a session, close the browser's
private window; native browser login prompts do not provide an in-app logout.

On an HTTPS deployment, mobile browsers may offer “Add to Home screen” for a
shortcut. Browser access works independently of whether that option appears.

Provider references: [Blueprint configuration](https://render.com/docs/blueprint-spec),
[persistent storage](https://render.com/docs/disks).
