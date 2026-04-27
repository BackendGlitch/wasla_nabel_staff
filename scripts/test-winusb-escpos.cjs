/**
 * Standalone WinUSB + escpos smoke test (run on Windows after Zadig).
 *
 *   node scripts/test-winusb-escpos.cjs
 *
 * Override VID/PID: set WINUSB_VID=0x483 WINUSB_PID=0x5743
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const escpos = require('escpos')
const EscposUSB = require('escpos-usb')
escpos.USB = EscposUSB

const parseVidPid = (v) => {
  const s = String(v).trim()
  return parseInt(s, /^0x/i.test(s) ? 16 : 10)
}
const vid = process.env.WINUSB_VID ? parseVidPid(process.env.WINUSB_VID) : 0x0483
const pid = process.env.WINUSB_PID ? parseVidPid(process.env.WINUSB_PID) : 0x5743

// eslint-disable-next-line no-console
console.log('Opening USB', { vid, pid, hex: '0x' + vid.toString(16) + ' / 0x' + pid.toString(16) })

const device = new escpos.USB(vid, pid)
const printer = new escpos.Printer(device, { encoding: 'utf8' })

device.open(function (err) {
  if (err) {
    // eslint-disable-next-line no-console
    console.error('Cannot open printer:', err)
    process.exit(1)
  }

  printer
    .font('a')
    .align('ct')
    .style('bu')
    .size(1, 1)
    .text('Wasla Station')
    .style('normal')
    .align('lt')
    .text('------------------------')
    .text('Plate: 123 TUN 4567')
    .text('Line: Grombalia')
    .text('Queue No: 3')
    .text('Time: ' + new Date().toLocaleTimeString())
    .text('------------------------')
    .cut()
    .close()
})
