# Desk pets: set one up

A desk pet is a small figure on a launch pad. You hold its lime light, talk,
and it hands what you said to one of your assistants. It speaks or glows when
the work is done or needs you. This page gets you from a box of parts to a pet
that talks. It was written from the code and the firmware docs. Checking the
steps by hand on macOS and Windows is still open.

## What you need

- A printed launch pad and one figure (Nova, Zib or Comet). The files and the
  build guide are in [hardware/pets/](../hardware/pets/README.md).
- An Arduino Nano ESP32 on the pad, and a USB-C cable that carries data (some
  cables only charge).
- A 2.4 GHz Wi-Fi network. The pet cannot join a 5 GHz network.
- An ElevenLabs account and an API key. The pet listens and speaks on your own
  key. Its cost is on your ElevenLabs plan.
- OpenStellarFirm on a computer that stays on, on the same home network as the
  pet.

## 1. Flash the firmware

Do this once per board, before the pad is closed. The steps are in
[firmware/pet/README.md](../firmware/pet/README.md#flashing): the first flash
uses the `nano_esp32_first` environment, and later updates go over DFU. Never
erase the whole flash.

## 2. Turn on Desk pets

Open Settings, Desk pets, and press Turn on Desk pets. The app then listens on
one port of this computer for pets on your network. The page shows the port
once it is on. It needs your system keychain, because the app keeps its
certificate there. Without a keychain it cannot be turned on.

Until you turn it on, the app opens no port.

### Firewall and system prompts

The pet connects to your computer, so your system must let it in. Allow it for
your home network only, never for a public one. The app also refuses any
address that is not on a private network.

**Windows.** Windows asks whether OpenStellarFirm may accept connections.
Tick Private networks only. Leave Public networks unticked. If you missed the
prompt, open Windows Security, Firewall and network protection, Allow an app
through firewall, and set OpenStellarFirm to Private only.

**macOS.** macOS asks whether OpenStellarFirm may accept incoming connections.
Choose Allow. It also asks for Local Network access. Choose Allow. If you
said no, open System Settings, Privacy and Security, Local Network, and switch
OpenStellarFirm on. For the firewall, open System Settings, Network, Firewall,
Options, and make sure OpenStellarFirm is set to Allow incoming connections.

**Linux.** If your firewall is on, open the port shown on the Desk pets page
for your home network only. Replace `192.168.1.0/24` with your own network and
`PORT` with the number the page shows.

```sh
# ufw
sudo ufw allow from 192.168.1.0/24 to any port PORT proto tcp

# firewalld
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="PORT" protocol="tcp" accept'
sudo firewall-cmd --reload
```

The port is picked when Desk pets turn on. If you change it, change the rule.

## 3. Save your ElevenLabs key

On the same page, under the voice section, paste your key. It is kept in your
system keychain and sent only to ElevenLabs. It is never shown again. Replace
it or remove it there at any time. With no key, the pet cannot hear or speak.

## 4. Add a pet over USB

1. Plug the pet into your computer with its data USB cable.
2. In Settings, Desk pets, press Add a desk pet and pick the pet's USB port
   from the list.
3. Type the name of your Wi-Fi network and its password. They go over the
   cable to the pet and nowhere else.
4. Press Send to the pet. Keep the cable plugged in until the pet speaks.

The pet joins your Wi-Fi, reaches the app and says: "Hi! To set me up, plug me
into your computer. Then open OpenStellarFirm, Settings, Desk pets." After that
it says a confirm code three times, slowly.

Setting up from a phone is not possible. The pet's own setup page only says to
use the cable.

### The confirm code

Type the code the pet says into the box on the Desk pets page. Five wrong tries
close the request, and you start again. The code proves that the person in the
room with the pet is the person at the computer. When it matches, the pet says
it is all set.

## 5. Choose its assistant and voice

Each pet has its own settings on the page:

- **Talks to.** The assistant that gets what you say. It starts as your main
  assistant. What you say is sent as your own message, and the same approval
  rules apply as for a message you type.
- **Voice.** One of the six voices.
- **Speak answers.** On, the pet says the assistant's answer, without
  numbers, amounts, addresses or links. Off, it says only short lines such as
  "done". Answers can contain words from your files, so turn this off in a
  shared room.

## Using the pet

Hold the lime light, talk, and let go. It stops listening after 5 seconds of
silence, after 2 minutes, or when you tap it. A tap or hold on a pet that is
not set up says the setup greeting again.

## What a pet can and can never do

- It never approves anything. A step that waits for you is only told to the
  pet as "needs you". You decide it in the app.
- The microphone records only while you hold the lime light. It never starts by
  itself, and there is no wake word.
- The light is solid lime whenever it records. No setting turns that off.
- The MIC switch cuts the microphone's power. When it is off, the pet says so.
- No audio is kept on the pet or in the app. Words you say go to ElevenLabs to
  be turned into text, and the text goes to your assistant.
- Its lines never carry step text, amounts or links.

## When the computer moves or the app is closed

The app answers to one name of its own on your network (`osf-<something>.local`).
If your computer's address changes, the pet asks for the name and finds it
again. It trusts only your computer's certificate, so another device cannot
take its place.

If the app is closed or the computer sleeps, the pet saves what you say and
says so. When the app is back, it sends the saved notes, oldest first. A note
leaves the pet only after the app took it. Notes the pet kept are shown on the
Desk pets page, where you can read or discard them. A saved note is not sent to
an assistant on its own.

## Forget a pet

Press Forget next to the pet on the Desk pets page. The pet stops working with
the app at once, and its token is deleted. Do this before you give a pet away
or if you lose it. A lost pet still holds your Wi-Fi password in its flash, so
change that password too if you cannot get the pet back. To use the pet again,
add it again over the cable.

## A new certificate

The app trusts pets, and pets trust the app, through one certificate. Under
Certificate and switch, Make a new certificate replaces it. Every pet stops
trusting your computer and is forgotten, and each one has to be added again
over the cable. Do this only if you think the keychain was copied. Turn off
Desk pets from the same place to close the port again.

## Troubleshooting

**The pet says it needs an update.** Its firmware is too old for this app
(version 1 of the cable protocol). Nothing was sent to it. Flash the current
firmware from this repository, then add it again.

**"My voice key was refused."** ElevenLabs did not accept the key. Open
Settings, Desk pets, replace the key and check that it is active in your
ElevenLabs account. The pet stays paired.

**"Your voice quota is used up."** Your ElevenLabs plan has no characters or
minutes left. Check your plan there, or wait for it to renew.

**The pet cannot find the computer.** Check these in order:

1. The app is open, Desk pets are on, and the computer is awake.
2. The pet and the computer are on the same network. A guest network or "client
   isolation" on the router blocks devices from talking to each other.
3. The firewall allows the port for your private network (see above).
4. Your router passes multicast, which the `.local` name needs. Some mesh
   systems and access points block it. If the computer has a fixed address, the
   pet can still use the last one that worked.
5. A VPN on the computer can hide it from the home network. Turn it off while
   you test, or allow local network traffic in the VPN.
6. After a router or computer change, a new certificate is not needed. If it
   still fails, forget the pet and add it again.

**The pet says it cannot join the Wi-Fi.** Check the name and password, and
that the network is 2.4 GHz. Add the pet again.

**The USB port is not in the list.** Use a cable that carries data, plug it
into the Nano's own USB-C (the data port on the pad) and try another port. The
app only lists the Arduino Nano ESP32.

**Nothing happens when I hold the light.** Check the MIC switch. With the mic
off the pet says so. Also check that the pet is Online on the page.

## Privacy

- No account, no server of ours, no telemetry. The pet talks only to the app on
  your computer, on your home network.
- Your Wi-Fi password goes over the USB cable to the pet and nowhere else.
- Voice goes from the app to ElevenLabs on your own key. ElevenLabs's own terms
  apply to what you send it.
- The app keeps only digests of the setup code, the confirm code and the pet's
  token. The ElevenLabs key and the certificate stay in your system keychain.
- A stolen token works only from your own network, and Forget deletes it.

More detail on how it works and why is in
[docs/desk-pets-plan.md](desk-pets-plan.md).
