function Read-TrafficDataRange {
    param([IO.TextReader]$Reader)
    $seen = @{}
    $column = -1
    $first = [DateTimeOffset]::MaxValue
    $last = [DateTimeOffset]::MinValue
    $count = 0L
    while ($null -ne ($line = $Reader.ReadLine())) {
        if ($column -ge 0) {
            if ($line -ceq '\.') { $column = -1; continue }
            $fields = $line.Split([char]9)
            if ($column -ge $fields.Length -or $fields[$column] -notmatch '[+-][0-9]{2}(:[0-9]{2})?$') {
                throw 'Missing or unsupported polled_at in traffic COPY data.'
            }
            $at = [DateTimeOffset]::Parse($fields[$column], [Globalization.CultureInfo]::InvariantCulture)
            if ($at -lt $first) { $first = $at }
            if ($at -gt $last) { $last = $at }
            $count++
        } elseif ($line -match '^COPY public\.(traffic_sample(?:_archive)?) \((.+)\) FROM stdin;$') {
            $table = $Matches[1]
            $column = [Array]::IndexOf(($Matches[2] -split ', '), 'polled_at')
            if ($column -lt 0 -or $seen.ContainsKey($table)) { throw 'Unexpected traffic COPY schema.' }
            $seen[$table] = $true
        }
    }
    if ($column -ge 0 -or $seen.Count -ne 2 -or $count -eq 0) {
        throw 'Cannot establish traffic range: require both complete sample COPY sections and at least one row.'
    }
    $denver = [TimeZoneInfo]::FindSystemTimeZoneById('Mountain Standard Time')
    return [pscustomobject][ordered]@{
        firstTrafficAt = $first.ToUniversalTime().ToString('o')
        lastTrafficAt = $last.ToUniversalTime().ToString('o')
        startDate = [TimeZoneInfo]::ConvertTime($first, $denver).ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
        endDate = [TimeZoneInfo]::ConvertTime($last, $denver).ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
        timeZoneId = $denver.Id
        source = 'traffic_sample+traffic_sample_archive.polled_at'
        sampleCount = $count
    }
}

function Get-BackupDataRange {
    param([string]$Path, [string]$PgRestoreExecutable)
    $command = Get-Command $PgRestoreExecutable -ErrorAction Stop
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $command.Source
    $start.Arguments = '--data-only --schema=public --table=traffic_sample --table=traffic_sample_archive --file=- "' + $Path + '"'
    # Script transports support isolated tests; no shell interprets dump content.
    if ($command.Source.EndsWith('.ps1')) {
        $start.FileName = 'powershell.exe'
        $start.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $command.Source + '" ' + $start.Arguments
    }
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    $started = $false
    try {
        $null = $process.Start()
        $started = $true
        $errors = $process.StandardError.ReadToEndAsync()
        $parseError = $null
        try { $range = Read-TrafficDataRange $process.StandardOutput }
        catch {
            $parseError = $_.Exception.Message
            if (-not $process.HasExited) { $process.Kill() }
        }
        $process.WaitForExit()
        $detail = $errors.GetAwaiter().GetResult().Trim()
        if ($process.ExitCode -ne 0) { throw "pg_restore failed (exit $($process.ExitCode)): $detail $parseError" }
        if ($parseError) { throw $parseError }
        return $range
    } finally {
        if ($started -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
        $process.Dispose()
    }
}
