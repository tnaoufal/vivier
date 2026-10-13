# Backups

What protects the data, where the copies live, how they are made, how
they are restored, and when the restore is rehearsed. Paths are relative
to `vivier/`.

## Doctrine

Two lines, different providers, different credentials:

1. **Supabase Point-in-Time Recovery (PITR)** is the primary line. On the
   Pro plan with the PITR add-on, the database's write-ahead log is
   archived continuously and the project can be restored to any second
   within the retention window (seven days by default) from the
   dashboard, in place, with no file to handle. It is the answer to a bad
   migration, a wrong bulk update, a deleted organisation: restore to the
   minute before. Without the add-on, Pro keeps daily backups for seven
   days. PITR covers the database only: Storage objects are not part of
   it, and a deleted object is gone.
2. **A nightly logical dump and a mirror of the bucket, on Cloudflare R2**,
   made by `.github/workflows/vivier-backup.yml` running
   `scripts/backup.sh` at 03:17 UTC: `pg_dump --format=custom` of the
   database through its connection string, and an `rclone sync` of the
   `cvs` bucket from Supabase Storage's S3 endpoint to the R2 bucket. This
   is the answer to what PITR does not cover: the loss of the Supabase
   project or account, an incident on their side, a file deleted by
   mistake, and a restore anywhere `pg_restore` runs.

**Retention is thirty days** (`BACKUP_RETENTION_DAYS`). Each run leaves one
dump; dumps older than thirty days are deleted. The bucket mirror tracks
the bucket: a CV erased in the product (an erasure request, the retention
purge) disappears from the mirror at the next run and is moved into a
dated "deleted set" (`storage/deleted/<stamp>/`) which is removed thirty
days later. So a file wrongly deleted can be recovered for thirty days,
and no candidate outlives their erasure by more than thirty days in any
copy (`docs/RGPD.md` says so to candidates). Pruning goes by the stamp in
each name, never by object modification time, which rclone preserves when
it moves a file.

What the dump holds: the schemas `public` (every row of every
organisation, embeddings included) and `auth` (accounts and identities,
with password hashes), without the session, token and log tables of Auth
and without Auth's own `schema_migrations`. The `storage` schema is not
dumped: the metadata rows of `storage.objects` are recreated by the S3
API when the files are uploaded again, and dumping them would collide
with that. The schema itself (tables, policies, triggers, functions, the
bucket, the realtime publication) is the migration in git, applied before
any data is restored. Dashboard settings (Auth providers, redirect URLs,
SMTP, the Worker's and Railway's variables) are not in any backup: they
are listed in `docs/GO-LIVE.md`, which is the record to recreate them.

The dump and the mirror hold personal data. The R2 bucket is private and
encrypted at rest by Cloudflare; only the token in GitHub's secrets can
read it. Client-side encryption (an rclone `crypt` remote in front of
`r2:`) is a possible hardening later; it adds a key to keep safely
outside the product.

## Layout in the R2 bucket

```
vivier/db/vivier-20261013T031700Z.dump            one dump per run (custom format, compressed)
vivier/db/vivier-20261013T031700Z.manifest.json   what the run saw: bytes, schemas, pg_dump version, object count
vivier/storage/cvs/<org_id>/<document_id>.pdf     the mirror of the bucket
vivier/storage/deleted/20261013T031700Z/...       what the mirror dropped at that run, kept thirty days
```

`BACKUP_PREFIX` changes the `vivier/` folder; one bucket can hold several
products or environments under different prefixes.

## Setup (owner)

Everything here goes in dashboards and in GitHub's secrets; nothing is
committed. Tick the lines in `docs/GO-LIVE.md` ("Backups").

1. **Supabase, PITR**: Project Settings → Add-ons → Point in Time
   Recovery (Pro plan). Note the retention window.
2. **Supabase, the connection string**: Project Settings → Database →
   Connection string → **Session pooler** (port 5432), with the database
   password, and `?sslmode=require` at the end. Not the transaction pooler
   (6543), which does not carry a `pg_dump` session; not the direct host
   unless the IPv4 add-on is on (GitHub's runners have no IPv6).
3. **Supabase, Storage S3**: Storage → Settings → S3 connection: enable
   it, note the endpoint (`https://<ref>.storage.supabase.co/storage/v1/s3`)
   and the region (the project's, e.g. `eu-west-1`), create one pair of S3
   access keys for the backup and nothing else. The keys are project-wide:
   keep them in GitHub's secrets only.
4. **Cloudflare R2**: create the bucket (e.g. `vivier-backups`) with the
   EU jurisdiction, then an R2 API token with **Object Read & Write**
   scoped to that bucket only. The endpoint is
   `https://<account_id>.r2.cloudflarestorage.com`.
5. **GitHub → Settings → Secrets and variables → Actions**, secrets:

   | Secret                                  | Value                                                        |
   | --------------------------------------- | ------------------------------------------------------------ |
   | `VIVIER_DATABASE_URL`                   | the session pooler connection string with `?sslmode=require` |
   | `VIVIER_R2_ENDPOINT`                    | `https://<account_id>.r2.cloudflarestorage.com`              |
   | `VIVIER_R2_BUCKET`                      | the bucket name                                              |
   | `VIVIER_R2_ACCESS_KEY_ID`               | the R2 token's access key id                                 |
   | `VIVIER_R2_SECRET_ACCESS_KEY`           | the R2 token's secret                                        |
   | `VIVIER_SUPABASE_S3_ENDPOINT`           | the Storage S3 endpoint                                      |
   | `VIVIER_SUPABASE_S3_ACCESS_KEY_ID`      | the Storage S3 access key id                                 |
   | `VIVIER_SUPABASE_S3_SECRET_ACCESS_KEY`  | the Storage S3 secret                                        |

   and one variable (the Variables tab): `VIVIER_SUPABASE_S3_REGION`, the
   project's region (`eu-west-1` when unset). The `VIVIER_` prefix keeps
   the names apart from the other product's secrets while both share this
   repository; after the move (`docs/EXTRACT.md`) the workflow's
   `secrets.VIVIER_*` references can keep the prefix or drop it.
6. **Run it once by hand**: Actions → Vivier backup → Run workflow. The
   job summary ends with the report, e.g.
   `{"ok":true,"stamp":"…","dump":"vivier-….dump","dumpBytes":…,"storageObjects":…,"prunedDumps":0,…}`;
   the bucket shows `vivier/db/` and `vivier/storage/cvs/`.
7. **Keep it alive**: the schedule runs only from the default branch, and
   GitHub pauses scheduled workflows after sixty days without a commit.
   A failed run emails the person who last touched the workflow; a glance
   at the Actions tab once a month confirms the nightly runs are green.

Until the secrets are set, the workflow ends in seconds with a notice
("Vivier backup skipped") and stays green.

## Running the script by hand

With `pg_dump` 17 and `rclone` installed (`brew install libpq rclone` on
macOS; the PGDG apt repository on Debian or Ubuntu, as the workflow does):

```sh
DATABASE_URL='postgresql://…?sslmode=require' \
R2_ENDPOINT='https://<account_id>.r2.cloudflarestorage.com' R2_BUCKET='vivier-backups' \
R2_ACCESS_KEY_ID='…' R2_SECRET_ACCESS_KEY='…' \
SUPABASE_S3_ENDPOINT='https://<ref>.storage.supabase.co/storage/v1/s3' SUPABASE_S3_REGION='eu-west-1' \
SUPABASE_S3_ACCESS_KEY_ID='…' SUPABASE_S3_SECRET_ACCESS_KEY='…' \
bash scripts/backup.sh
```

The script is `set -euo pipefail`, names a missing variable without
showing any value, dumps into a temporary directory removed on exit,
checks the uploaded dump's size against the local one, writes the
manifest, prunes, and prints the JSON report as its last line. Optional
variables: `SUPABASE_S3_BUCKET` (`cvs`), `BACKUP_PREFIX` (`vivier`),
`BACKUP_RETENTION_DAYS` (`30`), `BACKUP_SCHEMAS` (`public auth`; set it to
`public` if `pg_dump` is ever refused an `auth` object, and rely on PITR
for the accounts).

## Restore drill

Rehearsed **before go-live and every quarter**, on a fresh project, and
recorded in `docs/GO-LIVE.md` (date, dump stamp, time taken, what
failed). A restore that was never rehearsed is a hope, not a backup.

Two situations:

- **Something went wrong in the live project** (a bad migration, rows
  deleted by mistake): use PITR from the Supabase dashboard to the minute
  before, then check. The dump is the fallback when PITR cannot reach the
  moment needed.
- **The project is gone, or the drill**: the steps below.

1. **Get the dump**, with the same environment variables as the script
   (or an rclone config written by hand):

   ```sh
   rclone lsf r2:vivier-backups/vivier/db/            # pick the stamp
   rclone copy r2:vivier-backups/vivier/db/vivier-<stamp>.dump .
   rclone copy r2:vivier-backups/vivier/db/vivier-<stamp>.manifest.json .
   pg_restore --list vivier-<stamp>.dump | head        # the archive opens
   ```

2. **A fresh Supabase project** in the same region (Postgres 17). Apply the
   migration (`supabase link`, `supabase db push`): the schema, the
   policies, the triggers, the functions, the `cvs` bucket and the realtime
   publication now exist, empty.
3. **Restore the data, triggers and foreign keys off** for the session
   (`session_replication_role = replica`, which the `postgres` role may set
   on Supabase), accounts first, then the product:

   ```sh
   NEW_URL='postgresql://…new project, session pooler…?sslmode=require'
   pg_restore --data-only --no-owner --no-privileges --schema auth   --file auth-data.sql   vivier-<stamp>.dump
   pg_restore --data-only --no-owner --no-privileges --schema public --file public-data.sql vivier-<stamp>.dump
   psql "$NEW_URL" --single-transaction --variable ON_ERROR_STOP=1 \
     --command 'SET session_replication_role = replica' --file auth-data.sql
   psql "$NEW_URL" --single-transaction --variable ON_ERROR_STOP=1 \
     --command 'SET session_replication_role = replica' --file public-data.sql
   ```

   Replica mode keeps the audit triggers from logging the restore and the
   profile trigger from fighting the restored `profiles` rows. If the
   `auth` restore refuses a column the fresh project no longer has, restore
   `auth.users` and `auth.identities` with an explicit column list, or
   accept that people create their accounts again (the organisations and
   memberships then need their `user_id` re-mapped); this is exactly what
   the drill is for.
4. **Upload the files again** through the new project's S3 endpoint, which
   recreates the `storage.objects` rows:

   ```sh
   export RCLONE_CONFIG_NEW_TYPE=s3 RCLONE_CONFIG_NEW_PROVIDER=Other RCLONE_CONFIG_NEW_FORCE_PATH_STYLE=true \
     RCLONE_CONFIG_NEW_ENDPOINT='https://<newref>.storage.supabase.co/storage/v1/s3' RCLONE_CONFIG_NEW_REGION='eu-west-1' \
     RCLONE_CONFIG_NEW_ACCESS_KEY_ID='…' RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY='…'
   rclone sync --size-only --fast-list r2:vivier-backups/vivier/storage/cvs new:cvs
   ```

   Check: `select count(*) from storage.objects where bucket_id = 'cvs'`
   equals `select count(*) from documents`, and both match the manifest's
   `storageObjects`.
5. **Re-point the services**. Cloudflare: `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY` (build-time: trigger a redeploy),
   `SUPABASE_SERVICE_ROLE_KEY`. Railway: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`. Supabase Auth on the new project: Email and
   Google providers, the redirect allow list, the site URL, SMTP; the
   Google OAuth client's redirect URI now points at the new project ref.
   Everyone signs in again (sessions are not in the dump; passwords and
   Google links are).
6. **Verify end to end**: sign in, open a profile and its CV (the signed
   URL answers: Storage is back), run a search for a brief (the
   `embedding` columns restored: the method reads `hybrid` when a model is
   set up), open a shortlist board, `/status` all green, counts per table
   against the manifest.
7. **Record** the drill in `docs/GO-LIVE.md`, then delete the drill
   project (or keep it as a standby if the cost is accepted). For a real
   restore, update the backup secrets to the new project's connection
   string and S3 keys so the next night's run backs up the right project.

## Monitoring

- A failed run turns the workflow red and GitHub emails the owner of the
  run; the summary of a green run shows the report.
- The report's `storageObjects` should move with `documents` rows and
  never drop sharply; `prunedDeletedSets` is normally 0 or 1.
- Supabase: Project Settings → Add-ons shows PITR on and its retention;
  the dashboard's Backups page lists what can be restored.
