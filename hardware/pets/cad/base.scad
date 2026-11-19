// OpenStellarFirm desk pets: the launch pad.
//
// The shared base that Nova, Zib and Comet stand on. It holds the electronics:
// speaker and microphone in the top, two USB-C ports in the back wall, two
// slide switches in the side walls, the battery and the core board on the floor.
// OpenSCAD 2021.01, millimetres, self-contained (no include or use).
//
// Parts (command line: -D 'part="..."' -D 'layout="view"|"print"'):
//   base_shell       top plate and side wall, open at the bottom
//   base_floor       3 mm plate with the battery tray and the core board posts
//   base_ring_inlay  lime ring that presses into the groove in the top plate
//   assembly         all three in place, coloured (the default, for PNG renders)
//
// layout "view"  = the part in world (base) coordinates, where it sits assembled.
// layout "print" = the part alone, in print orientation, resting on z = 0 and
//                  centred on x = y = 0 (shell upside down, floor flat with the
//                  posts up, inlay flat).
//
// Coordinates: Z up, the front of the pad faces -Y (the viewer's left is -X when
// you look at the front). The origin is the centre of the round front arc and
// z = 0 is the underside of the pad (the rubber feet are not modelled).
// A figure stands on the pad at (0, +8, 36).

// ---- what to build (command line) -----------------------------------------
part = "assembly"; // base_shell | base_floor | base_ring_inlay | assembly
layout = "view"; // "view" = world position, "print" = print orientation

// true: the assembly's shell is evaluated with CGAL even in the quick preview, so the
// engraved labels and the grille draw cleanly. Slower (about 15 s); the PNG exports use it.
crisp_preview = false;

fn_view = 48; // $fn for viewer exports and PNGs
fn_print = 96; // $fn for print exports
fn_text = 16; // curve detail of the engraved text (keeps CGAL fast)
fn_grille = 12; // the grille holes are 12-gons on purpose
// Bold sans that OpenSCAD ships with; "DejaVu Sans:style=Bold" works too.
font = "Liberation Sans:style=Bold";

// ---- colours (assembly preview only) ---------------------------------------
pad_color = "#1b1b22"; // night, lightened so it shows on a dark background
lime_color = "#d9ff3f"; // lime

// ---- outline: a "D" (circle cut flat at the back) ---------------------------
pad_r = 60; // radius of the round front arc
pad_back_y = 40; // outer face of the flat back wall
pad_h = 36; // total height, z 0..36
wall = 2.4; // side wall thickness
plate = 2.4; // top plate thickness (z 33.6..36)
chamfer = 2; // 45 degree chamfer on the top outer edge

// ---- floor ------------------------------------------------------------------
floor_t = 3; // floor thickness, z 0..3
floor_gap = 0.3; // clearance between the floor and the wall
floor_inset = wall + floor_gap; // the floor outline is the D inset by this (2.7)

// ---- speaker (faces up under the front grille) -------------------------------
spk_c = [0, -34]; // grille and speaker centre
grille_d = 34; // diameter of the circle the grille holes sit in
hole_d = 2.0; // grille hole diameter
hole_pitch = 3.2; // hex grid pitch
spk_ring_id = 40.6; // ring for the 40 mm speaker
spk_ring_wall = 1.6;
spk_ring_h = 5; // hangs from the plate down to z 28.6

// ---- microphone (round module under a port hole) ---------------------------
mic_c = [28, -40]; // port hole centre
mic_hole_d = 1.6;
mic_pocket_id = 14.6; // pocket for the round mic module
mic_pocket_wall = 1.2;
mic_pocket_h = 3;

// ---- where the figure stands -------------------------------------------------
fig_screws = [[-12, 8], [12, 8]]; // two M3 clearance holes (the figure's inserts)
fig_screw_d = 3.4;
fig_cable_c = [0, 4]; // the figure's cable hole
fig_cable_d = 10;

// ---- lime ring ----------------------------------------------------------------
ring_inset = 6; // centre line of groove and ring: the D inset by this
groove_w = 3.0;
groove_depth = 1.6;
inlay_w = 2.7; // 0.15 clearance each side of the groove
inlay_h = 2.0; // 1.6 in the groove plus 0.4 proud

// ---- screw bosses (hang from the top plate; M3 heat-set inserts) ---------------
boss_pos = [[-46, -10], [46, -10], [-40, 30], [40, 30]]; // floor holes match these
boss_d = 8;
boss_bottom_z = floor_t; // the boss ends on the floor's top face
insert_d = 4.0; // hole for an M3 heat-set insert
insert_depth = 6;

// ---- key rib (shell) and notch (floor) ------------------------------------------
key_w = 5.6;
key_d = 1.6;
key_h = 3; // rib z 0..3 on the inner back wall
key_notch_w = 6;
key_notch_d = 2;

// ---- back wall: two USB-C ports with a recess and a label --------------------
port_w = 12.5;
port_h = 7.5;
port_r = 2.5; // corner radius of the slots
charge = [-14, 19.0]; // [x, z] centre of the CHARGE port (the charger's USB-C)
data = [14, 21.5]; // [x, z] centre of the DATA port (the Nano's USB-C)
recess_w = 16; // outside recess so a USB-C plug seats fully
recess_h = 11;
recess_depth = 1.0;
recess_r = 1.5;
label_size = 4; // text height of CHARGE and DATA
label_depth = 0.5; // engraving depth of every label
label_gap = 1.5; // gap between the recess and its label

// ---- side wall: two slide switches ----------------------------------------------
sw_w = 10.0; // slot length along the wall
sw_h = 4.6; // slot height
sw_z = 10; // slot centre height
power_angle = 20; // polar angle, from +X toward +Y (back right)
mic_angle = 160; // back left
sw_label_size = 3.5;
sw_label_gap = 1.8; // gap between the slot and its label

// ---- floor: battery tray and core board posts ------------------------------------
tray_inner = [63, 38]; // pocket for the battery (60 x 36 x 7.5 mm cell)
tray_c = [0, 12];
tray_h = 6; // corner walls stand this high above the floor
tray_t = 1.6;
tray_leg = 10; // length of each leg of an L
post_pos = [[-33, -11], [33, -11], [-33, 35], [33, 35]]; // 66 x 46 board holes
post_d = 6;
post_top = 14; // z of the post tops
pilot_d = 2.2; // M2.5 self-tapping pilot
pilot_depth = 8;
post_edge_margin = 0.4; // posts never reach nearer the floor edge than this
screw_clear_d = 3.4; // M3 clearance through the floor
csk_d = 6.6; // countersink diameter at the underside (90 degrees)
foot_d = 10.5; // rubber foot recesses on the underside
foot_depth = 1.0;
// Front feet as specified. The back feet sit at x = +-28, not +-36, because the
// countersunk screw at (+-40, 30) would otherwise be covered by the foot.
feet = [[-42, -28], [42, -28], [-28, 28], [28, 28]];
underside_text = "OpenStellarFirm desk pet";
underside_text_size = 5;
underside_text_y = 8;

// ---- derived --------------------------------------------------------------------
pad_cy = (pad_back_y - pad_r) / 2; // y of the footprint centre (-10)
$fn = layout == "print" ? fn_print : fn_view;

// ---- 2D helpers ---------------------------------------------------------------

// The "D": a circle of radius r cut flat at y = flat_y.
module d_shape(r, flat_y) {
  intersection() {
    circle(r = r);
    translate([-r - 1, -r - 1]) square([2 * r + 2, flat_y + r + 1]);
  }
}

// The outline inset by w. Exact for a D (the erosion of an intersection of
// convex shapes is the intersection of their erosions), so no offset() needed.
module d_inset(w) {
  d_shape(pad_r - w, pad_back_y - w);
}

// A band of width w whose centre line is the outline inset by centre_inset.
module d_band(centre_inset, w) {
  difference() {
    d_inset(centre_inset - w / 2);
    d_inset(centre_inset + w / 2);
  }
}

module rounded_rect(w, h, r) {
  offset(r = r) square([w - 2 * r, h - 2 * r], center = true);
}

// Hex grid of small holes clipped to a circle (every hole fully inside it).
module grille_2d() {
  row_dy = hole_pitch * sqrt(3) / 2;
  rows = ceil(grille_d / 2 / row_dy);
  cols = ceil(grille_d / 2 / hole_pitch) + 1;
  for (j = [-rows : rows], i = [-cols : cols]) {
    x = (i + (j % 2 == 0 ? 0 : 0.5)) * hole_pitch;
    y = j * row_dy;
    if (norm([x, y]) <= grille_d / 2 - hole_d / 2)
      translate([x, y]) circle(d = hole_d, $fn = fn_grille);
  }
}

// ---- shell ----------------------------------------------------------------------

// Straight walls up to the chamfer, then a 45 degree chamfer on the top edge.
// The body is convex, so a hull of the wall prism and a thin slab does it.
module outer_body() {
  hull() {
    linear_extrude(height = pad_h - chamfer) d_shape(pad_r, pad_back_y);
    translate([0, 0, pad_h - 0.01]) linear_extrude(height = 0.01) d_inset(chamfer);
  }
}

// Everything that goes through the top plate.
module top_holes_2d() {
  translate(spk_c) grille_2d();
  translate(mic_c) circle(d = mic_hole_d);
  for (p = fig_screws) translate(p) circle(d = fig_screw_d);
  translate(fig_cable_c) circle(d = fig_cable_d);
}

module top_cuts() {
  z0 = pad_h - plate;
  translate([0, 0, z0 - 0.5]) linear_extrude(height = plate + 1.5) top_holes_2d();
  // lime ring groove
  translate([0, 0, pad_h - groove_depth])
    linear_extrude(height = groove_depth + 1) d_band(ring_inset, groove_w);
}

// Text engraved into the flat back wall, reading correctly from behind.
module back_label(x, z, txt) {
  translate([x, pad_back_y - label_depth, z]) rotate([90, 0, 180])
    linear_extrude(height = label_depth + 1)
      text(txt, size = label_size, font = font, halign = "center", valign = "baseline", $fn = fn_text);
}

module back_cuts() {
  for (p = [charge, data]) {
    // the port, through the wall
    translate([p[0], pad_back_y + 1, p[1]]) rotate([90, 0, 0])
      linear_extrude(height = wall + 2) rounded_rect(port_w, port_h, port_r);
    // the recess on the outside
    translate([p[0], pad_back_y + 1, p[1]]) rotate([90, 0, 0])
      linear_extrude(height = recess_depth + 1) rounded_rect(recess_w, recess_h, recess_r);
  }
  back_label(charge[0], charge[1] + recess_h / 2 + label_gap, "CHARGE");
  back_label(data[0], data[1] + recess_h / 2 + label_gap, "DATA");
}

// Text engraved into the curved side wall, reading along the wall seen from
// outside. The cut is clipped to a thin shell so the engraving is a constant
// label_depth deep on the curve.
module side_label(a, txt) {
  z_base = sw_z + sw_h / 2 + sw_label_gap;
  rotate([0, 0, a]) intersection() {
    translate([pad_r - 3, 0, z_base]) rotate([90, 0, 90])
      linear_extrude(height = 6)
        text(txt, size = sw_label_size, font = font, halign = "center", valign = "baseline", $fn = fn_text);
    // a small patch of the thin shell around the label (not a full ring, which
    // would span planes shared with the rest of the shell)
    translate([0, 0, z_base - 1]) linear_extrude(height = sw_label_size + 2)
      intersection() {
        rotate([0, 0, -a]) difference() {
          circle(r = pad_r + 1);
          circle(r = pad_r - label_depth);
        }
        translate([pad_r - 3, -12]) square([6, 24]);
      }
  }
}

module side_cuts() {
  for (a = [power_angle, mic_angle]) rotate([0, 0, a])
    // radial slot through the curved wall
    translate([pad_r - wall - 1, -sw_w / 2, sw_z - sw_h / 2]) cube([wall + 3, sw_w, sw_h]);
  side_label(power_angle, "POWER");
  side_label(mic_angle, "MIC");
}

// Ring for the speaker and pocket for the microphone, hanging from the plate.
// The two overlap a little, and each hollow wins over the other ring's wall so the
// speaker and the microphone module both fit.
module speaker_and_mic_rings() {
  z_plate = pad_h - plate; // underside of the top plate
  z_top = z_plate + 0.4; // the rings reach into the plate so they fuse with it
  z_spk = z_plate - spk_ring_h;
  z_mic = z_plate - mic_pocket_h;
  // The pocket ring would stand only 0.2 mm off the side wall, a gap too thin to print,
  // so a small web along the radial line fuses it to the wall (and braces the ring).
  web_r0 = norm(mic_c) + mic_pocket_id / 2 + 0.2; // inside the ring's wall
  web_r1 = pad_r - wall + 0.6; // 0.6 mm into the side wall
  difference() {
    union() {
      translate([spk_c[0], spk_c[1], z_spk])
        cylinder(d = spk_ring_id + 2 * spk_ring_wall, h = z_top - z_spk);
      translate([mic_c[0], mic_c[1], z_mic])
        cylinder(d = mic_pocket_id + 2 * mic_pocket_wall, h = z_top - z_mic);
      rotate([0, 0, atan2(mic_c[1], mic_c[0])]) translate([web_r0, -1, z_mic])
        cube([web_r1 - web_r0, 2, z_top - z_mic]);
    }
    // The hollows run clear through the ring tops, so a ring is only ever a wall
    // and never plugs the grille or the microphone hole in the plate.
    translate([spk_c[0], spk_c[1], z_spk - 1]) cylinder(d = spk_ring_id, h = z_top - z_spk + 2);
    translate([mic_c[0], mic_c[1], z_mic - 1]) cylinder(d = mic_pocket_id, h = z_top - z_mic + 2);
  }
}

// Screw boss: hangs from the plate to the floor, M3 insert hole in its bottom end.
module boss(p) {
  z_top = pad_h - plate + 0.4;
  translate([p[0], p[1], boss_bottom_z]) difference() {
    cylinder(d = boss_d, h = z_top - boss_bottom_z);
    translate([0, 0, -1]) cylinder(d = insert_d, h = insert_depth + 1);
  }
}

// Key rib on the inner back wall. Its tip is chamfered at 45 degrees so it prints
// without support when the shell stands upside down.
module key_rib() {
  y_in = pad_back_y - wall;
  rotate([90, 0, 90]) linear_extrude(height = key_w, center = true)
    polygon([
      [y_in + 0.5, 0],
      [y_in - key_d, 0],
      [y_in - key_d, key_h - key_d],
      [y_in, key_h],
      [y_in + 0.5, key_h]
    ]);
}

module base_shell() {
  union() {
    difference() {
      outer_body();
      // the hollow, open at the bottom
      translate([0, 0, -1]) linear_extrude(height = pad_h - plate + 1) d_inset(wall);
      top_cuts();
      back_cuts();
      side_cuts();
    }
    speaker_and_mic_rings();
    for (p = boss_pos) boss(p);
    key_rib();
  }
}

// ---- floor ----------------------------------------------------------------------

// One L-shaped corner wall of the battery tray. The pocket corner is the origin
// and the pocket lies toward -x, -y; the wall is outside it.
module tray_corner() {
  h = tray_h + 0.5; // starts 0.5 inside the floor so it fuses with it
  translate([-tray_leg, 0, 0]) cube([tray_leg + tray_t, tray_t, h]);
  translate([0, -tray_leg, 0]) cube([tray_t, tray_leg + tray_t, h]);
}

module battery_tray() {
  hw = tray_inner[0] / 2;
  hd = tray_inner[1] / 2;
  for (sx = [-1, 1], sy = [-1, 1])
    translate([tray_c[0] + sx * hw, tray_c[1] + sy * hd, floor_t - 0.5])
      mirror([sx < 0 ? 1 : 0, 0, 0]) mirror([0, sy < 0 ? 1 : 0, 0]) tray_corner();
}

// Posts for the core board. The back pair would reach the wall (y = 35 plus the
// 3 mm radius is 38, past the floor edge at 37.3), so every post is clipped to the
// floor outline inset by post_edge_margin; only the back pair is touched.
module board_posts() {
  intersection() {
    for (p = post_pos) translate([p[0], p[1], floor_t - 0.5]) cylinder(d = post_d, h = post_top - floor_t + 0.5);
    translate([0, 0, floor_t - 1]) linear_extrude(height = post_top)
      d_inset(floor_inset + post_edge_margin);
  }
}

module base_floor() {
  difference() {
    union() {
      linear_extrude(height = floor_t) d_inset(floor_inset);
      battery_tray();
      board_posts();
    }
    // pilot holes in the posts
    for (p = post_pos) translate([p[0], p[1], post_top - pilot_depth])
      cylinder(d = pilot_d, h = pilot_depth + 1);
    // countersunk M3 holes, one under each boss; the head sits flush underneath
    for (p = boss_pos) translate([p[0], p[1], 0]) {
      translate([0, 0, -1]) cylinder(d = screw_clear_d, h = floor_t + 2);
      cone_h = (csk_d - screw_clear_d) / 2 + 1;
      translate([0, 0, -1]) cylinder(d1 = csk_d + 2, d2 = screw_clear_d, h = cone_h);
    }
    // key notch at the middle of the flat back edge
    translate([-key_notch_w / 2, pad_back_y - floor_inset - key_notch_d, -1])
      cube([key_notch_w, key_notch_d + 1, floor_t + 2]);
    // rubber foot recesses on the underside
    for (p = feet) translate([p[0], p[1], -1]) cylinder(d = foot_d, h = foot_depth + 1);
    // text on the underside, mirrored so it reads from below
    translate([0, underside_text_y, -1]) linear_extrude(height = label_depth + 1)
      mirror([1, 0, 0])
        text(underside_text, size = underside_text_size, font = font, halign = "center", valign = "center", $fn = fn_text);
  }
}

// ---- lime ring inlay ---------------------------------------------------------------

module base_ring_inlay() {
  translate([0, 0, pad_h - groove_depth]) linear_extrude(height = inlay_h) d_band(ring_inset, inlay_w);
}

// ---- assembly and layout -----------------------------------------------------------

module preview_shell() {
  if (crisp_preview) render(convexity = 10) base_shell();
  else base_shell();
}

module assembly() {
  color(pad_color) preview_shell();
  color(pad_color) base_floor();
  color(lime_color) base_ring_inlay();
}

module place_shell() {
  if (layout == "print") translate([0, pad_cy, pad_h]) rotate([180, 0, 0]) base_shell();
  else base_shell();
}

module place_floor() {
  if (layout == "print") translate([0, -pad_cy, 0]) base_floor();
  else base_floor();
}

module place_ring_inlay() {
  if (layout == "print") translate([0, -pad_cy, -(pad_h - groove_depth)]) base_ring_inlay();
  else base_ring_inlay();
}

if (part == "assembly") assembly();
else if (part == "base_shell") place_shell();
else if (part == "base_floor") place_floor();
else if (part == "base_ring_inlay") place_ring_inlay();
else assert(false, str("unknown part: ", part));
