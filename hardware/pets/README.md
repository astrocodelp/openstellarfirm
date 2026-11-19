# Desk pets: hardware

> **Not working with the app yet.** The print files and this guide are here; the app
> side (the server on your computer, pairing, voice and Settings) lands in later
> phases of [docs/desk-pets-plan.md](../../docs/desk-pets-plan.md), so a pet built
> from this does not pair with OpenStellarFirm yet.

The desk pets are the owner's three pets from the app, **Nova**, **Zib** and
**Comet**, made as 3D-printed figures that stand on one shared **launch pad**.
The pad holds the electronics (an Arduino Nano ESP32, a microphone, a speaker, a
battery and a charger), so a figure only carries a button and a few lights. This
folder holds the CAD, the print guide and the build guide. How the pets talk to
OpenStellarFirm (pairing, voice, notices, saved notes), the rules the code must keep
and the phases are in [docs/desk-pets-plan.md](../../docs/desk-pets-plan.md).

This is the v1 prototype, wired with breakout boards on a perfboard. It is not a
product: the first units are test builds. The firmware is written
([firmware/pet/](../../firmware/pet/README.md)) but has not run on a unit yet, so
the bring-up below is the first time the hardware meets it. Each figure's look
comes from the app's own pet drawings.

## What is in this folder

| Path                                                                       | What                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `cad/base.scad`                                                            | The launch pad.                                                                                         |
| `cad/nova.scad`, `cad/zib.scad`, `cad/comet.scad`                          | The three figures.                                                                                      |
| `cad/parts/base.json`, `nova.json`, `zib.json`, `comet.json`               | Each model's parts list: ids, colors, materials and print notes. Committed. The hardware page reads it. |
| `cad/export_base.sh`, `export_nova.sh`, `export_zib.sh`, `export_comet.sh` | Each renders one model's STLs and its PNG preview, and copies its parts list next to them.              |
| `cad/export_all.sh`                                                        | Runs all four.                                                                                          |
| `cad/out/`                                                                 | The renders. Generated, and `cad/.gitignore` keeps it out of git.                                       |

Every `.scad` file is OpenSCAD 2021.01 code in millimetres, self-contained (no
`include` or `use`), with its dimensions as variables at the top. The STL files
and the PNG renders are generated and never committed. Each model's parts list is
a committed file, `cad/parts/<name>.json`. It is the source of truth: the export
copies it to `<name>/parts.json` next to the STLs, where the hardware page reads
it. When a part is added or changed, edit its entry in that file.

Coordinates: Z is up and the front of every part faces -Y (seen from the front,
the viewer's left is -X). The pad's coordinates are the world: the origin is the
center of its round front arc, and z = 0 is the pad's underside (the rubber feet
are not modeled). A figure has its own coordinates, with the origin at the bottom
center where it stands, and sits on the pad at (0, +8, 36) with no rotation.

## The launch pad

`base.scad`. A "D" shape: a circle of radius 60 mm cut flat at the back, so the
footprint spans x -60 to 60 and y -60 to +40. It is 36 mm tall, with 2.4 mm walls,
a 2.4 mm top plate and a 2 mm chamfer on the top edge.

| Part id           | Color           | Material                | Notes                                                                                                                                                                            |
| ----------------- | --------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base_shell`      | night `#070709` | PLA, black or dark grey | The top plate and the side wall, open at the bottom. Print it upside down, top face on the bed, with no supports. Press four M3 heat-set inserts into its bosses.                |
| `base_floor`      | night `#070709` | PLA, black or dark grey | A 3 mm plate that sits in the bottom opening, with the battery tray, the core board posts and the rubber feet recesses. Print it flat, posts up. Closed with four M3 x 8 screws. |
| `base_ring_inlay` | lime `#d9ff3f`  | PLA, lime               | An optional ring that presses into the groove in the top plate, 0.4 mm proud. Print it flat.                                                                                     |

| Feature                 | Detail                                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speaker grille          | Top plate, centered at (0, -34): 2.0 mm holes on a 3.2 mm hex grid inside a 34 mm circle. A ring under the plate (inner diameter 40.6 mm, 5 mm tall) holds the 40 mm speaker, facing up.                                                  |
| Mic port                | A 1.6 mm hole at (+28, -40), with a pocket ring under it (inner diameter 14.6 mm, 3 mm tall) for the round mic module.                                                                                                                    |
| Figure screws and cable | Two 3.4 mm holes at (-12, +8) and (+12, +8) for the M3 x 8 screws that hold the figure, and one 10 mm hole at (0, +4) for its cable.                                                                                                      |
| Lime ring groove        | 3.0 mm wide and 1.6 mm deep, following the outline 6 mm in from the edge.                                                                                                                                                                 |
| USB-C openings          | In the flat back wall, each 12.5 x 7.5 mm with rounded corners, a 16 x 11 mm outside recess 1.0 mm deep so a plug seats fully, and a debossed label: CHARGE at x = -14 (the charger's USB-C) and DATA at x = +14 (the Nano's USB-C).      |
| Switch slots            | Through the curved side wall, 10.0 x 4.6 mm, centered at z = 10, each with a debossed label: POWER at 20 degrees (measured from +X toward +Y, so toward the back on the +X side) and MIC at 160 degrees (toward the back on the -X side). |
| Screw bosses            | Four, 8 mm across, hanging from the top plate at (-46, -10), (+46, -10), (-40, +30) and (+40, +30), each with an M3 heat-set insert hole (4.0 mm, 6 mm deep). The floor's countersunk holes line up.                                      |
| Key                     | A 5.6 x 1.6 mm rib on the inner back wall and a 6 x 2 mm notch in the floor, so the floor fits one way only.                                                                                                                              |
| Battery tray            | Four L-shaped corner walls, 6 mm tall, around a 63 x 38 mm pocket centered at (0, +12).                                                                                                                                                   |
| Core board posts        | Four, 6 mm across, up to z = 14, at (-33, -11), (+33, -11), (-33, +35) and (+33, +35), with 2.2 mm pilot holes for M2.5 self-tapping screws. The board is 70 x 50 mm, centered at (0, +12).                                               |
| Feet                    | Four 10.5 mm recesses, 1.0 mm deep, on the floor's underside for 10 mm rubber feet, and the text "OpenStellarFirm desk pet".                                                                                                              |

### How a figure fits the pad

Every figure's body part has the same interface, so any figure fits the pad:

- A flat bottom at z = 0, with the contact area inside x -30 to 30 and y -17 to
  21. (Comet's tail may also touch the pad, inside x -44 to 30.) Higher parts (a
  head, a backpack, arms) may overhang, but stay inside y -31 to 32 and x -40 to
  40 so they stay over the pad.
- Two M3 heat-set insert holes (4.0 mm across, 6.5 mm deep) from the bottom at
  (-12, 0) and (+12, 0), in solid material (the feet or boots).
- A vertical 7 mm cable channel at (0, -4), from the bottom up into the chest
  pocket. The legs are joined around it.
- A chest pocket, 22 x 22 mm and 15 mm deep, for the chest module: a small
  perfboard with the switch, LED 0 and the skin ID resistor. A bezel part (the
  chest panel, belt or collar) closes its front and holds the translucent lime
  cap. The cap has a flange inside the bezel so it cannot fall out, a stem that
  presses the switch (4 mm long, 5.6 mm on Comet), and 0.3 mm of clearance. The
  board is up to 20 x 16 mm on Nova: it passes the chest panel's window and goes
  in from the front. On Zib and Comet it is up to about 19.6 x 19.6 mm and goes in
  from the back, through a hatch that `zib_back_cover` or `comet_back_cover`
  closes. The cover's inner face is the pocket's back wall, so a press on the cap
  cannot push the board away.
- Straight 5 mm wire channels from the chest pocket to each antenna socket, or to
  the dome, for LED 1 and LED 2.
- Head to body: a 10 mm x 6 mm neck peg on the body and a 10.4 x 6.5 mm socket in
  the head, with the LED channel through both. Glue them.
- At most 105 mm in total to the top of the helmet, head or dome. Antennas may add
  up to 22 mm.

## The three figures

Each figure is split by color, so a single-color printer can print every color as
its own part. The ids below are the `part` values for the export. Finish the
small details (eyes, smiles, cheeks, ear insides, glints) with acrylic paint pens.

### Nova, the astronaut

`nova.scad`. A helmet 62 mm across on a rounded torso, arms ending in round
gloves, short legs in grey boots, a backpack, a visor and an antenna with a
glowing ball. An extra collar ring (`nova_collar`) sits between the torso and the
helmet.

| Part id              | Color                                  | Material                | Notes                                                                                                                                                                                       |
| -------------------- | -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nova_body`          | ivory `#f3efe6`, boots `#8c90a0`       | PLA, ivory              | Torso, arms, legs and boots, with the cable channel, chest pocket and neck peg. Pause at 8 mm to switch to grey for the boots, or paint them. Press two M3 heat-set inserts into the boots. |
| `nova_helmet`        | ivory `#f3efe6`                        | PLA, ivory              | The sphere, centered at z = 68, with the socket for the neck peg and the mount for the antenna at the upper left.                                                                           |
| `nova_visor`         | black `#07080d` or dark navy `#2a3550` | PLA, black or dark navy | An oval about 40 x 34 mm, set 4 mm into the helmet front. Paint the raised eyes and smile ivory `#f3efe6`, and the glint arc at the upper left lime `#d9ff3f`.                              |
| `nova_collar`        | suit shade `#cdc8bc`                   | PLA, warm grey          | An extra part: a ring 28 mm across and 3 mm high that slides over the neck peg and sits on the torso. The helmet rests on it. Without it the helmet would leave a 3 mm gap.                 |
| `nova_backpack`      | warm grey `#b7b3a8`                    | PLA, warm grey          | A rounded box about 34 x 12 x 30 mm on the back.                                                                                                                                            |
| `nova_chest_panel`   | dark `#23242e`                         | PLA, dark               | The bezel: a rounded rectangle about 28 x 16 mm with the round lime cap on its left and two small raised bars on its right (paint them `#9d998f`).                                          |
| `nova_chest_cap`     | lime `#d9ff3f`                         | Translucent PETG or PLA | The button, 11 mm across.                                                                                                                                                                   |
| `nova_antenna_stalk` | grey `#a2a8b8`                         | PLA, grey               | About 16 mm long, angled about 20 degrees outward from the helmet's upper left.                                                                                                             |
| `nova_antenna_ball`  | lime `#d9ff3f`                         | Translucent PETG or PLA | A hollow ball, 14 mm outside and 11 mm inside. Holds LED 1.                                                                                                                                 |

### Zib, the alien

`zib.scad`. A wide lime-green head with two big eyes and two antennas with glowing
balls, on a purple body with a dark belt and a lime buckle. The arms are separate
parts, glued on with 3 mm dowels. The chest board goes in from the back, behind
`zib_back_cover`.

| Part id                         | Color                                             | Material                | Notes                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zib_body`                      | purple `#8a7cf4`, legs `#b4ea4c`, boots `#4a3f8f` | PLA, purple             | Torso, legs and boots, with the cable channel, chest pocket and neck peg. Pause at height for the colors, or paint. Press two M3 heat-set inserts into the boots.                                                  |
| `zib_head`                      | skin `#b4ea4c`                                    | PLA, lime green         | About 70 x 52 x 50 mm, with two eye sockets 2.5 mm deep, a smile groove and two antenna sockets. Paint the cheeks pink `#ff80b6`.                                                                                  |
| `zib_eye_left`, `zib_eye_right` | `#14121e`                                         | PLA, black              | Ovals about 18 x 22 mm that press into the eye sockets, tilted so their tops lean outward.                                                                                                                         |
| `zib_arm_left`, `zib_arm_right` | skin `#b4ea4c`                                    | PLA, lime green         | Capsules down the sides, ending in round hands. Each has a flat glue face and a blind 3.4 mm hole that lines up with one in the torso's side: glue a 3 mm dowel or a piece of filament, 9 mm long, into each pair. |
| `zib_belt`                      | `#24203d`                                         | PLA, dark purple        | The bezel: a band around the front of the torso, at z about 24 to 29.                                                                                                                                              |
| `zib_buckle_cap`                | lime `#d9ff3f`                                    | Translucent PETG or PLA | The button: a rounded square about 12 x 10 mm, at the belt's front center.                                                                                                                                         |
| `zib_back_cover`                | purple `#8a7cf4`                                  | PLA, purple             | A 19.7 x 19.7 mm plug that closes the 20 x 20 mm hatch in the torso's back (0.15 mm clear a side, plus a drop of glue). Its inner face is the pocket's back wall, so it backs the chest board. Press it in last.   |
| `zib_antenna_stalk`             | skin `#b4ea4c`                                    | PLA, lime green         | About 18 mm long, angled about 20 degrees outward from the top of the head at x = -14 and x = +14. Print 2.                                                                                                        |
| `zib_antenna_ball`              | lime `#d9ff3f`                                    | Translucent PETG or PLA | A hollow ball, 12 to 14 mm across. Holds LED 1 or LED 2. Print 2.                                                                                                                                                  |

### Comet, the space cat

`comet.scad`. An egg-shaped body, a cat head with two ears, a purple collar with a
lime diamond tag, a thick curled tail that may rest on the pad, and a glass helmet
over the head. It also has two small arms (part of the body), a belly inlay, and a
back cover for the chest hatch. The helmet is two printed halves, or a bought
ornament ball.

| Part id             | Color               | Material                | Notes                                                                                                                                                                                                                            |
| ------------------- | ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comet_body`        | fur `#bcc6d9`       | PLA, silver grey        | Egg-shaped, about 46 x 38 x 34 mm, with two small arms hugging the sides, short legs, paws at x = -11 and x = +11, and the tail. Press two M3 heat-set inserts into the paws.                                                    |
| `comet_back_cover`  | fur `#bcc6d9`       | PLA, silver grey        | A 20 x 20 mm plug that closes the 20.3 x 20.3 mm hatch in the body's back (0.15 mm clear a side, plus a drop of glue). Its inner face is the pocket's back wall, so it backs the chest board. Press it in last.                  |
| `comet_belly`       | light fur `#edf1f7` | PLA, white              | An oval inlay, glued into a recess on the chest (it stands 0.4 mm proud, with a hole where the bezel plate sits). Optional: leave it out and paint the recess instead.                                                           |
| `comet_head`        | fur `#bcc6d9`       | PLA, silver grey        | About 44 x 38 x 36 mm, with two triangular ears (paint the insides `#f2a9cb`), eye recesses (paint `#14121e`, or fit small black inserts), a nose (paint `#e88db6`), three stripe grooves (paint `#7f8ba6`) and whisker grooves. |
| `comet_collar`      | collar `#8a7cf4`    | PLA, purple             | The bezel: a torus at the neck, at z about 44 to 49. The chest pocket sits just under it.                                                                                                                                        |
| `comet_tag_cap`     | lime `#d9ff3f`      | Translucent PETG or PLA | The button: a diamond about 11 x 11 mm (a square turned 45 degrees).                                                                                                                                                             |
| `comet_dome_top`    | clear               | Clear PETG              | The upper half of the glass helmet (a sphere `dome_d`, 66 mm across, with a 1.8 mm wall), split at the equator. Print it with the flat equator face on the bed.                                                                  |
| `comet_dome_bottom` | clear               | Clear PETG              | The lower band of the helmet, open at the bottom where it sits on the collar. Print it with the flat equator face on the bed.                                                                                                    |

For a crystal clear helmet, buy a 60 or 70 mm clear ornament ball and set `dome_d`
to match. LED 1 sits behind the cat head, facing up and back, so the whole dome
glows.

### View-only paint parts

The web viewer shows one color per part, so a detail that is only painted on would
not show. Each figure therefore also has view-only paint parts: the painted
details as thin separate meshes, a 0.3 mm skin that stands 0.05 mm proud of the
surface it covers. They are never printed: they have no print STL, the print
layout refuses them, and the parts list marks them `viewOnly` with `qty` 0 and a
null `print` link. Paint each detail on the printed part with an acrylic paint
pen, in the color shown.

| Part id            | Color               | Shows                                   |
| ------------------ | ------------------- | --------------------------------------- |
| `nova_paint_ivory` | ivory `#f3efe6`     | The visor's raised eyes and smile.      |
| `nova_paint_lime`  | lime `#d9ff3f`      | The visor's glint arc and dot.          |
| `zib_paint_white`  | white `#ffffff`     | The raised highlight dots on both eyes. |
| `zib_paint_pink`   | pink `#ff80b6`      | The two cheeks.                         |
| `zib_paint_dark`   | dark `#14121e`      | The smile.                              |
| `comet_paint_pink` | pink `#f2a9cb`      | The inner faces of the ears.            |
| `comet_paint_nose` | rose pink `#e88db6` | The raised nose.                        |
| `comet_paint_dark` | dark `#14121e`      | The eyes.                               |

Zib also has two view-only copies of its right-hand antenna, `zib_antenna_stalk_right`
and `zib_antenna_ball_right`, so the viewer can show both antennas. They are the same
parts as the left ones: print `zib_antenna_stalk` and `zib_antenna_ball` twice.
Comet's stripes, whiskers and mouth stay grooves in the viewer; paint them `#7f8ba6`.

## Exporting the STLs

You need OpenSCAD 2021.01 or newer, and `xvfb-run` for the PNG renders (they run
the preview on a machine with no display).

```sh
cd hardware/pets/cad
./export_all.sh                      # every STL and PNG, into out/
OUT=/some/folder ./export_all.sh     # put them somewhere else
./export_nova.sh                     # one model (also export_base.sh, export_zib.sh, export_comet.sh)
```

The output folder is `out/` next to the scripts (git ignores it), or `$OUT`:

```
<name>/view/<part>.stl     the part where it sits when assembled (world coordinates)
<name>/print/<part>.stl    the part alone in print orientation, resting on z = 0, centered on x = y = 0
                           (none for a view-only part)
<name>/parts.json          a copy of cad/parts/<name>.json, the parts list
<name>/<name>.png          a 1200 x 1200 preview of the whole assembly
```

`<name>` is `base`, `nova`, `zib` or `comet`. Each `.scad` file takes two
variables on the command line, so one part by hand is:

```sh
openscad -o nova_helmet.stl -D 'part="nova_helmet"' -D 'layout="print"' nova.scad
```

`part` is one part id from the file, or `"assembly"` (the default: a colored
preview of the whole figure, with a stand-in pad). `layout` is `"view"` or
`"print"`; a view-only part has only `"view"`. Both are strings, so keep the
quotes inside the single quotes. At the top of each file, `fn_view` (48) sets the
curve detail for viewer exports and `fn_print` (96) for print exports. Keep each
print STL under about 12 MB, and lower `fn_print` for a part that grows past that.

## Printing

- **Material.** PLA for everything except the translucent parts (the lime caps and
  the antenna balls), which are translucent or natural PETG or PLA, and Comet's
  dome, which is clear PETG (or buy the ornament ball). The pad is black or dark
  grey PLA, with the ring inlay in lime.
- **Settings.** 0.2 mm layers (0.12 mm for the heads and small parts looks
  nicer), 3 walls, 15 to 20 % gyroid infill, and a brim for the small parts.
- **Supports.** None for the pad parts. Tree supports for arms, chins and the
  underside of heads where the part's own notes say so.
- **A single-color printer.** Print each color as its own part (that is why the
  parts are split), use pause at height for the boots, and finish the small
  details with acrylic paint pens.
- **Printer.** A build volume of at least 130 x 130 x 110 mm.
- **Time.** Roughly 14 to 20 hours per pet, including its pad.
- **Inserts.** M3 brass heat-set inserts (5.7 mm long, in 4.0 mm holes): four in
  the pad's bosses and two in the figure's feet.

## The board

The brain is an **Arduino Nano ESP32** (ABX00092 with headers, ABX00083 without).
It carries a u-blox NORA-W106 module (an ESP32-S3 with two cores at 240 MHz), 512
KB of SRAM, **8 MB of PSRAM**, **16 MB of flash**, Wi-Fi 4 (2.4 GHz), Bluetooth LE
5, USB-C and I2S on any pin, in the classic Nano footprint.

Why not another Nano? The classic Nano and the Nano Every have an ATmega328P or
4809 with 2 to 6 KB of RAM, no Wi-Fi and no I2S, so they cannot stream voice. The
Nano RP2040 Connect has Wi-Fi and a microphone, but 264 KB of RAM and no PSRAM,
which is too tight for two minutes of audio and TLS. The Nano 33 IoT has 32 KB of
RAM.

## Bill of materials

Per pet, for the v1 prototype with breakout boards.

| #   | Part                                                                                      | Qty    | Example                                              | Notes                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Arduino Nano ESP32                                                                        | 1      | ABX00092 (with headers)                              | The brain. Solder its headers straight into the core board.                                                                                    |
| 2   | I2S MEMS microphone breakout                                                              | 1      | INMP441 round module (or ICS-43434 breakout)         | 3.3 V, L/R pin to GND (left channel).                                                                                                          |
| 3   | I2S class-D amplifier                                                                     | 1      | MAX98357A breakout (Adafruit 3006)                   | Runs from the battery rail. SD pin to D5 to switch it off when quiet.                                                                          |
| 4   | Speaker, 40 mm, 4 ohm, 3 W                                                                | 1      | Adafruit 3968 or any 40 mm full-range                | Faces up under the pad's front grille.                                                                                                         |
| 5   | LiPo battery 1S 3.7 V 2000 mAh with protection PCB, JST-PH 2                              | 1      | Adafruit 2011 (about 60 x 36 x 7.5 mm)               | Must fit 63 x 38 x 9 mm. Check the plug polarity before plugging in.                                                                           |
| 6   | USB-C LiPo charger with load sharing                                                      | 1      | Adafruit 4755 (bq24074)                              | Charges at 1 A and runs the pet while charging. Any bq24074 or MCP73871 power-path module works. Avoid a bare TP4056.                          |
| 7   | 5 V boost, at least 1 A                                                                   | 1      | Adafruit 4654 MiniBoost (TPS61023) or Pololu U3V40F5 | Battery rail to the Nano's `VIN`.                                                                                                              |
| 8   | Addressable RGB LED, 10 mm round mini board                                               | 2 to 3 | WS2812B or SK6812 mini PCB                           | The chest light plus the antennas or the dome. A 5 mm through-hole PL9823 or APA106 also fits.                                                 |
| 9   | Tactile switch 6 x 6 mm, 9.5 mm tall                                                      | 1      | any                                                  | Under the lime cap.                                                                                                                            |
| 10  | Slide switch SPDT (SS12D00 or similar)                                                    | 2      | any                                                  | POWER and MIC (the MIC switch cuts the microphone's power).                                                                                    |
| 11  | Prototype board 70 x 50 mm, double sided                                                  | 1      | "7 x 5 cm" perfboard                                 | The core board (v1). The custom PCB replaces it in v2.                                                                                         |
| 12  | Small perfboard offcut: up to 20 x 16 mm for Nova, up to 19.6 x 19.6 mm for Zib and Comet | 1      |                                                      | The chest module in the figure.                                                                                                                |
| 13  | JST-PH 2.0 connectors (2-pin x2, 5-pin x2) and crimped leads                              | 1 set  |                                                      | Skin (5-pin), mic (5-pin), speaker (2-pin), battery (2-pin).                                                                                   |
| 14  | Resistors                                                                                 |        |                                                      | 330 ohm (LED data), 2 x 220 k (battery divider), 3 x 10 k (pull-ups), 1 skin ID resistor (10 k Nova, 22 k Zib, 47 k Comet), 100 k (mic sense). |
| 15  | Capacitors                                                                                |        |                                                      | 100 nF on the battery divider, 470 to 1000 uF electrolytic on the LED supply near the skin connector.                                          |
| 16  | M3 brass heat-set inserts (5.7 mm long, 4.0 mm hole)                                      | 6      |                                                      | 4 in the pad, 2 in the figure's feet.                                                                                                          |
| 17  | M3 x 8 screws                                                                             | 6      |                                                      | 4 close the pad floor, 2 hold the figure on the pad.                                                                                           |
| 18  | M2.5 x 6 self-tapping screws                                                              | 4      |                                                      | Core board to the floor posts.                                                                                                                 |
| 19  | Silicone wire 26 AWG and 30 AWG, heat shrink                                              |        |                                                      | 30 AWG for the antenna and dome LEDs.                                                                                                          |
| 20  | Rubber bumper feet 10 mm                                                                  | 4      |                                                      | Under the pad.                                                                                                                                 |
| 21  | Optional: clear ornament ball 60 or 70 mm                                                 | 1      | Craft shop                                           | A crystal clear helmet for Comet instead of printing it.                                                                                       |

Rough cost: about 40 to 90 EUR per pet in parts, depending on generic modules
versus Adafruit parts, plus filament. Tools: a soldering iron with a heat-set
insert tip, a multimeter, a hot glue gun, wire strippers and a crimper, small
screwdrivers, and a 3D printer.

## Power

```
USB-C 5 V (charge port) -> bq24074 charger (load sharing, 1 A charge)
                              |-- BAT <-> LiPo 2000 mAh (protected)
                              '-- LOAD (3.5 to 4.4 V) -> POWER slide switch -> VSYS rail
VSYS -> MAX98357A VIN (amp, about 1.3 W into 4 ohm at 3.7 V: plenty for a desk)
VSYS -> skin LEDs VDD (3.5 to 4.4 V keeps 3.3 V data inside the WS2812B input threshold)
VSYS -> 5 V boost -> Nano ESP32 VIN -> Nano's own 3.3 V converter -> 3V3
3V3  -> MIC slide switch -> microphone VDD (hardware mute)
VSYS -> 220 k / 220 k divider -> A0 (battery voltage)
```

- The firmware shuts the pet down below 3.5 V under load, since the LEDs and the
  converter both want it.
- The Nano's `VIN` feeds its MP2322 buck converter, which takes 3 to 22 V by its
  datasheet (Arduino recommends 6 to 21 V and warns outside 5 to 18 V). USB 5 V
  goes through the same converter, so 5 V into `VIN` works, and plugging the
  Nano's USB-C in at the same time is the normal Arduino case. One LiPo cell (3.0
  to 4.2 V) straight into `VIN` is too low, so the battery is boosted to 5 V.
- Do not back-feed the `3V3` pin.
- Power budget (estimates; measure them during bring-up). Idle on Wi-Fi with
  modem sleep and long polling: about 35 to 60 mA from the battery, both
  converters included, which is 30 to 50 hours. Talking (recording, uploading,
  playing): about 250 to 400 mA while it happens. Mixed desk use (a few minutes
  of talking an hour): about a day, often more. Charging at 1 A: about 2.5 hours
  from empty.

## Pin map and connectors

Pin labels are the Arduino labels (the Nano ESP32 core uses them by default). The
GPIO numbers are for the PCB designer: **check them against the official Nano
ESP32 pinout before routing a PCB**. Avoid D13 (the onboard LED), A2 (GPIO3, a
strapping pin) and B0 and B1 (the boot pins).

| Signal            | Nano pin | GPIO | Goes to                               | Notes                                                        |
| ----------------- | -------- | ---- | ------------------------------------- | ------------------------------------------------------------ |
| Amp BCLK          | D2       | 5    | MAX98357A BCLK                        | I2S port 1, TX                                               |
| Amp LRCLK         | D3       | 6    | MAX98357A LRC                         |                                                              |
| Amp data          | D4       | 7    | MAX98357A DIN                         |                                                              |
| Amp enable        | D5       | 8    | MAX98357A SD                          | High is on; low when silent (saves power, no hiss)           |
| LED data          | D6       | 9    | Skin connector pin 3 via 330 ohm      | WS2812B chain in the figure                                  |
| Mic SCK           | D7       | 10   | Mic SCK                               | I2S port 0, RX, 16 kHz                                       |
| Mic WS            | D8       | 17   | Mic WS                                |                                                              |
| Mic data          | D9       | 18   | Mic SD                                |                                                              |
| Talk button       | D10      | 21   | Skin connector pin 4                  | `INPUT_PULLUP`, active low, an RTC pin so it wakes the board |
| Battery sense     | A0       | 1    | VSYS divider 220 k / 220 k and 100 nF | ADC1                                                         |
| Charging          | A1       | 2    | bq24074 CHG (open drain)              | 10 k pull-up to 3V3; low means charging                      |
| USB power present | A3       | 4    | bq24074 PGOOD (open drain)            | 10 k pull-up to 3V3; low means plugged in                    |
| Skin ID           | A6       | 13   | Skin connector pin 5                  | 10 k pull-up to 3V3 on the core board                        |
| Mic switch sense  | A7       | 14   | Switched mic VDD via 100 k            | High means the mic is on                                     |

**Skin connector** (JST-PH 5-pin, on the core board, with the cable through the
figure's foot): 1 VSYS, 2 GND, 3 LED DIN, 4 BUTTON, 5 SKIN ID.

**Skin ID.** The figure's chest module carries one resistor from pin 5 to GND.
With the 10 k pull-up the pin reads: Nova (10 k) about 1.65 V, Zib (22 k) about
2.27 V, Comet (47 k) about 2.72 V, and no figure 3.3 V. The firmware picks the
pet's name, voice and light roles from it, so the same pad works under any of the
three figures.

**Mic connector** (JST-PH 5-pin): 1 MIC VDD (switched 3V3), 2 GND, 3 SCK, 4 WS,
5 SD. **Speaker connector** (JST-PH 2-pin): amp + and -.

## What the lights mean

The LED chain in each figure, in order:

| Figure | LED 0                                    | LED 1                                     | LED 2              |
| ------ | ---------------------------------------- | ----------------------------------------- | ------------------ |
| Nova   | Chest light (behind the lime cap)        | Antenna ball                              | None               |
| Zib    | Belt buckle (behind the lime cap)        | Left antenna ball                         | Right antenna ball |
| Comet  | Collar tag (behind the lime diamond cap) | Inside the glass helmet (lights the dome) | None               |

The moods are the same as the app's pets. Colors: lime `#d9ff3f`, sky
`#6fd0ff`, nebula `#a596ff`, rose `#ff8fb1`, moon `#e4e2ef`, ivory `#f3efe6`.

| State                                            | Color  | Pattern                                                                          |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| Setting up Wi-Fi or pairing                      | sky    | Slow blink, antennas chase                                                       |
| Ready                                            | lime   | Soft breath every 6 seconds, low brightness                                      |
| Listening (the mic is recording)                 | lime   | Solid, full brightness. Always on while the mic records; no setting turns it off |
| Thinking (sending, waiting for the first answer) | lime   | 1 Hz pulse                                                                       |
| Speaking                                         | ivory  | Flickers with the voice level                                                    |
| Team working                                     | lime   | Antennas or dome alternate slowly                                                |
| Needs your Approve (in the app)                  | nebula | Slow blink every 2 seconds                                                       |
| Done                                             | lime   | Three quick sparkles, then Ready                                                 |
| Stopped or error                                 | rose   | Double blink                                                                     |
| Offline, saving notes                            | moon   | Slow breath                                                                      |
| Mic switched off                                 | rose   | Dim, solid, on the chest light                                                   |
| Low battery                                      | rose   | One blink every 10 seconds                                                       |
| Charging while idle                              | lime   | Slow fill-up pulse                                                               |
| Quiet hours                                      | off    | Only the antenna or dome, at 2 % moon                                            |

## The software, briefly

The program is [firmware/pet/](../../firmware/pet/README.md), built with PlatformIO
for this board. What a desk pet is, how it talks to OpenStellarFirm, the rules the code
must keep and what is not built yet are in
[docs/desk-pets-plan.md](../../docs/desk-pets-plan.md).

How it works, for the person at the desk:

- **Hold the lime light** (the chest light, belt buckle or collar tag; more than
  0.4 seconds) to start listening, and talk. The pet keeps listening while you talk,
  even after you let go, and stops when you have been silent for 5 seconds, at
  2 minutes, or when you tap the light again, which sends what you said at once.
  LED 0 is solid lime the whole time it records, with no setting, and the MIC switch
  cuts the microphone's power. The pet never listens by itself.
- A **tap** while it is not listening plays the waiting notice. A **double tap**
  asks what is happening. **Holding the light for 10 seconds while powering on**
  forgets the Wi-Fi and the pairing.
- With no Wi-Fi the pet saves what you said in its own memory and sends it when
  Wi-Fi returns.
- You set a pet up from a computer: plug the DATA port into it and use Set up over USB
  in Chrome or Edge ([docs/desk-pets-plan.md](../../docs/desk-pets-plan.md)).
  The first start also opens the pet's own Wi-Fi network, with a password the pet says
  out loud, for you to join on a phone instead. The pet can say the password, and the
  confirm code that ends either way, only from the boot pack in its firmware: render it
  before you flash a unit you will pair (the renderer is a later phase),
  or the password is twelve identical beeps and the unit can never be set up. A
  development unit does not encrypt its flash, so press Forget in OpenStellarFirm before
  giving a pet away ([Security](../../docs/desk-pets-plan.md)).

## Assembly order

1. Print every part (see [Printing](#printing)). Press the M3 heat-set inserts:
   four into the pad's bosses and two into the figure's feet.
2. **Pad top.** Glue the speaker into its ring, facing up. Glue the mic board under
   the mic hole with the port lined up and a foam ring around it. Hot-glue the
   slide switches behind their slots.
3. **Core board.** Solder the Nano ESP32 headers straight into the perfboard with
   its USB-C at the back edge, then the amp, charger, boost, resistors and JST
   connectors (the layout follows the pin map above). Run the
   [bring-up checklist](#bring-up-checklist) before you go on.
4. **Figure.** Solder the chest module (the switch, LED 0, the skin ID resistor and
   five wires to a JST-PH 5 plug). Thread the antenna or dome LED wires through
   their channels, glue the head to the body, and fit the lime cap and the bezel
   (the chest panel, belt or collar). Nova's module goes into the pocket through
   the chest panel's window, before the panel is glued in. Zib's and Comet's go in
   from the back, and `zib_back_cover` or `comet_back_cover` closes the hatch last.
5. **Figure on the pad.** Feed its cable through the wire hole and fix it with two
   M3 x 8 screws from inside the pad into the feet's inserts.
6. **Floor.** Put the battery into its tray and the core board onto the four posts
   (M2.5 screws). Plug in the battery, speaker, mic, skin and switch leads.
7. Close the pad with four M3 x 8 screws, stick the rubber feet on, charge it, and
   pair it ([docs/desk-pets-plan.md](../../docs/desk-pets-plan.md)).

## Bring-up checklist

Run this before you close the pad. The `bringup` firmware is the `bringup`
environment of `firmware/pet/` (phase 0 in the
[plan](../../docs/desk-pets-plan.md)).

1. Battery unplugged, USB-C in the CHARGE port: the charger's green power LED is
   on, VSYS is about 4.4 V, the 5 V rail is 5.0 V and the Nano's 3V3 is 3.3 V.
2. Plug in the battery: the charger's red LED is on while it charges.
3. Flash the `bringup` firmware over the Nano's USB-C (the DATA port). A new board
   needs its first flash through the chip's own bootloader: put a jumper wire
   between B1 and GND, press RST, take the wire out, then run
   `pio run -e bringup_first -t upload` in `firmware/pet/` (the steps, and the
   retry after an "Input/output error", are in the
   [firmware README](../../firmware/pet/README.md#first-flash-of-a-board)). Press
   RST to start it. Every second it prints the battery voltage, the charger state,
   the skin ID and the mic switch. At start it lights each LED in turn (lime, sky,
   nebula, rose) and plays a 1 kHz tone for one second.
4. Hold the chest light: the log shows the button, LED 0 turns lime, and the
   microphone records while you hold it (3 seconds at most), then plays it back and
   prints the peak level, so a dead microphone is plain to see. (That is the
   bring-up firmware only; the pet itself goes on listening after you let go.)
5. Slide MIC off: the log shows the mic off and LED 0 turns dim rose.
6. Measure the idle current at the battery lead. It should be under 60 mA with
   Wi-Fi connected.
7. Before you flash the pet itself (not the `bringup` firmware), render the boot
   pack (a later phase), which is written to
   `firmware/pet/include/generated/boot_pack.h`. **A unit cannot be set up without
   it**: the setup network's password and the confirm code are told only by voice, and
   without the pack every letter and digit is the same short tone.
8. With the pet firmware on the board (not the `bringup` firmware), plug the Nano's
   own USB-C, the DATA port, into the computer with a data cable and check that it
   enumerates as USB `2341:0070` (Arduino Nano ESP32): `lsusb` on Linux, System
   Information, USB on macOS, Device Manager, Ports on Windows. Then plug the same
   cable into the CHARGE port, and plug a charge-only cable into the DATA port: both
   must show **no** device. The OpenStellarFirm page's chooser is filtered to this ID, so a
   DATA port that shows another ID, or none, never appears in it. The setup itself is the
   [bring-up over USB](../../firmware/pet/README.md#bring-up-over-usb) in the firmware
   README.

## Core board v2 brief

For a mechanical engineer or any PCB designer. The v1 perfboard becomes a 2-layer PCB (4 layers preferred for
a good RF ground) with the **same outline, holes and connectors**, so the printed
pad does not change.

- **Outline.** 70 x 50 mm and 1.6 mm thick, with four 2.7 mm holes for M2.5 at the
  corners of a 66 x 46 mm rectangle, centered on the board.
- **The Nano.** Keep it socketed on two 15-pin 2.54 mm rows, 15.24 mm apart, so a
  board can be swapped. Place it so its **USB-C sits at the board's back edge**
  and its antenna end (the far end from the USB-C) faces away from the battery.
  No copper pour and no parts under the antenna end.
- **On the board.** The BQ24074 (a USB-C receptacle with 5.1 k CC pull-downs,
  ISET set for 1 A, TS with a 10 k NTC or a fixed 10 k), the TPS61023 5 V boost,
  the MAX98357A (gain on the GAIN pin, SD to D5), the battery divider and the
  pull-ups from the pin map, 470 uF on VSYS near the skin connector, ESD
  protection on the USB-C data lines and the skin connector lines, and test points
  for VBAT, VSYS, 5V, 3V3 and GND.
- **Connectors.** J1 battery (JST-PH 2), J2 skin (JST-PH 5), J3 speaker (JST-PH 2),
  J4 mic (JST-PH 5), J5 POWER switch (3-pin), J6 MIC switch (3-pin).
- **The charger's USB-C** must sit at the back edge, 28 mm from the Nano's USB-C
  on the -X side. The pad's back wall has CHARGE at x = -14 mm and DATA at
  x = +14 mm, measured from the pad's centerline, both at the board's back edge.

## LiPo safety

LiPo cells puncture and burn.

- Never crush or pierce the cell. Keep it away from screws and the insert tip.
- Use a cell with a protection board, and check the plug polarity before you plug
  it in: the same JST-PH plug is wired both ways by different makers.
- Charge on a hard surface the first time, and stop if the cell swells.
- Close the pad only after the bring-up checklist passes.

## Later: a product

A cheaper production board (v3) replaces the Nano with an ESP32-S3-WROOM-1-N16R8
module and a bottom-port ICS-43434 microphone. Selling units then needs CE/RED and
FCC testing (the radio module is pre-certified, the finished product is not) and
UN38.3 certified cells. Those come before any unit is sold: the first units are test
builds, and production units also need the phase 4 hardening
(flash encryption, secure boot, signed updates) described in
[docs/desk-pets-plan.md](../../docs/desk-pets-plan.md).
