@echo off
setlocal

REM Usage:
REM   scripts\run-pos-dev.bat [machine_id] [printer_device]
REM
REM Examples:
REM   scripts\run-pos-dev.bat
REM   scripts\run-pos-dev.bat station-a-pos-01 USB001

set MACHINE_ID=%~1
if "%MACHINE_ID%"=="" set MACHINE_ID=station-pos-01

set PRINTER_DEVICE=%~2
if "%PRINTER_DEVICE%"=="" set PRINTER_DEVICE=USB001

set STAFF_MACHINE_TYPE=pos
set STAFF_MACHINE_ID=%MACHINE_ID%
set STAFF_PRINTER_DEVICE=%PRINTER_DEVICE%

echo [wasla-pos] STAFF_MACHINE_TYPE=%STAFF_MACHINE_TYPE%
echo [wasla-pos] STAFF_MACHINE_ID=%STAFF_MACHINE_ID%
echo [wasla-pos] STAFF_PRINTER_DEVICE=%STAFF_PRINTER_DEVICE%

npm run dev
