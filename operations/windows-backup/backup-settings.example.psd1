@{
    RemoteHost = 'coloradotraffictracker.net'
    RemoteUser = 'ctt-backup'
    RemoteBackupDirectory = '/var/backups/colorado-traffic-tracker/database'
    RemoteReceiptCommand = '/opt/colorado-traffic-tracker/scripts/backups/record-offsite-backup.sh'
    SshKeyPath = '%USERPROFILE%\.ssh\colorado-traffic-backup'
    DestinationDirectory = 'D:\ColoradoTrafficTracker\database-backups'
    # Use a current PostgreSQL client capable of reading the server's dump format.
    PgRestorePath = 'C:\path\to\postgresql\bin\pg_restore.exe'
}
