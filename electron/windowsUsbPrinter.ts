// windowsUsbPrinter.ts - Windows USB printer device discovery and management
// Handles ZKTeco ZKP8003 and similar CH340/CH341-based USB thermal printers
// that appear as USB devices (not COM ports) when the CH341 driver is absent.

import { posLog } from "./posLogger";

import { execSync, exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Known USB VID:PID pairs for CH340/CH341 based thermal printers
// The ZKP8003 typically uses a CH341 chip
const KNOWN_PRINTER_VID_PID = [
  { vid: "1A86", pid: "7523", name: "CH340" },
  { vid: "1A86", pid: "5512", name: "CH341" },
  { vid: "1A86", pid: "5584", name: "CH341 (variant)" },
  { vid: "1A86", pid: "5523", name: "CH341 (ZKP8003)" },
  { vid: "1A86", pid: "7522", name: "CH340 (alt)" },
  { vid: "4348", pid: "5523", name: "CH341 (WCH)" },
];

export interface UsbPrinterDevice {
  /** e.g. "USB\VID_1A86&PID_5523\123456" */
  deviceId: string;
  /** e.g. "USB Composite Device" or "Unknown device" */
  description: string;
  /** e.g. "CH341" */
  chipName: string;
  /** Is a kernel driver loaded for this device? */
  driverLoaded: boolean;
  /** If a COM port is associated, the port name (e.g. "COM3"), otherwise empty */
  comPort: string;
  /** Manufacturer string from device descriptor */
  manufacturer: string;
  /** Whether this device appears to be a printer/serial device */
  isPrinter: boolean;
}

/**
 * Check if the CH341 driver is installed on the system by looking for the driver
 * in the standard driver store locations.
 */
export function isCh341DriverInstalled(): boolean {
  try {
    // Check via PowerShell if the driver package exists
    const result = execSync(
      `powershell -Command "Get-PnpDeviceProperty -InstanceId 'CH341*' -KeyName 'DEVPKEY_Device_DriverDate' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Data" 2>nul`,
      { timeout: 5000, encoding: "utf8" },
    ).trim();
    if (result) return true;
  } catch {
    // ignore
  }

  // Alternative: check if serenum.sys or ch341ser.sys driver files exist
  const sysDir = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "drivers",
  );
  for (const file of ["ch341ser.sys", "ch340ser.sys", "ch341par.sys"]) {
    try {
      if (fs.existsSync(path.join(sysDir, file))) return true;
    } catch {
      // ignore
    }
  }

  // Check if any USB devices with our VID have a COM port associated (means driver is loaded)
  try {
    const result = execSync(
      `powershell -Command "$comports = Get-WmiObject Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_1A86' -and $_.Name -match 'COM' } | Select-Object -ExpandProperty Name -ErrorAction SilentlyContinue; if ($comports) { Write-Output 'FOUND' }" 2>nul`,
      { timeout: 5000, encoding: "utf8" },
    ).trim();
    if (result.includes("FOUND")) return true;
  } catch {
    // ignore
  }

  return false;
}

/**
 * Enumerate USB devices via PowerShell to find CH340/CH341/ZKP8003 printers.
 * This works regardless of whether the driver is installed.
 */
export async function enumerateUsbPrinters(): Promise<UsbPrinterDevice[]> {
  if (process.platform !== "win32") return [];

  const results: UsbPrinterDevice[] = [];

  try {
    // PowerShell script to enumerate all USB devices with CH340/CH341 VID
    const psScript = `
$devices = Get-PnpDevice -Class 'USB' -ErrorAction SilentlyContinue | Where-Object { $_.PNPDeviceID -match 'VID_1A86' }
$output = @()
foreach ($d in $devices) {
  $driverLoaded = if ($d.Status -eq 'OK') { $true } else { $false }
  $desc = if ($d.FriendlyName) { $d.FriendlyName } else { $d.DeviceDesc }
  $manufacturer = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_Manufacturer' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Data)
  if (-not $manufacturer) { $manufacturer = '' }

  # Find associated COM port
  $comPort = ''
  $comDevices = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.PNPDeviceID -match [regex]::Escape($d.InstanceId) -and $_.Class -eq 'Ports' -and $_.FriendlyName -match 'COM' }
  if ($comDevices) {
    $comPort = ($comDevices | Select-Object -First 1).FriendlyName
    if ($comPort -match 'COM(\\d+)') { $comPort = 'COM' + $matches[1] }
  }

  # Also search the whole PnP tree for this device by parent
  if (-not $comPort) {
    $parentDevices = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.PNPDeviceID -match 'VID_1A86' -and $_.Class -eq 'Ports' }
    if ($parentDevices) {
      $comPort = ($parentDevices | Select-Object -First 1).FriendlyName
      if ($comPort -match 'COM(\\d+)') { $comPort = 'COM' + $matches[1] }
    }
  }

  $output += @{
    DeviceId = $d.InstanceId
    Description = $desc
    DriverLoaded = $driverLoaded
    ComPort = $comPort
    Manufacturer = $manufacturer
    Status = $d.Status
  }
}
$output | ConvertTo-Json -Compress
`;

    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
      { timeout: 10000 },
    );

    let devices: Record<string, unknown>[] = [];
    try {
      devices = JSON.parse(stdout.trim()) as Record<string, unknown>[];
      if (!Array.isArray(devices)) devices = [devices];
    } catch {
      return results;
    }

    for (const raw of devices) {
      const d = raw as Record<string, unknown>;
      const deviceId = String(d.DeviceId || "");
      if (!deviceId) continue;

      // Determine which CH chip
      const id = deviceId.toUpperCase();
      let chipName = "CH340/CH341";
      for (const known of KNOWN_PRINTER_VID_PID) {
        if (id.includes(known.vid) && id.includes(known.pid)) {
          chipName = known.name;
          break;
        }
      }

      results.push({
        deviceId,
        description: String(d.Description || "Unknown USB device"),
        chipName,
        driverLoaded: d.DriverLoaded === true || d.Status === "OK",
        comPort: String(d.ComPort || ""),
        manufacturer: String(d.Manufacturer || ""),
        isPrinter: true,
      });
    }
  } catch (e) {
    posLog.error("win-usb-enumerate", { error: (e as Error).message });
  }

  return results;
}

/**
 * Check if any CH340/CH341 device is connected via USB (regardless of driver state).
 */
export async function isUsbPrinterConnected(): Promise<boolean> {
  const printers = await enumerateUsbPrinters();
  return printers.length > 0;
}

/**
 * Get detailed health info about the USB printer for the health check system.
 * This provides more accurate info than just checking COM ports.
 */
export async function getUsbPrinterHealth(): Promise<{
  connected: boolean;
  driverInstalled: boolean;
  comPort: string;
  devicePath: string;
  chipName: string;
  detail: string;
}> {
  const result = {
    connected: false,
    driverInstalled: false,
    comPort: "",
    devicePath: "",
    chipName: "",
    detail: "",
  };

  const printers = await enumerateUsbPrinters();

  if (printers.length === 0) {
    result.detail = "No CH340/CH341/ZKP8003 USB device detected";
    return result;
  }

  result.connected = true;
  const device = printers[0]!;
  result.devicePath = device.deviceId;
  result.driverInstalled = device.driverLoaded;
  result.comPort = device.comPort;
  result.chipName = device.chipName;

  if (device.driverLoaded && device.comPort) {
    result.detail = `ZKP8003 detected on ${device.comPort} (${device.chipName})`;
  } else if (device.driverLoaded && !device.comPort) {
    result.detail = `ZKP8003 detected but no COM port assigned (${device.chipName})`;
  } else {
    result.detail = `ZKP8003 detected but CH341 driver not installed (install CH341SER driver)`;
  }

  return result;
}

/**
 * Try to write ESC/POS bytes to a Windows USB printer device using PowerShell.
 * This is a fallback when no COM port is available.
 * Uses the .NET SerialPort class or direct USB write via Win32 API.
 */
export async function writeBytesViaPowerShell(
  comPort: string,
  baudRate: number,
  base64Data: string,
): Promise<number> {
  const psScript = `
$port = New-Object System.IO.Ports.SerialPort
$port.PortName = '${comPort}'
$port.BaudRate = ${baudRate}
$port.DataBits = 8
$port.StopBits = 1
$port.Parity = [System.IO.Ports.Parity]::None
$port.Handshake = [System.IO.Ports.Handshake]::None
$port.WriteTimeout = 10000
$port.ReadTimeout = 1000
try {
  $port.Open()
  $bytes = [System.Convert]::FromBase64String('${base64Data}')
  $port.Write($bytes, 0, $bytes.Length)
  $port.Close()
  Write-Output "OK:$($bytes.Length)"
} catch {
  Write-Output "ERROR:$($_.Exception.Message)"
}
`;
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
    { timeout: 30000 },
  );
  const trimmed = stdout.trim();
  if (trimmed.startsWith("OK:")) {
    return parseInt(trimmed.substring(3), 10);
  }
  throw new Error(trimmed);
}

/**
 * Download and install the CH341SER driver.
 * This is the official driver from WCH (the chip manufacturer).
 */
export async function installCh341Driver(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // Download CH341SER driver from WCH's website
    const downloadUrl = "https://www.wch.cn/downloads/file/65.html?time=";
    const tempDir = path.join(os.tmpdir(), "wasla-ch341-driver");
    const zipPath = path.join(tempDir, "CH341SER.ZIP");

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    posLog.info("ch341-driver-install", {
      event: "downloading",
      url: downloadUrl,
    });

    // Use PowerShell to download and extract
    const psScript = `
$tempDir = '${tempDir.replace(/\\/g, "\\\\")}'
$zipPath = '${zipPath.replace(/\\/g, "\\\\")}'
$url = '${downloadUrl}'

# Download driver ZIP
Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -ErrorAction Stop

# Extract
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tempDir, $true)

# Find and run the installer (silent mode)
$setup = Get-ChildItem -Path $tempDir -Recurse -Filter 'SETUP.EXE' | Select-Object -First 1
if ($setup) {
  Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -NoNewWindow
  Write-Output 'INSTALLED'
} else {
  # Try the driver install via pnputil
  $inf = Get-ChildItem -Path $tempDir -Recurse -Filter '*.inf' | Select-Object -First 1
  if ($inf) {
    $result = & pnputil /add-driver $inf.FullName /install 2>&1
    Write-Output "INSTALLED:$result"
  } else {
    Write-Output 'NO_INF_FOUND'
  }
}
`;
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
      { timeout: 120000 },
    );

    const trimmed = stdout.trim();
    if (trimmed.includes("INSTALLED")) {
      posLog.info("ch341-driver-install", {
        event: "success",
        detail: trimmed,
      });
      return { success: true };
    }

    return { success: false, error: `Driver installation failed: ${trimmed}` };
  } catch (e) {
    const err = e as Error;
    posLog.error("ch341-driver-install", { error: err.message });
    return { success: false, error: err.message };
  }
}
