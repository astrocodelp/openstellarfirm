// OpenStellarFirm desk pet: Comet, the space cat in a glass helmet (the owner's "cat" pet).
//
// OpenSCAD 2021.01, millimetres. Self-contained: no include or use.
// Coordinates (the same for every desk pet figure):
//   * Z is up and the FRONT of the figure faces -Y. Viewer's left is -X, so the
//     tail (curling out to the viewer's left in the drawing) is at -X.
//   * Figure coordinates: origin at the bottom centre of the figure, z = 0
//     where it stands. In the world it stands at fig = (0, 8, 36) on the
//     launch pad, so the two M3 insert holes land at world (+-12, 8).
//
// Command line variables:
//   part   = "assembly" (default) or one part id from the list below
//   layout = "view"  the part in world (launch pad) coordinates, as assembled
//            "print" the part alone in a good print orientation, resting on
//                    z = 0 and centred on x = y = 0
//   cut / cut_at: debug only. Removes everything beyond a world plane
//                 (cut = "x", "y" or "z" at cut_at) so the pocket, the channels
//                 and the insert holes can be looked at; use a full render (F6),
//                 the preview does not draw the cut faces.
//
// Parts (qty 1 each):
//   comet_body         fur-colour egg body with arms, legs and paws, the tail
//                      (a thick tube that rests on the pad to the left), the neck
//                      and its 10 x 6 peg. Holds the insert holes, the 7 mm cable
//                      channel, the chest pocket, the seat for the tag bezel, the
//                      hatch in the BACK and the 5 mm LED channel.
//   comet_back_cover   fur-colour plug that closes the hatch (20 x 20, 0.15 mm
//                      clear per side, press fit plus a drop of glue). Its inner
//                      face backs the chest board.
//   comet_belly        light belly inlay (an oval skin of the chest, 0.4 mm proud), glued
//                      into a recess; the bezel plate's seat leaves a hole in it.
//   comet_head         fur-colour cat head with two ears, eye recesses, a raised
//                      nose, forehead stripes, whisker and mouth grooves, the
//                      neck socket and the LED channel to LED 1 on the back.
//   comet_collar       purple ring at the neck, with the tag bezel: a tongue that
//                      leaves through a notch in the dome's bottom band and a diamond
//                      plate (window and flange pocket) glued into a seat on the chest.
//                      Printed upside down: the flat top of the ring on the bed.
//   comet_tag_cap      translucent lime diamond tag (the talk button): flange
//                      behind the bezel's lip and a stem that stops 0.3 mm short
//                      of the chest switch.
//   comet_dome_top     clear upper half of the glass helmet (equator face down).
//   comet_dome_bottom  clear lower band, open at the bottom where it sits on the
//                      body's shoulders (equator face down when printed).
//   View only (for the 3D viewer, never printed: layout "print" refuses them).
//   Each is a 0.3 mm paint skin standing 0.05 mm proud of the surface it covers:
//   comet_paint_pink   the inner faces of the two ears, pink.
//   comet_paint_nose   the raised nose, a deeper pink.
//   comet_paint_dark   the eyes, dark.
//
// Design notes:
//   * The pocket (22 x 22 x 15 behind a 1.2 mm front wall) is reached from the BACK through a
//     20.3 x 20.3 hatch that the back cover plugs. The board's back face rests on the cover's
//     inner face (the pocket's back wall, y = -4.3), so a press on the tag cannot push it away.
//   * The body is flat on top at z = 42: a disc of radius 17.5 about the neck axis. The dome's
//     open rim (radius 13.8 to 17.5 at that height) and the collar both stand on it.
//   * Face details are cut as a skin layer (skin_cut): eyes 1.4 mm deep for paint or inserts,
//     stripes, whiskers and mouth 0.7 mm deep; the nose and the ears' pink faces are for paint.
//   * Everything in assembly() marked "picture only" changes the preview, never an STL.
//
// The glass helmet: a printed dome is never crystal clear. For a crystal clear helmet buy a
// 60 or 70 mm clear ornament ball and set dome_d to match, then skip the two dome parts. The
// figure is made for the 66 mm dome: with another ball check that the ears and the collar clear
// its wall, that its opening (saw the neck cap off) stands on the shoulder disc (radius top_R,
// z = body_z1) and that dome_cz keeps the figure within 105 mm.
//
// Assembly order:
//   1. Press two M3 heat-set inserts into the paws.
//   2. Press the tag cap into the collar's plate from behind (the lip keeps it in),
//      then slide the collar over the neck and glue it on the shoulders, the plate
//      into its seat on the chest and the tongue on the shoulder's front edge.
//   3. Solder the chest module (switch, LED 0, skin ID resistor) on a board up to
//      about 19.6 x 19.6 mm, switch facing FORWARD. Slide it into the pocket through the hatch
//      in the back, switch toward the tag, and run its wires down the 7 mm channel.
//      Press the back cover in last: it holds the board against the cover's face.
//   4. Put LED 1 (a 10 mm board) in the seat on the back of the head and thread its
//      wires through the head's 5 mm channel, the neck peg and the body's channel
//      into the pocket. Glue the head on the neck (peg in the socket).
//   5. Glue the belly inlay into its recess. Glue the two dome halves together at the
//      equator, then the dome onto the shoulders (the notch goes over the tongue).

part   = "assembly";
layout = "view";
cut    = "";   // "", "x", "y" or "z"
cut_at = 0;    // world coordinate of the cutting plane

// ---------------------------------------------------------------- resolution
fn_view  = 48;   // viewer exports
fn_print = 96;   // print exports (kept under 12 MB per STL)
pretty   = layout == "print" || part == "assembly";   // PNG previews look best smooth
fn_big   = pretty ? fn_print : fn_view;               // head, dome
fn_mid   = pretty ? 48 : 32;                          // rounded corners 4 to 11 mm
fn_sml   = pretty ? 40 : 24;                          // pegs, holes, small details
$fn = fn_mid;
eps = 0.02;      // overlap so unions and cuts never leave coincident faces

// ---------------------------------------------------------------- placement
fig = [0, 8, 36];                    // figure origin in world (launch pad) coordinates

// ---------------------------------------------------------------- palette (the OpenStellarFirm pet colours)
c_fur    = "#bcc6d9";  c_light = "#edf1f7";  c_stripe = "#7f8ba6";  c_ear  = "#f2a9cb";
c_nose   = "#e88db6";  c_eye   = "#14121e";  c_collar = "#8a7cf4";  c_lime = "#d9ff3f";
c_pad    = "#1b1b22";
c_glass  = [0.86, 0.92, 1.0, 0.16];  // clear helmet in the picture (four surfaces stack, so each is faint)
lime_alpha = 0.85;                   // translucent tag in the picture

// ---------------------------------------------------------------- interface (shared by every figure)
ax = [0, -4];                         // x, y of the neck axis: cable channel, LED channel, peg, collar, head and dome
cable_d = 7;                          // cable channel, vertical, from the sole into the pocket
led_d = 5;                            // LED wire channels
insert_x = 12;  insert_d = 4.0;  insert_depth = 6.5;   // M3 heat-set inserts at (+-12, 0)
peg_d = 10;  peg_exposed = 6;         // neck peg 10 x 6 on the body
socket_d = 10.4;  socket_depth = 6.5; // socket in the head (0.2 clearance a side)

// ---------------------------------------------------------------- paws, legs and the web between them
paw_w = 17;  paw_d = 20;  paw_h = 7.5;  paw_r = 3.5;   // rounded box, flat sole
paw_x = 11;  paw_y = -2;              // paws stand at x = +-11; the holes at (+-12, 0) land inside them
leg_d = 14;  leg_z0 = 5;  leg_z1 = 17;
web_x = 7;  web_y0 = -8.7;  web_y1 = 2.5;  web_z1 = 15; // block that joins the legs around the cable channel
toe_w = 0.9;  toe_depth = 0.7;  toe_h = 4.5;           // two toe grooves on every paw

// ---------------------------------------------------------------- body: an egg, round and wide low, flat on top
body_w = 46;                          // widest at z = 23
body_y0 = -23;  body_y1 = 15;         // 38 deep, centred on the axis (y = -4)
body_z0 = 10;  body_z1 = 42;          // the dome and the collar stand on the flat top at z = 42
body_rb = 13;  body_rt = 1.5;         // bottom and top edge radii
top_R = 17.5;                         // the flat top is a disc of this radius about the axis: the dome's seat
front_xt = 12;                        // the top's front corners: keep the chest front flat out to x = +-13.5

// arms (the drawing has two small ones hugging the body)
arm_r = 4.6;  hand_r = 5.2;
shoulder = [22.9, -4, 35.5];          // per side (x mirrored)
hand_c   = [26.6, -4, 24.5];

// ---------------------------------------------------------------- tail: a thick tube that curls out to -X and up at the tip
tail_pts = [[-17, 8, 15], [-24, 10, 9.5], [-31, 10, 5.4], [-36.5, 9, 6.0],
            [-38.6, 7.5, 12], [-38.0, 6.5, 19], [-35.0, 6, 24]];
tail_rad = [5.8, 5.9, 5.9, 5.5, 5.2, 4.8, 4.3];   // leftmost edge at x = -43.8, inside the -44 limit

// ---------------------------------------------------------------- neck
neck_z1 = 49.0;                       // head seat height (the chin is cut flat here)
neck_r0 = 8.1;  neck_r1 = 7.0;        // cone from the shoulders to the head

// ---------------------------------------------------------------- chest pocket, tag bezel and cap
chest_z = 29.8;                       // centre height of the tag, the pocket and the hatch
pocket_w = 22;  pocket_h = 22;  pocket_d = 15;
front_wall = 1.2;  stem_hole_d = 7;   // wall between the seat and the pocket, with a hole for the stem
plate_side = 15.6;  plate_r = 2.5;  plate_t = 3.4;   // the bezel plate: a rounded diamond
seat_depth = 2.5;                     // the seat floor lies this far behind the chest front
seat_clear = 0.2;                     // per side, plate in its seat
seat_floor_y  = body_y0 + seat_depth;
plate_front_y = seat_floor_y - plate_t;
pocket_y0 = seat_floor_y + front_wall;
pocket_y1 = pocket_y0 + pocket_d;     // the pocket's back wall: the board and the cover's inner face
pocket_z0 = chest_z - pocket_h / 2;
pocket_z1 = chest_z + pocket_h / 2;
hatch_w = 20;  hatch_clear = 0.15;    // the back cover is 20 x 20, the hatch 0.15 larger a side
tag_side = 10;  tag_r = 1.2;          // the diamond cap
cap_clear = 0.3;  cap_proud = 0.6;
lip_t = 1.6;                          // bezel in front of the flange; keeps the cap in
flange_side = 12.2;  flange_t = 1.0;
stem_d = 5;
board_t = 1.6;  switch_h = 9.5;  stem_gap = 0.3;
tongue_w = 5.4;  tongue_z1 = 46.3;    // the bezel's tongue up to the collar

// ---------------------------------------------------------------- collar
col_R = 11.4;  col_r = 3.0;  col_cz = 44.3;   // torus: centre-line radius, tube radius, centre height

// ---------------------------------------------------------------- head
head_c = [0, -4, 65.5];               // centre of the head (the drawing has it a little below the helmet's centre)
head_a = [23, 18.5, 19.5];            // half sizes: 46 wide, 37 deep, 39 tall (the spec said about 44 x 36 x 38)
led_seat_d = 10.6;  led_seat_depth = 3.2;  // seat for the 10 mm LED 1 board on the back of the head

// ---------------------------------------------------------------- belly inlay
belly_c = [0, 26];  belly_ab = [12, 12.5];    // ellipse in x, z (centre, half sizes): the light patch behind and below the tag
belly_depth = 1.2;  belly_proud = 0.4;  belly_clear = 0.15;

// ---------------------------------------------------------------- glass helmet
dome_d = 66;  dome_wall = 1.8;        // for a bought clear ball set dome_d to its diameter
dome_cz = 70;                         // sphere centre height; the sphere is centred on the axis ax
dome_cut_z = body_z1;                 // the open bottom sits on the flat shoulders
notch_w = tongue_w + 1.0;             // notch in the dome's bottom band for the bezel's tongue

// ---------------------------------------------------------------- pad stand-in (assembly picture only)
pad_r = 60;  pad_flat_y = 40;  pad_h = 36;

// ================================================================ helpers

// OpenSCAD's sphere has no vertex on its poles, so a faceted sphere stops about
// half a percent short of its radius. This one reaches r on all three axes, so
// flat faces built from it (soles, the flat back) land exactly where the
// numbers say.
function sphere_k(n) = 1 / cos(90 / floor((n + 1) / 2));
module rsphere(r, n = fn_mid) { sphere(r = r * sphere_k(n), $fn = n); }

// Extrude a 2D shape (x, z of the figure) along Y from y0 to y1 (y1 > y0).
module yprism(y0, y1) {
  translate([0, y1, 0]) rotate([90, 0, 0]) linear_extrude(height = y1 - y0, convexity = 6) children();
}

module rrect2d(w, h, r) {
  offset(r = r, $fn = fn_sml) square([w - 2 * r, h - 2 * r], center = true);
}

// A square of the given side turned 45 degrees, corners rounded with radius r.
module diamond2d(side, r) {
  rotate(45) offset(r = r, $fn = fn_sml) square(side - 2 * r, center = true);
}

// Rounded box between corners a and b: hull of eight spheres, flat faces.
// The spheres are written out as direct children of hull(): a for loop inside
// hull() is unioned through CGAL first and takes 20 seconds instead of 0.1.
module rbox_ab(a, b, r) {
  x0 = a[0] + r;  x1 = b[0] - r;
  y0 = a[1] + r;  y1 = b[1] - r;
  z0 = a[2] + r;  z1 = b[2] - r;
  hull() {
    translate([x0, y0, z0]) rsphere(r);
    translate([x1, y0, z0]) rsphere(r);
    translate([x0, y1, z0]) rsphere(r);
    translate([x1, y1, z0]) rsphere(r);
    translate([x0, y0, z1]) rsphere(r);
    translate([x1, y0, z1]) rsphere(r);
    translate([x0, y1, z1]) rsphere(r);
    translate([x1, y1, z1]) rsphere(r);
  }
}

// The body's egg, offset inward by k (k < 0 grows it). The hull of eight spheres
// whose radii shrink by k is exactly the shape offset by k, so the inlay, its
// recess and the cover all follow the same surface.
module egg(k = 0) {
  rb = body_rb - k;  rt = body_rt - k;
  xb = body_w / 2 - body_rb;
  y0b = body_y0 + body_rb;        y1b = body_y1 - body_rb;
  zb = body_z0 + body_rb;         zt = body_z1 - body_rt;
  hull() {
    translate([-xb, y0b, zb]) rsphere(rb);
    translate([ xb, y0b, zb]) rsphere(rb);
    translate([-xb, y1b, zb]) rsphere(rb);
    translate([ xb, y1b, zb]) rsphere(rb);
    // top: a rounded ring of the dome's seat radius about the axis ...
    translate([ax[0], ax[1], zt]) rotate_extrude($fn = fn_mid, convexity = 4)
      translate([top_R - body_rt, 0]) circle(r = rt, $fn = 16);
    // ... and two corners that keep the chest front flat
    translate([-front_xt, body_y0 + body_rt, zt]) rsphere(rt);
    translate([ front_xt, body_y0 + body_rt, zt]) rsphere(rt);
  }
}

// ================================================================ comet_body

module arm_solid(s) {
  hull() {
    translate([s * shoulder[0], shoulder[1], shoulder[2]]) sphere(r = arm_r, $fn = fn_mid);
    translate([s * hand_c[0], hand_c[1], hand_c[2]]) sphere(r = arm_r, $fn = fn_mid);
  }
  translate([s * hand_c[0], hand_c[1], hand_c[2]]) sphere(r = hand_r, $fn = fn_mid);
}

module legs_solid() {
  for (s = [-1, 1]) {
    // paw: rounded box, flat sole at z = 0
    rbox_ab([s * paw_x - paw_w / 2, paw_y - paw_d / 2, 0],
            [s * paw_x + paw_w / 2, paw_y + paw_d / 2, paw_h], paw_r);
    translate([s * paw_x, paw_y, leg_z0]) cylinder(d = leg_d, h = leg_z1 - leg_z0, $fn = fn_mid);
  }
  // web: joins the legs and wraps the cable channel; set back behind the leg fronts
  rbox_ab([-web_x, web_y0, 0], [web_x, web_y1, web_z1], 1.5);
}

// The tail is a chain of tapered tubes: pairwise hulls of two spheres, with the
// for loop OUTSIDE the hull (a loop inside a hull is 200 times slower).
module tail_solid() {
  intersection() {
    union() for (i = [0 : len(tail_pts) - 2]) hull() {
      translate(tail_pts[i]) sphere(r = tail_rad[i], $fn = fn_mid);
      translate(tail_pts[i + 1]) sphere(r = tail_rad[i + 1], $fn = fn_mid);
    }
    translate([-60, -40, 0]) cube([120, 80, 60]);   // flat where it rests on the pad
  }
}

module neck_solid() {
  translate([ax[0], ax[1], body_z1 - 2]) cylinder(r = neck_r0, h = 2 + eps, $fn = fn_mid);
  translate([ax[0], ax[1], body_z1]) cylinder(r1 = neck_r0, r2 = neck_r1, h = neck_z1 - body_z1, $fn = fn_mid);
  translate([ax[0], ax[1], neck_z1 - eps]) cylinder(d = peg_d, h = peg_exposed + eps, $fn = fn_sml);
}

// The bezel plate (2D, x and z relative to the tag centre): a rounded diamond
// and the little neck that reaches up to the collar's tongue.
module plate2d() {
  diamond2d(plate_side, plate_r);
  translate([-tongue_w / 2, 6]) square([tongue_w, body_z1 + 0.2 - chest_z - 6]);
}

module chest_cuts() {
  // pocket for the chest module, centred behind the tag
  translate([0, 0, chest_z]) yprism(pocket_y0, pocket_y1) rrect2d(pocket_w, pocket_h, 3);
  // hole for the cap's stem through the front wall
  translate([0, 0, chest_z]) yprism(seat_floor_y - eps, pocket_y0 + eps) circle(d = stem_hole_d, $fn = fn_sml);
  // seat for the bezel plate: from the chest front back to the seat floor
  translate([0, 0, chest_z]) yprism(body_y0 - 3, seat_floor_y) offset(delta = seat_clear) plate2d();
  // hatch in the back: a tunnel from the pocket's back wall out through the back
  translate([0, 0, chest_z]) yprism(pocket_y1 - eps, body_y1 + 5) square(hatch_w + 2 * hatch_clear, center = true);
}

module toe_grooves() {
  for (s = [-1, 1], dx = [-2.6, 2.6])
    translate([s * paw_x + dx - toe_w / 2, paw_y - paw_d / 2 - eps, 0.9])
      cube([toe_w, toe_depth + eps, toe_h]);
}

// Ellipse for the belly inlay, extruded along y over the lower front of the belly.
module belly_prism(grow = 0) {
  translate([belly_c[0], 0, belly_c[1]]) yprism(body_y0 - 3, -17)
    offset(delta = grow) scale(belly_ab) circle(r = 1, $fn = fn_mid);
}

module comet_body() {
  difference() {
    union() {
      egg(0);
      for (s = [-1, 1]) arm_solid(s);
      legs_solid();
      tail_solid();
      neck_solid();
    }
    // two M3 heat-set insert holes, 4.0 x 6.5 from the sole, in the paws
    for (s = [-1, 1])
      translate([s * insert_x, 0, -eps]) cylinder(d = insert_d, h = insert_depth + eps, $fn = fn_sml);
    // cable channel: 7 mm, vertical, from the sole up into the chest pocket
    translate([ax[0], ax[1], -eps]) cylinder(d = cable_d, h = pocket_z0 + 0.6 + eps, $fn = fn_sml);
    chest_cuts();
    // LED wire channel: 5 mm, vertical, from the pocket up through the neck peg
    translate([ax[0], ax[1], pocket_z1 - 1])
      cylinder(d = led_d, h = neck_z1 + peg_exposed + 0.6 - pocket_z1 + 1, $fn = fn_sml);
    // recess for the belly inlay
    difference() { belly_prism(belly_clear); egg(belly_depth); }
    toe_grooves();
  }
}

// ================================================================ comet_back_cover

// A 20 x 20 plug of the body's own egg: its outer face is the back of the body.
module comet_back_cover() {
  intersection() {
    egg(0);
    translate([0, 0, chest_z]) yprism(pocket_y1, body_y1 + 5) square(hatch_w, center = true);
  }
}

// ================================================================ comet_belly

// The light inlay: a 1.6 mm skin of the egg inside the ellipse, 0.4 proud, with a hole
// where the bezel plate sits.
module comet_belly() {
  difference() {
    intersection() {
      belly_prism(0);
      difference() { egg(-belly_proud); egg(belly_depth); }
    }
    translate([0, 0, chest_z]) yprism(body_y0 - 3, seat_floor_y) offset(delta = seat_clear + 0.3) plate2d();
  }
}

// ================================================================ comet_head

// Ellipsoid of the head, offset inward by k (k < 0 grows it).
module head_ell(k = 0) {
  translate(head_c) scale([head_a[0] - k, head_a[1] - k, head_a[2] - k]) sphere(r = 1, $fn = fn_big);
}

// Ears: a flattened cone from a disc sunk into the head to a small tip sphere.
ear_base = [10.8, -8, 77];  ear_r = 7.0;  ear_t = 4.6;
ear_tip  = [14.4, -6.6, 94.8];
ear_inner = [[7.4, 80.5], [15.8, 80.5], [14.2, 90.8]];   // pink inner face (x, z), per side
ear_recess = 0.7;

module ear_solid(s) {
  hull() {
    translate([s * ear_base[0], ear_base[1], ear_base[2]]) rotate([90, 0, 0])
      cylinder(r = ear_r, h = ear_t, center = true, $fn = fn_sml);
    translate([s * ear_tip[0], ear_tip[1], ear_tip[2]]) sphere(r = 1.0, $fn = fn_sml);
  }
}

// The pink face of an ear as a 2D shape (x, z), mirrored for the left ear.
module ear_inner2d(s) { polygon([for (p = ear_inner) [s * p[0], p[1]]]); }

// The shallow recess in the front of an ear (for painting it pink).
module ear_recess_vol(s) {
  intersection() {
    yprism(-40, 0) ear_inner2d(s);
    difference() { ear_solid(s); translate([0, ear_recess, 0]) ear_solid(s); }
  }
}

module ear_final(s) { difference() { ear_solid(s); ear_recess_vol(s); } }

// Face details are cut as a skin layer: a flat shape (x, z) pushed along y through the
// front of the head, keeping only what lies between the surface and depth below it.
// The picture's paint fills use shrink (a hair narrower than their recess) and extra (a hair
// deeper): no face of a fill may coincide with a face of the head, or the preview speckles.
module skin_cut(depth, shrink = 0, extra = 0) {
  difference() {
    yprism(head_c[1] - 40, head_c[1] - 2) offset(delta = -shrink) children();
    head_ell(depth + extra);
  }
}

module stroke2d(pts, w) {
  for (i = [0 : len(pts) - 2]) hull() {
    translate(pts[i]) circle(d = w, $fn = fn_sml);
    translate(pts[i + 1]) circle(d = w, $fn = fn_sml);
  }
}

hz = head_c[2];
eye_dx = 9.2;  eye_dz = 1.0;  eye_w = 9.0;  eye_h = 10.4;  eye_depth = 1.4;
nose_pts = [[-3.5, hz - 3.4], [3.5, hz - 3.4], [0, hz - 7.0]];   // pink nose: a rounded triangle
nose_proud = 1.0;
groove_w = 0.8;  groove_depth = 0.7;
paint_t = 0.3;  paint_lift = 0.05;    // view-only paint layers: skin thickness, and how far it stands proud of what it covers
stripe_c = [[0, hz + 11.5], [0, hz + 17.5]];
stripe_l = [[-4.6, hz + 10.5], [-6.6, hz + 15.8]];
stripe_r = [[ 4.6, hz + 10.5], [ 6.6, hz + 15.8]];
whisk_r = [[[12.8, hz - 3.4], [20.2, hz - 1.8]], [[12.8, hz - 6.4], [20.2, hz - 8.4]]];
mouth_r = [[0, hz - 7.2], [0.5, hz - 8.9], [1.7, hz - 9.9], [3.1, hz - 9.9], [3.9, hz - 8.9]];

module eyes2d() { for (s = [-1, 1]) translate([s * eye_dx, hz + eye_dz]) scale([eye_w / 2, eye_h / 2]) circle(r = 1, $fn = fn_sml); }
module eye_cut(sh = 0, ex = 0)    { skin_cut(eye_depth, sh, ex) eyes2d(); }
module stripe_cut(sh = 0, ex = 0) { skin_cut(groove_depth, sh, ex) { stroke2d(stripe_c, groove_w); stroke2d(stripe_l, groove_w); stroke2d(stripe_r, groove_w); } }
module whisker_cut(sh = 0, ex = 0) {
  skin_cut(groove_depth, sh, ex) for (s = [-1, 1], w = whisk_r) stroke2d([for (p = w) [s * p[0], p[1]]], groove_w);
}
module mouth_cut(sh = 0, ex = 0) {
  skin_cut(groove_depth, sh, ex) for (s = [-1, 1]) stroke2d([for (p = mouth_r) [s * p[0], p[1]]], groove_w);
}

module nose2d() { offset(r = 0.8, $fn = fn_sml) offset(delta = -0.8) polygon(nose_pts); }

// The nose stands nose_proud above the skin: the same shape cut from a skin layer.
module nose_vol(grow = 0) {   // grow: the picture's pink nose stands a hair proud of the fur one
  intersection() {
    yprism(head_c[1] - 40, head_c[1] - 6) nose2d();
    difference() { head_ell(-nose_proud - grow); head_ell(0.6); }
  }
}

// LED 1 channel: straight, 45 degrees up and back from the socket ceiling to a seat
// on the back of the head, so the board faces up and back and the dome glows.
function vdiv(v, w) = [v[0] / w[0], v[1] / w[1], v[2] / w[2]];
led_u  = [0, 1, 1] / sqrt(2);
led_p0 = [ax[0], ax[1], neck_z1 + socket_depth - 0.3];     // starts inside the socket's cavity
led_d0 = vdiv(led_p0 - head_c, head_a);
led_u0 = vdiv(led_u, head_a);
led_qa = led_u0 * led_u0;  led_qb = led_d0 * led_u0;  led_qc = led_d0 * led_d0 - 1;
led_t  = (-led_qb + sqrt(led_qb * led_qb - led_qa * led_qc)) / led_qa;   // distance along the channel to the back of the head
led_exit = led_p0 + led_u * led_t;
module led_frame() { translate(led_exit) rotate([-45, 0, 0]) children(); }   // +Z along the channel

module head_solid() {
  intersection() {
    union() {
      head_ell(0);
      for (s = [-1, 1]) ear_final(s);
      nose_vol();
    }
    translate([-60, -60, neck_z1]) cube([120, 120, 80]);   // flat chin on the neck
  }
}

module comet_head(eyes = true) {   // eyes = false only for the picture (see assembly)
  difference() {
    head_solid();
    // neck socket 10.4 x 6.5 on the shared axis
    translate([ax[0], ax[1], neck_z1 - eps]) cylinder(d = socket_d, h = socket_depth + eps, $fn = fn_sml);
    // straight 5 mm LED channel from the socket ceiling to the seat on the back
    led_frame() translate([0, 0, -led_t - 0.6]) cylinder(d = led_d, h = led_t + 0.6 + 1, $fn = fn_sml);
    led_frame() translate([0, 0, -led_seat_depth]) cylinder(d = led_seat_d, h = led_seat_depth + 4, $fn = fn_sml);
    if (eyes) eye_cut();
    stripe_cut();  whisker_cut();  mouth_cut();
  }
}

// ================================================================ comet_paint_pink, comet_paint_nose, comet_paint_dark (view only)

// Paint layers for the 3D viewer, never printed. Each is a paint_t skin standing paint_lift
// proud of the surface it covers, so the viewer can colour the paint on its own and never
// z-fights with the head. (The stripes, whiskers and mouth stay grooves in the viewer.)

// A plate over a recess in the front of the head (the eyes): the outline grown by paint_lift,
// flush with the skin and paint_lift above it.
module recess_paint() {
  difference() {
    intersection() {
      yprism(head_c[1] - 40, head_c[1] - 2) offset(delta = paint_lift) children();
      head_ell(-paint_lift);
    }
    head_ell(paint_t - paint_lift);
  }
}

// The inner faces of the ears: a plate over each ear's recess. The ear solid shifted forward
// by paint_lift, minus the ear solid shifted back by the rest of the wall, inside the pink
// outline grown by paint_lift.
module ear_paint(s) {
  intersection() {
    yprism(-40, 0) offset(delta = paint_lift) ear_inner2d(s);
    difference() {
      translate([0, -paint_lift, 0]) ear_solid(s);
      translate([0, paint_t - paint_lift, 0]) ear_solid(s);
    }
  }
}

// The nose stands nose_proud above the skin, so its paint is a cup over the top and the sides:
// the nose outline grown by paint_lift (its foot 0.2 mm inside the head) minus the outline
// shrunk by the rest of the wall.
module nose_paint() {
  difference() {
    intersection() {
      yprism(head_c[1] - 40, head_c[1] - 6) offset(delta = paint_lift) nose2d();
      difference() { head_ell(-nose_proud - paint_lift); head_ell(0.2); }
    }
    intersection() {
      yprism(head_c[1] - 40, head_c[1] - 6) offset(delta = paint_lift - paint_t) nose2d();
      head_ell(paint_t - nose_proud - paint_lift);
    }
  }
}

module comet_paint_pink() { for (s = [-1, 1]) ear_paint(s); }
module comet_paint_nose() { nose_paint(); }
module comet_paint_dark() { recess_paint() eyes2d(); }

// ================================================================ comet_collar

module collar_ring() {
  intersection() {
    translate([ax[0], ax[1], col_cz]) rotate_extrude($fn = fn_mid, convexity = 4)
      translate([col_R, 0]) circle(r = col_r, $fn = fn_sml);
    translate([-50, -50, body_z1]) cube([100, 100, tongue_z1 - body_z1]);   // flat bottom on the shoulders, flat top
  }
}

// The tongue runs from the ring's front over the shoulder's edge to the plate (and out
// through the notch in the dome).
module collar_tongue() {
  translate([-tongue_w / 2, plate_front_y, body_z1])
    cube([tongue_w, ax[1] - col_R + 1 - plate_front_y, tongue_z1 - body_z1]);
}

module bezel_plate() {
  difference() {
    translate([0, 0, chest_z]) yprism(plate_front_y, seat_floor_y) plate2d();
    // window for the cap, 0.3 mm clear all round
    translate([0, 0, chest_z]) yprism(plate_front_y - 1, seat_floor_y + 1)
      diamond2d(tag_side + 2 * cap_clear, tag_r + cap_clear);
    // counterbore behind the lip for the cap's flange
    translate([0, 0, chest_z]) yprism(plate_front_y + lip_t, seat_floor_y + 1)
      diamond2d(flange_side + 2 * cap_clear, tag_r + cap_clear);
  }
}

module comet_collar() { union() { collar_ring(); collar_tongue(); bezel_plate(); } }

// ================================================================ comet_tag_cap

// The stem stops stem_gap short of the switch: the board's back face rests on the
// cover (the pocket's back wall), the board is board_t thick and the switch switch_h tall.
cap_front_y = plate_front_y - cap_proud;
stem_tip_y  = pocket_y1 - board_t - switch_h - stem_gap;
stem_len    = stem_tip_y - cap_front_y - (cap_proud + lip_t + flange_t);

// Local frame: front face at z = 0, +Z toward the back of the figure.
module cap_local() {
  body_len = cap_proud + lip_t;
  union() {
    // button face: 0.5 mm chamfer on the front edge
    hull() {
      linear_extrude(height = eps) diamond2d(tag_side - 1, tag_r);
      translate([0, 0, 0.5]) linear_extrude(height = eps) diamond2d(tag_side, tag_r);
    }
    translate([0, 0, 0.5 - eps]) linear_extrude(height = body_len - 0.5 + 2 * eps) diamond2d(tag_side, tag_r);
    // flange behind the bezel's lip, so the cap cannot fall out of the front
    translate([0, 0, body_len]) linear_extrude(height = flange_t) diamond2d(flange_side, tag_r);
    // stem toward the switch
    translate([0, 0, body_len + flange_t - eps]) cylinder(d = stem_d, h = stem_len + eps, $fn = fn_sml);
  }
}

module comet_tag_cap() {
  translate([0, cap_front_y, chest_z]) rotate([-90, 0, 0]) cap_local();
}

// ================================================================ the glass helmet

// A sphere shell of outer radius R and wall dome_wall about the axis, from polar
// angle a0 to a1 (0 = top pole, 90 = equator, 180 = bottom pole) on the outer
// surface; the inner surface is cut at the same heights so the end faces are flat.
function arc(R, a0, a1, n = 40) = [for (i = [0 : n]) let (a = a0 + (a1 - a0) * i / n) [R * sin(a), dome_cz + R * cos(a)]];

module dome_shell(za, zb) {   // zone between heights za (low) and zb (high), flat ends
  R = dome_d / 2;  r = R - dome_wall;
  ao_hi = acos(max(min((zb - dome_cz) / R, 1), -1));   // polar angles of the outer surface at zb and za
  ao_lo = acos(max(min((za - dome_cz) / R, 1), -1));
  ai_hi = acos(max(min((zb - dome_cz) / r, 1), -1));
  ai_lo = acos(max(min((za - dome_cz) / r, 1), -1));
  translate([ax[0], ax[1], 0]) rotate_extrude($fn = fn_big, convexity = 6)
    polygon(concat(arc(R, ao_hi, ao_lo), arc(r, ai_lo, ai_hi)));
}

module comet_dome_top() { dome_shell(dome_cz, dome_cz + dome_d / 2); }

module comet_dome_bottom() {
  difference() {
    dome_shell(dome_cut_z, dome_cz);
    // notch for the bezel's tongue, at the front
    translate([ax[0] - notch_w / 2, -100, dome_cut_z - 1])
      cube([notch_w, 100 + ax[1] - 12, tongue_z1 + 0.3 - dome_cut_z + 1]);
  }
}

// ================================================================ dispatcher (filled in as the parts are added)

module view_part(p) {
  if      (p == "comet_body")        comet_body();
  else if (p == "comet_back_cover")  comet_back_cover();
  else if (p == "comet_belly")       comet_belly();
  else if (p == "comet_head")        comet_head();
  else if (p == "comet_collar")      comet_collar();
  else if (p == "comet_tag_cap")     comet_tag_cap();
  else if (p == "comet_dome_top")    comet_dome_top();
  else if (p == "comet_dome_bottom") comet_dome_bottom();
  else if (p == "comet_paint_pink")  comet_paint_pink();    // view only
  else if (p == "comet_paint_nose")  comet_paint_nose();    // view only
  else if (p == "comet_paint_dark")  comet_paint_dark();    // view only
  else assert(false, str("unknown part: ", p));
}

module print_part(p) {
  if      (p == "comet_body")        comet_body();                                    // upright on its paws, the tail flat on z = 0
  else if (p == "comet_back_cover")  // inner face down, outer face up
    translate([0, chest_z, -pocket_y1]) rotate([90, 0, 0]) comet_back_cover();
  else if (p == "comet_belly")       // outer face down on the bed (flat over the chest, arching up at the bottom)
    translate([0, belly_c[1], -(body_y0 - belly_proud)]) rotate([90, 0, 0]) comet_belly();
  else if (p == "comet_head")        translate([0, -ax[1], -neck_z1]) comet_head();    // chin on the bed, ears up
  else if (p == "comet_collar")      // upside down: the flat top of the ring and the tongue on the bed
    translate([0, 0, tongue_z1]) rotate([180, 0, 0]) translate([-ax[0], -ax[1], 0]) comet_collar();
  else if (p == "comet_tag_cap")     cap_local();                                       // front face down, stem up
  else if (p == "comet_dome_top")    // equator face on the bed, dome up
    translate([-ax[0], -ax[1], -dome_cz]) comet_dome_top();
  else if (p == "comet_dome_bottom") // upside down: equator face on the bed, the open bottom up
    rotate([180, 0, 0]) translate([-ax[0], -ax[1], -dome_cz]) comet_dome_bottom();
  else if (p == "comet_paint_pink" || p == "comet_paint_nose" || p == "comet_paint_dark")
    assert(false, str(p, " is view only: it has no print layout"));
  else assert(false, str("unknown part: ", p));
}

module pad_standin() {
  color(c_pad) linear_extrude(height = pad_h)
    intersection() {
      circle(r = pad_r, $fn = 120);
      translate([-pad_r, -pad_r]) square([2 * pad_r, pad_r + pad_flat_y]);
    }
  // lime ring inlay, as on the real pad (D outline inset 6 mm, 2.7 mm wide, 0.4 proud)
  color(c_lime) translate([0, 0, pad_h]) linear_extrude(height = 0.4)
    difference() {
      offset(delta = -6) intersection() {
        circle(r = pad_r, $fn = 120);
        translate([-pad_r, -pad_r]) square([2 * pad_r, pad_r + pad_flat_y]);
      }
      offset(delta = -8.7) intersection() {
        circle(r = pad_r, $fn = 120);
        translate([-pad_r, -pad_r]) square([2 * pad_r, pad_r + pad_flat_y]);
      }
    }
}

// OpenSCAD's preview paints identical geometry used under two different
// colours with the last colour. A few microns of offset keep the copies apart.
module uniq(i) { translate([0.0017 * i, 0.0013 * i, 0.0011 * i]) children(); }

// The paws: everything below the pause height, in the light colour.
module paws_slab() { translate([-21, -14, -1]) cube([42, 24, paw_h + 1]); }

// The recesses of the face, filled with their paint colour (picture only). Every fill needs its own
// uniq() index: two fills sharing the same ellipsoid would both take the last colour.
module face_fill(c, k) { color(c) uniq(k) intersection() { head_ell(0.3); children(); } }   // 0.3 mm under the skin: the preview's depth buffer cannot tell less apart

// The eyes in the picture: a dark skin standing 0.25 mm proud of an uncut head. (A cut head with
// a fill under the skin speckles in the preview's depth buffer; the real part has the recesses.)
module eye_decal() {
  color(c_eye) uniq(2) intersection() {
    yprism(head_c[1] - 40, head_c[1] - 2) eyes2d();
    difference() { head_ell(-0.25); head_ell(0.3); }
  }
}

module assembly() {
  pad_standin();
  // 0.06 mm above the pad in the picture only: the paws and the tail's flat underside are
  // coplanar with the pad top and the preview z-fights (the STLs sit exactly at z = 36)
  translate(fig + [0, 0, 0.06]) {
    color(c_light) uniq(0) intersection() { comet_body(); paws_slab(); }
    color(c_fur)   uniq(1) difference()   { comet_body(); paws_slab(); }
    color(c_light) comet_belly();
    color(c_fur)   comet_back_cover();
    color(c_collar) comet_collar();
    color(c_lime, lime_alpha) comet_tag_cap();
    color(c_fur) comet_head(eyes = false);
    color(c_ear) uniq(1) for (s = [-1, 1]) ear_recess_vol(s);
    color(c_nose) uniq(1) nose_vol(0.25);
    eye_decal();
    face_fill(c_stripe, 3) union() { stripe_cut(0.1, 0.1); whisker_cut(0.1, 0.1); mouth_cut(0.1, 0.1); }
    // the glass last, so everything inside shows through it
    // (the top half 0.2 mm up in the picture only: the two equator faces are coplanar and would z-fight)
    color(c_glass) { translate([0, 0, 0.2]) comet_dome_top(); comet_dome_bottom(); }
  }
}

module cutaway() {
  if (cut == "") children();
  else difference() {
    children();
    if (cut == "x") translate([cut_at, -500, -500]) cube(1000);
    if (cut == "y") translate([-500, cut_at, -500]) cube(1000);
    if (cut == "z") translate([-500, -500, cut_at]) cube(1000);
  }
}

module main() {
  if (part == "assembly") assembly();
  else if (layout == "print") print_part(part);
  else translate(fig) view_part(part);
}

cutaway() main();
