#!/usr/bin/env bash
# Nightly backup of Vivier (docs/BACKUPS.md): a logical dump of the
# database (pg_dump, custom format) and a mirror of the `cvs` bucket, both
# sent to an R2 bucket with rclone; then the dumps and the sets of
# deleted files older than the retention are pruned. Everything comes from
# the environment (GitHub Actions secrets in the scheduled workflow);
# rclone is configured through RCLONE_CONFIG_* variables so no file ever
# holds a key. No secret is printed: a missing variable is named, never
# shown. Progress goes to stderr; the last line of stdout is a one-line
# JSON report.
#
# Required:  DATABASE_URL                 Postgres connection string (session pooler, port 5432)
#            R2_ENDPOINT                  https://<account_id>.r2.cloudflarestorage.com
#            R2_BUCKET                    the backup bucket
#            R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
#            SUPABASE_S3_ENDPOINT         https://<ref>.storage.supabase.co/storage/v1/s3
#            SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY
# Optional:  SUPABASE_S3_REGION           the project's region (eu-west-1)
#            SUPABASE_S3_BUCKET           the bucket to mirror (cvs)
#            BACKUP_PREFIX                folder in the R2 bucket (vivier)
#            BACKUP_RETENTION_DAYS        how long dumps and deleted sets stay (30)
#            BACKUP_SCHEMAS               schemas dumped, space separated ("public auth")
#
# Layout in R2:
#   <prefix>/db/vivier-<stamp>.dump            one dump per run
#   <prefix>/db/vivier-<stamp>.manifest.json   what the run saw
#   <prefix>/storage/cvs/...                   mirror of the bucket
#   <prefix>/storage/deleted/<stamp>/...       what the mirror dropped at that run
set -euo pipefail

log() { printf '[backup] %s\n' "$*" >&2; }
fail() { log "error: $*"; exit 1; }

require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then fail "$name is not set (docs/BACKUPS.md)"; fi
}

for name in DATABASE_URL R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY \
  SUPABASE_S3_ENDPOINT SUPABASE_S3_ACCESS_KEY_ID SUPABASE_S3_SECRET_ACCESS_KEY; do
  require_var "$name"
done

for tool in pg_dump pg_restore rclone date mktemp stat sed; do
  command -v "$tool" > /dev/null 2>&1 || fail "$tool is not installed"
done

prefix="${BACKUP_PREFIX:-vivier}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
schemas="${BACKUP_SCHEMAS:-public auth}"
storage_bucket="${SUPABASE_S3_BUCKET:-cvs}"
case "$retention_days" in
  '' | *[!0-9]*) fail "BACKUP_RETENTION_DAYS must be a whole number of days" ;;
esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
started="$(date -u +%s)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# rclone: two remotes from the environment, an empty config file so it
# never reads (or writes) one of its own.
export RCLONE_CONFIG="$tmp/rclone.conf"
: > "$RCLONE_CONFIG"
chmod 600 "$RCLONE_CONFIG"
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_REGION=auto
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ACL=private
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_SUPA_TYPE=s3
export RCLONE_CONFIG_SUPA_PROVIDER=Other
export RCLONE_CONFIG_SUPA_ENDPOINT="$SUPABASE_S3_ENDPOINT"
export RCLONE_CONFIG_SUPA_REGION="${SUPABASE_S3_REGION:-eu-west-1}"
export RCLONE_CONFIG_SUPA_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_SUPA_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_SUPA_FORCE_PATH_STYLE=true
export RCLONE_CONFIG_SUPA_NO_CHECK_BUCKET=true

r2_db="r2:${R2_BUCKET}/${prefix}/db"
r2_storage="r2:${R2_BUCKET}/${prefix}/storage/cvs"
r2_deleted="r2:${R2_BUCKET}/${prefix}/storage/deleted"

# ---------------------------------------------------------------------
# 1. the dump
# ---------------------------------------------------------------------
dump_name="vivier-${stamp}.dump"
dump_path="$tmp/$dump_name"
schema_args=()
for schema in $schemas; do schema_args+=(--schema "$schema"); done
# Session, token and log tables of Auth are not worth restoring (and the
# fresh project has its own schema_migrations rows); the accounts
# themselves (auth.users, identities) are.
exclude_args=()
for table in auth.schema_migrations auth.audit_log_entries auth.refresh_tokens auth.sessions \
  auth.mfa_amr_claims auth.flow_state auth.one_time_tokens; do
  exclude_args+=(--exclude-table-data "$table")
done

log "dumping schemas: $schemas ($(pg_dump --version))"
PGCONNECT_TIMEOUT=30 pg_dump \
  --format=custom --compress=6 \
  --no-owner --no-privileges --no-publications --no-subscriptions \
  --no-security-labels --no-comments \
  "${schema_args[@]}" "${exclude_args[@]}" \
  --file "$dump_path" --dbname "$DATABASE_URL"
pg_restore --list "$dump_path" > /dev/null
dump_bytes="$(stat -c %s "$dump_path")"
[ "$dump_bytes" -gt 0 ] || fail "the dump is empty"
log "dump ready: $dump_name ($dump_bytes bytes)"

rclone copyto --quiet "$dump_path" "$r2_db/$dump_name"
remote_bytes="$(rclone lsjson "$r2_db/$dump_name" | sed -nE 's/.*"Size":([0-9]+).*/\1/p' | head -n 1)"
[ "${remote_bytes:-0}" = "$dump_bytes" ] || fail "the uploaded dump has ${remote_bytes:-0} bytes, expected $dump_bytes"
log "dump uploaded to $r2_db"

# ---------------------------------------------------------------------
# 2. the bucket mirror (what the mirror drops goes to a dated set)
# ---------------------------------------------------------------------
log "mirroring bucket $storage_bucket"
rclone sync --quiet --fast-list --size-only --transfers 8 --checkers 16 \
  --backup-dir "$r2_deleted/$stamp" \
  "supa:${storage_bucket}" "$r2_storage"
size_json="$(rclone size --json "$r2_storage")"
storage_objects="$(printf '%s' "$size_json" | sed -nE 's/.*"count":([0-9]+).*/\1/p' | head -n 1)"
storage_bytes="$(printf '%s' "$size_json" | sed -nE 's/.*"bytes":([0-9]+).*/\1/p' | head -n 1)"
storage_objects="${storage_objects:-0}"
storage_bytes="${storage_bytes:-0}"
log "mirror holds $storage_objects objects ($storage_bytes bytes)"

manifest_name="vivier-${stamp}.manifest.json"
printf '{"stamp":"%s","dump":"%s","dumpBytes":%s,"schemas":"%s","pgDump":"%s","storageBucket":"%s","storageObjects":%s,"storageBytes":%s}\n' \
  "$stamp" "$dump_name" "$dump_bytes" "$schemas" "$(pg_dump --version | sed 's/"//g')" \
  "$storage_bucket" "$storage_objects" "$storage_bytes" > "$tmp/$manifest_name"
rclone copyto --quiet "$tmp/$manifest_name" "$r2_db/$manifest_name"

# ---------------------------------------------------------------------
# 3. retention, by the stamp in each name (never by object modtime, which
#    rclone preserves when it moves a deleted file into its set)
# ---------------------------------------------------------------------
stamp_epoch() {
  local s="$1"
  date -u -d "${s:0:4}-${s:4:2}-${s:6:2}T${s:9:2}:${s:11:2}:${s:13:2}Z" +%s
}
cutoff=$(( $(date -u +%s) - retention_days * 86400 ))

pruned_dumps=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  if [[ "$name" =~ ^vivier-([0-9]{8}T[0-9]{6}Z)\. ]]; then
    if [ "$(stamp_epoch "${BASH_REMATCH[1]}")" -lt "$cutoff" ]; then
      rclone deletefile --quiet "$r2_db/$name"
      pruned_dumps=$((pruned_dumps + 1))
    fi
  fi
done < <(rclone lsf --files-only "$r2_db" 2> /dev/null || true)

pruned_sets=0
while IFS= read -r dir; do
  dir="${dir%/}"
  [ -n "$dir" ] || continue
  if [[ "$dir" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
    if [ "$(stamp_epoch "$dir")" -lt "$cutoff" ]; then
      rclone purge --quiet "$r2_deleted/$dir"
      pruned_sets=$((pruned_sets + 1))
    fi
  fi
done < <(rclone lsf --dirs-only "$r2_deleted" 2> /dev/null || true)
log "pruned $pruned_dumps dump(s) and $pruned_sets deleted set(s) older than $retention_days days"

# ---------------------------------------------------------------------
# 4. the report
# ---------------------------------------------------------------------
seconds=$(( $(date -u +%s) - started ))
printf '{"ok":true,"stamp":"%s","dump":"%s","dumpBytes":%s,"storageObjects":%s,"storageBytes":%s,"prunedDumps":%s,"prunedDeletedSets":%s,"retentionDays":%s,"seconds":%s}\n' \
  "$stamp" "$dump_name" "$dump_bytes" "$storage_objects" "$storage_bytes" \
  "$pruned_dumps" "$pruned_sets" "$retention_days" "$seconds"
