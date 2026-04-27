param(
  [string]$Port = "",
  [int[]]$Bauds = @(9600, 115200),
  [switch]$PrintTest
)

$ErrorActionPreference = "Stop"

Write-Host "== Wasla POS printer diagnostics (Windows) =="
Write-Host ("Time: " + (Get-Date).ToString("s"))

function Get-ComDetails {
  $ports = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object
  $pnp = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match "COM\d+" }
  $details = @()
  foreach ($p in $ports) {
    $match = $pnp | Where-Object { $_.Name -match "\($p\)" } | Select-Object -First 1
    $details += [PSCustomObject]@{
      Port = $p
      Name = if ($match) { $match.Name } else { "" }
      PNPDeviceID = if ($match) { $match.PNPDeviceID } else { "" }
    }
  }
  return $details
}

$details = Get-ComDetails
if (-not $details -or $details.Count -eq 0) {
  Write-Host "NO_COM_PORTS_FOUND"
  Write-Host "Tip: install USB-serial driver, reconnect printer, check Device Manager > Ports (COM & LPT)."
  exit 2
}

Write-Host "Detected COM ports:"
$details | ForEach-Object {
  Write-Host (" - {0}  {1}" -f $_.Port, $_.Name)
}

if ([string]::IsNullOrWhiteSpace($Port)) {
  $preferred = $details | Where-Object { $_.Name -match "EPSON|ZKT|ZKP|THERMAL|USB-SERIAL|CH340|CP210|PL2303|FTDI" } | Select-Object -First 1
  if ($preferred) { $Port = $preferred.Port } else { $Port = $details[0].Port }
}

Write-Host ("Selected port: " + $Port)
Write-Host ("Baud candidates: " + ($Bauds -join ", "))

$summary = @()
foreach ($baud in $Bauds) {
  try {
    $sp = New-Object System.IO.Ports.SerialPort $Port, $baud, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
    $sp.ReadTimeout = 1000
    $sp.WriteTimeout = 1000
    $sp.Handshake = [System.IO.Ports.Handshake]::None
    $sp.Open()

    if ($PrintTest) {
      # ESC @ (init), plain text, LF, and full cut.
      [byte[]]$bytes = 0x1B,0x40
      $bytes += [System.Text.Encoding]::ASCII.GetBytes("WASLA POS TEST baud=$baud " + (Get-Date).ToString("s"))
      $bytes += 0x0A,0x0A,0x0A,0x1D,0x56,0x41,0x03
      $sp.Write($bytes, 0, $bytes.Length)
      Start-Sleep -Milliseconds 300
    }

    $sp.Close()
    $summary += [PSCustomObject]@{ Port = $Port; Baud = $baud; Open = $true; Printed = [bool]$PrintTest; Error = "" }
    Write-Host ("OK port={0} baud={1}" -f $Port, $baud)
  } catch {
    $msg = $_.Exception.Message
    $summary += [PSCustomObject]@{ Port = $Port; Baud = $baud; Open = $false; Printed = $false; Error = $msg }
    Write-Host ("FAIL port={0} baud={1} error={2}" -f $Port, $baud, $msg)
    try { if ($sp -and $sp.IsOpen) { $sp.Close() } } catch {}
  }
}

Write-Host ""
Write-Host "RESULT_JSON_START"
$summary | ConvertTo-Json -Depth 3
Write-Host "RESULT_JSON_END"

if ($summary | Where-Object { $_.Open -eq $true }) {
  exit 0
}
exit 1
