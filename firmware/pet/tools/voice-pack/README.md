# Voice packs: the format and the boot pack

The pet says its saved lines ("Sorry, I didn't catch that.", "Your team is on
it...", the letters of its confirm code) from a **voice pack**, so they work with
no network. This page says what a pack holds and how the pet uses it.

**The renderer comes in a later phase** of
[docs/desk-pets-plan.md](../../../../docs/desk-pets-plan.md). The app will make the
packs on your own ElevenLabs key when you set a pet up, so no recording is
published in this repository, and no key is ever committed. Until then the
format below is what the firmware reads and what `src/shared/pets/voice-pack.ts`
writes.

## What a pack is

### One pack per voice

For each of the six voices (`talia`, `alicia`, `maisie`, `darian`, `eldrin`,
`wyatt`; `PET_VOICE_IDS` in `include/generated/protocol.h`):

1. Every line of the pack (`PET_LINE_IDS`) is spoken in that voice at 22,050 Hz,
   mono, 16-bit. The text of each line is `PET_LINES` in
   `src/shared/pets/lines.ts`. No line holds the pet's name, a step, an amount or
   a digit; the 31 `char-*` clips say one character of the code alphabet each,
   and the `role-*` clips say "Your Coder", "Your Marketing assistant" and so on.
2. Each clip is encoded as IMA-ADPCM in 512-byte blocks (1,017 samples a block,
   the last block zero padded) and the file is written with `encodeVoicePack`
   (`src/shared/pets/voice-pack.ts`). The format is in `src/core/voice_pack.h`: a
   16-byte header (`SFVP`, version 1, clip count, 22050, 512), a 36-byte table
   entry per clip (24-byte id, offset, length, samples) and then the clips' blocks.
3. The app serves the file to the pet, which downloads the pack of its voice to
   `/voice/<voice>.sfvp` on its flash, after pairing and whenever you change the
   voice. A pack is about 1 to 2 MB.

The pet refuses a pack it does not fully understand (wrong sample rate or block
size, a clip that runs past the end, a bad id) and keeps what it had, so a bad
file cannot make it play noise. It also refuses a pack that lacks any of the
lines that must work offline (`PET_BOOT_LINE_IDS`).

A pack may be missing (the pet then plays the boot pack), and a pack from before
a new assistant role was added is fine: a role the pack has no clip for is "Your
assistant" (`role-assistant`).

### The boot pack: one header in the firmware

The firmware image carries one small pack of its own, in one default voice, so
the pet can speak before it has downloaded anything: the setup lines, the 31
characters of the code alphabet, and the offline lines (`PET_BOOT_LINE_IDS`).
It is the same `.sfvp` format, written as a C header:

```c
// firmware/pet/include/generated/boot_pack.h
// Generated. Do not edit by hand.
#pragma once
static const unsigned char PET_BOOT_PACK[] = { 0x53, 0x46, 0x56, 0x50, /* ... the whole .sfvp file ... */ };
static const unsigned int PET_BOOT_PACK_SIZE = sizeof(PET_BOOT_PACK);
```

`src/store/voicepack.cpp` includes it only if it exists (`__has_include`), so a
build without it works: a line nobody can say is then a short tone. The header's
two names are the ones that file reads. The pack is about 0.4 to 0.5 MB (the
header text is about six times that, which the compiler turns back into bytes in
flash), well inside the 3 MB application slot.

The header is not in this repository: it holds your own voice recordings, made on
your own key.

## Checking a pack

- `decodeVoicePack` in `src/shared/pets/voice-pack.ts` reads a pack back to
  samples, for a test or a listen.
- The firmware's own reader (`PackIndex::load`) is unit tested in
  `test/test_voice_pack`; `pio test -e native` runs it. A pack that the
  TypeScript code writes must load there. After making the boot pack, build the
  firmware (`pio run -e nano_esp32`) once: the serial log should not say
  `voice: the boot pack in the firmware is not a pack this firmware reads`.
- On a pet, the serial log says `voice: the voice pack is in place` after a
  download, and nothing about a damaged one beyond `voice:` lines for missing
  clips.
