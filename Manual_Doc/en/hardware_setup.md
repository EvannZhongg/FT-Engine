# FT Engine Hardware Setup Guide

This guide explains the counter device interface, indicator LEDs, scoring buttons, and how the device behavior maps to FT Engine.

## 1. Type-C Port

The Type-C port is used for charging the device and for wired connection to a computer. After connecting the device to the computer with a data cable, FT Engine can recognize the device code in the device binding workflow.

![](images/1.jpg)

Notes:

1. Use a data cable when you need the computer to identify the device.
2. After the cable is plugged in, the red LED turns on when the device enters charging state.

---

## 2. Charging and Battery Indicators

The device uses one red LED and two green LEDs to show charging and battery status.

![](images/2.jpg)

Indicator meanings:

1. Red LED on: the device is charging.
2. Red LED off: the battery is fully charged.
3. Two green LEDs: current battery level.
4. Both green LEDs on: the battery level is sufficient.
5. All green LEDs off: the battery is nearly depleted. Some power may still remain, but charge the device as soon as possible.

---

## 3. Counting Controls

The key switch is used for positive counting. The black button is used for negative counting or resetting the device count.

![](images/3.jpg)

Hardware actions:

1. Press the key switch lightly: count `+1`.
2. Press the black button lightly: count `-1`.
3. Press and hold the black button for 3 seconds: reset the device count to `0`.

---

## 4. Mapping in FT Engine

When connecting devices for each judge in FT Engine, the scoring behavior depends on whether the judge uses `Single-device` or `Dual-device` mode.

**Single-device**

1. Key switch: score `+1`.
2. Black button: score `-1`.

**Dual-device**

1. Select one device as the primary / positive-score device.
2. Select another device as the secondary / negative-score device.
3. Key switch on the positive-score device: score `+1`.
4. Key switch on the negative-score device: score `-1`.
5. Black button on either device: key deduction `-1`.

In FT Engine terms, dual-device mode records `+` from the primary device key switch, `-` from the secondary device key switch, and `Key Deduction` from the black buttons on both devices.

---

## 5. Display Range

The counter hardware display range is `-99` to `999`. This is only the display range of the hardware device. FT Engine keeps counting in software without this range limit.
