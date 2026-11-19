#pragma once

// GPIO numbers of the desk pet's core board (hardware/pets/README.md, "Pin map
// and connectors"). The firmware builds with BOARD_USES_HW_GPIO_NUMBERS, so
// the number passed to pinMode() and analogReadMilliVolts() is the ESP32-S3
// GPIO number, not the Arduino label; the label is in each comment.
//
// Avoid D13 (the onboard LED, GPIO48), A2 (GPIO3, a strapping pin) and B0 and
// B1 (the boot pins). Check these numbers against the official Nano ESP32
// pinout before routing a PCB.

// Amplifier (MAX98357A), I2S port 1, transmit.
#define PIN_AMP_BCLK 5   // D2: bit clock
#define PIN_AMP_LRCLK 6  // D3: word select
#define PIN_AMP_DIN 7    // D4: data to the amp
#define PIN_AMP_SD 8     // D5: amp enable, high is on, low when silent (no hiss)

// The WS2812B chain inside the figure, through 330 ohm on the skin connector.
#define PIN_LED_DATA 9  // D6

// Microphone (INMP441 or ICS-43434), I2S port 0, receive, 16 kHz.
#define PIN_MIC_SCK 10  // D7: bit clock
#define PIN_MIC_WS 17   // D8: word select
#define PIN_MIC_SD 18   // D9: data from the mic

// Talk button on the skin connector: INPUT_PULLUP, active low, an RTC pin so it
// can wake the board.
#define PIN_BUTTON 21  // D10

// Power. All of these are read with analogReadMilliVolts() or digitalRead().
#define PIN_BATTERY_SENSE 1  // A0: VSYS through the 220 k / 220 k divider, ADC1
#define PIN_CHARGING 2       // A1: bq24074 CHG, open drain, low means charging
#define PIN_USB_PRESENT 4    // A3: bq24074 PGOOD, open drain, low means plugged in

// Which figure stands on the pad, and the hardware mute.
#define PIN_SKIN_ID 13     // A6: skin connector pin 5, 10 k pull-up on the board
#define PIN_MIC_SWITCH 14  // A7: switched mic VDD through 100 k, high means the mic is on

// The most LEDs a figure carries: the chest light plus two antennas (Zib).
// Nova and Comet use two.
#define PET_LED_COUNT_MAX 3
