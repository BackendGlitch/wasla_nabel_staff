param(
  [string]$MachineId = "station-pos-01",
  [string]$PrinterDevice = "USB001"
)

$env:STAFF_MACHINE_TYPE = "pos"
$env:STAFF_MACHINE_ID = $MachineId
$env:STAFF_PRINTER_DEVICE = $PrinterDevice

Write-Host "[wasla-pos] STAFF_MACHINE_TYPE=$($env:STAFF_MACHINE_TYPE)"
Write-Host "[wasla-pos] STAFF_MACHINE_ID=$($env:STAFF_MACHINE_ID)"
Write-Host "[wasla-pos] STAFF_PRINTER_DEVICE=$($env:STAFF_PRINTER_DEVICE)"

npm run dev
