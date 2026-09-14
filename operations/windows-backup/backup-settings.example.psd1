@{
    RemoteHost = 'coloradotraffictracker.net'
    RemoteUser = 'ctt-backup'
    RemoteBackupDirectory = '/var/backups/colorado-traffic-tracker/database'
    RemoteReceiptCommand = '/opt/colorado-traffic-tracker/scripts/backups/record-offsite-backup.sh'
    SshKeyPath = '%USERPROFILE%\.ssh\colorado-traffic-backup'
    DestinationDirectory = 'D:\ColoradoTrafficTracker\database-backups'
}
