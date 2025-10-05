#!/bin/bash
# Backup thread data from Coolify volume

BACKUP_DIR="/backups/drose-threads"
VOLUME_PATH="/var/lib/docker/volumes/zgk0skw48ow8ook4kww4wkow_threads-data/_data"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p $BACKUP_DIR

# Create backup
tar -czf "$BACKUP_DIR/threads-$TIMESTAMP.tar.gz" -C "$VOLUME_PATH" .

# Keep only last 30 backups
cd $BACKUP_DIR && ls -t threads-*.tar.gz | tail -n +31 | xargs -r rm

echo "✓ Backup complete: $BACKUP_DIR/threads-$TIMESTAMP.tar.gz"
echo "$(ls -lh $BACKUP_DIR/threads-$TIMESTAMP.tar.gz)"
