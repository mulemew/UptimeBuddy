# Custom Postgres image: vanilla postgres:16 + logical replication enabled.
# The supabase/postgres image is also a valid choice, but this slim variant is
# enough for UptimeBuddy (no pgsodium/vault required).
FROM postgres:16-alpine

# Migrations and bootstrap script run alphabetically.
# 00-init.sql defines roles/extensions/publication; subsequent files are the
# real app migrations (mounted in via docker-compose).
COPY 00-init.sql /docker-entrypoint-initdb.d/00-init.sql

# Enable logical replication for Supabase Realtime
RUN echo "wal_level=logical" >> /usr/local/share/postgresql/postgresql.conf.sample \
 && echo "max_replication_slots=10" >> /usr/local/share/postgresql/postgresql.conf.sample \
 && echo "max_wal_senders=10" >> /usr/local/share/postgresql/postgresql.conf.sample
