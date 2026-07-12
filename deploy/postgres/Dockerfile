FROM postgres:17-alpine

COPY deploy/postgres/backup.sh /usr/local/bin/stemegle-backup
COPY deploy/postgres/backup-loop.sh /usr/local/bin/stemegle-backup-loop
COPY deploy/postgres/backup-health.sh /usr/local/bin/stemegle-backup-health
COPY deploy/postgres/restore.sh /usr/local/bin/stemegle-restore

RUN chmod 0755 \
  /usr/local/bin/stemegle-backup \
  /usr/local/bin/stemegle-backup-loop \
  /usr/local/bin/stemegle-backup-health \
  /usr/local/bin/stemegle-restore

ENTRYPOINT ["/usr/local/bin/stemegle-backup-loop"]
CMD []
