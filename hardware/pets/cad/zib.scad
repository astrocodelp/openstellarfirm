// OpenStellarFirm desk pet: Zib, the lime-green alien.
//
// OpenSCAD 2021.01, millimetres. Self-contained: no include or use.
// Coordinates (the same for every desk pet figure):
//   * Z is up and the FRONT of the figure faces -Y. Viewer's left is -X, so the
//     "left" antenna, arm and eye are at -X.
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
// Parts (qty 1 each unless noted):
//   zib_body           purple jumpsuit torso with the legs and boots. One piece.
//                      Pause the print at z = 7 (boots, dark purple), again at
//                      z = 14 (legs, green) and let the torso finish in purple,
//                      or paint. Holds the insert holes, the cable channel, the
//                      chest pocket with its back hatch, the two LED channels,
//                      the belt seat, the arm dowel holes and the neck peg.
//   zib_head           lime-green ellipsoid with a flat seat, the neck socket,
//                      two LED channels to the antenna sockets, two eye sockets
//                      (2.5 mm deep at the shallowest edge), the smile groove
//                      and two shallow cheek recesses for pink paint.
//   zib_eye_left       black eye insert (0.2 mm smaller than its socket) with
//   zib_eye_right      two raised highlight dots for white paint.
//   zib_arm_left       green capsule arm with a round hand and a flat glue face
//   zib_arm_right      with a blind dowel hole that matches one in the torso's side.
//   zib_belt           dark bezel: a band around the front and sides of the
//                      torso with a buckle frame and the window for the cap.
//   zib_buckle_cap     translucent lime rounded-square button cap (12 x 10):
//                      flange behind the belt's lip and a 4 mm stem that stops
//                      0.3 mm short of the 6 x 6 x 9.5 mm switch (the button).
//   zib_back_cover     purple plug (press fit, 0.15 mm clearance a side plus a
//                      drop of glue) that closes the 20 x 20 hatch in the torso's
//                      back and backs the chest board.
//   zib_antenna_stalk  qty 2. Green stalk with a wire bore, a plug for the head
//                      and a plug for the ball. The same part on both sides.
//   zib_antenna_ball   qty 2. Translucent lime hollow ball (inner 11 mm) for a
//                      10 mm LED board (LED 1 left, LED 2 right).
//   View only (the same print file as the two above, for the 3D viewer):
//   zib_antenna_stalk_right, zib_antenna_ball_right  the right-hand copies. The
//                      ids without "_right" are the left antenna (at -X).
//   View only (for the 3D viewer, never printed: layout "print" refuses them).
//   Each is a 0.3 mm paint skin standing 0.05 mm proud of the surface it covers:
//   zib_paint_white    the two raised highlight dots on each eye, white.
//   zib_paint_pink     the two cheeks, pink.
//   zib_paint_dark     the smile, dark.
//
// Assembly order:
//   1. Press two M3 heat-set inserts into the boots.
//   2. Press the buckle cap into the belt from behind, then glue the belt into its
//      seat around the front and sides of the torso. The flange keeps the cap from
//      falling out in front; behind, its stem rests against the switch.
//   3. Solder the chest module (switch, LED 0, skin ID resistor) on a board trimmed to
//      19.6 x 19.6 mm or less. Run the LED wires up the two 5 mm channels and the
//      cable harness down the 7 mm channel, slide the board into the pocket from the
//      BACK with the switch facing forward, then press the back cover into the hatch
//      with a drop of glue: its inner face backs the board.
//   4. Put LED 1 and LED 2 on the stalks' plug ends, thread their wires through the
//      stalks and the head's channels, glue the stalks into the head and the balls
//      over the LEDs.
//   5. Glue the head onto the torso (neck peg), the eyes into their sockets and the
//      arms to the torso's sides (a 3 mm dowel, 9 mm long, in each pair of holes).
//      Paint the eye highlights white and the cheeks pink (#ff80b6).

part   = "assembly";
layout = "view";
cut    = "";   // "", "x", "y" or "z"
cut_at = 0;    // world coordinate of the cutting plane

// ---------------------------------------------------------------- resolution
fn_view  = 48;   // viewer exports
fn_print = 96;   // print exports (kept under 12 MB per STL)
pretty   = layout == "print" || part == "assembly";   // PNG previews look best smooth
fn_big   = pretty ? fn_print : fn_view;               // head, eyes
fn_mid   = pretty ? 48 : 32;                          // rounded corners 4 to 10 mm
fn_sml   = pretty ? 40 : 24;                          // pegs, holes, small details
$fn = fn_mid;
eps = 0.02;      // overlap so unions and cuts never leave coincident faces

// ---------------------------------------------------------------- placement
fig = [0, 8, 36];                    // figure origin in world (launch pad) coordinates

// ---------------------------------------------------------------- palette (the OpenStellarFirm pet colours)
c_skin  = "#b4ea4c";  c_shade = "#86c12f";  c_eye  = "#14121e";  c_suit = "#8a7cf4";
c_belt  = "#24203d";  c_boot  = "#4a3f8f";  c_cheek = "#ff80b6"; c_lime = "#d9ff3f";
c_white = "#ffffff";  c_pad   = "#1b1b22";
lime_alpha = 0.85;                   // translucent cap and balls in the picture

// ---------------------------------------------------------------- boots, legs and the web between them
boot_w = 16;  boot_d = 18;  boot_h = 7;  boot_r = 3;   // rounded box, flat sole
boot_x = 11;  boot_y = -3;            // boot centre at x = +-11, a little forward
leg_d  = 12;  leg_z0 = 6;  leg_z1 = 16;
web_x = 7;   web_y0 = -8.7; web_y1 = 1.5; web_z1 = 15; // block that joins the legs around the cable channel
insert_x = 12;                        // M3 heat-set inserts at (+-12, 0)
insert_d = 4.0;  insert_depth = 6.5;
cable_xy = [0, -4];                   // 7 mm cable channel axis
cable_d  = 7;

// ---------------------------------------------------------------- torso and arms
torso_w = 40;  torso_d = 34;  torso_z0 = 14;  torso_z1 = 45.5;
torso_rb = 8;  torso_rt = 6;          // bottom and top corner radii; the sides and the front stay flat
front_y = -torso_d / 2;               // front surface of the torso (-17)
back_y  =  torso_d / 2;               // back surface (+17)
arm_r = 4.5;  hand_r = 5.5;
arm_sh = [23.8, 0, 38.5];             // shoulder sphere centre, per side (x mirrored)
arm_ha = [24.8, 0, 21];               // hand sphere centre
arm_flat_x = 20.2;                    // flat glue face, 0.2 mm off the torso's flat side (x = 20)
dowel_z = 33;  dowel_hole_d = 3.4;  dowel_hole_depth = 5;   // a 3 mm dowel (or filament) joins each arm to the torso

// ---------------------------------------------------------------- chest pocket, belt, buckle cap, back hatch
chest_z  = 28;                        // centre height of the belt, the buckle and the pocket
belt_t   = 3;                         // belt thickness (radial)
pocket_w = 22;  pocket_h = 22;  pocket_r = 2;
pocket_y0 = front_y + belt_t;         // the belt's rear face closes the pocket in front (-14)
cover_y   = 1.0;                      // inner face of the back cover = back wall of the pocket
pocket_z0 = chest_z - pocket_h / 2;   // 17
pocket_z1 = chest_z + pocket_h / 2;   // 39
hatch_w = 20;  hatch_h = 20;  hatch_r = 0.4;   // opening in the torso's back, from the pocket out
cover_clear = 0.15;                   // per side, cover in the hatch
belt_h = 5;  belt_y_end = 6;          // band z 25.5 to 30.5, ends on the flat side at y = +6
belt_z0 = chest_z - belt_h / 2;  belt_z1 = chest_z + belt_h / 2;
frame_w = 17.6;  frame_h = 15.6;  frame_r = 3.5;     // buckle plate in the belt's colour
seat_clear = 0.1;                     // glue gap around the belt in its seat
cap_w = 12;  cap_h = 10;  cap_r = 2.5;
cap_clear = 0.3;  cap_proud = 0.6;
flange_w = 14;  flange_h = 12;  flange_r = 3;  flange_t = 1.0;
lip_t = 1.6;                          // belt in front of the flange; keeps the cap in
stem_d = 5;
switch_h = 9.5;  board_t = 1.6;  stem_gap = 0.3;     // 6 x 6 x 9.5 switch on a 1.6 mm board against the cover
cap_front_y = front_y - cap_proud;
stem_len = (cover_y - board_t - switch_h - stem_gap) - cap_front_y - (cap_proud + lip_t + flange_t);   // 4.0
win_w = cap_w + 2 * cap_clear;  win_h = cap_h + 2 * cap_clear;          // window in the belt
cb_w  = flange_w + 2 * cap_clear;  cb_h = flange_h + 2 * cap_clear;     // counterbore behind the lip

// ---------------------------------------------------------------- neck and head
neck_y     = cable_xy[1];             // peg, socket and the LED channels share this axis (y = -4)
peg_d = 10;  peg_exposed = 6;         // peg 10 x 6 on the body
socket_d = 10.4;  socket_depth = 6.5; // socket in the head (0.2 clearance a side)
seat_z     = torso_z1;                // the head's flat seat sits on the torso top
peg_top_z  = seat_z + peg_exposed;
led_d = 5;                            // LED wire channels
head_a = 35;  head_b = 25;  head_c = 26;             // ellipsoid 70 wide x 50 deep x 52 tall
head_c0 = [0, neck_y, 70.5];          // its centre: over the neck axis

// ---------------------------------------------------------------- antennas (LED 1 left, LED 2 right) and their channels
ant_tilt   = 20;                      // degrees outward from vertical
ant_x      = 14;                      // antenna sockets at x = +-14 on top of the head
stalk_len  = 15;  stalk_d = 4.0;  stalk_bore = 2.4;
ant_plug_d = 5.4;  ant_plug_len = 4;  ant_stub = 1;   // plug in the head
ant_sock_d = 5.8;                     // head's antenna socket
ball_d = 13;  ball_inner_d = 11;  ball_cut = 2;       // ball centre is 2 above its flat rim (rim 0.9 mm wide)
holder_depth = 4.4;                   // green holder under the ball continues its outline down to the stalk
ball_mouth_d = 10.6;                  // opening for the 10 mm LED board
ball_plug_d  = 10.2;  ball_plug_len = ball_cut;       // stalk end that closes the mouth
led_xq = 1.0;                         // the two vertical channels sit 1 mm either side of the neck axis: a 7 x 5 mm slot, 1.5 mm of peg wall left

// Top surface of the head ellipsoid and the antenna and channel axes (s = -1 left, +1 right).
function head_z(x, y) = head_c0[2] + head_c * sqrt(max(0, 1 - pow((x - head_c0[0]) / head_a, 2) - pow((y - head_c0[1]) / head_b, 2)));
function ant_dir(s)  = [s * sin(ant_tilt), 0, cos(ant_tilt)];
function ant_base(s) = [s * ant_x, neck_y, head_z(s * ant_x, neck_y)];   // where the stalk leaves the head
function ant_bot(s)  = ant_base(s) - ant_plug_len * ant_dir(s);          // inner end of the antenna socket
function led_p0(s)   = [s * led_xq, neck_y, seat_z + socket_depth - 1];  // head channel starts in the socket void, over the body's vertical channel

// ---------------------------------------------------------------- pad stand-in (assembly picture only)
pad_r = 60;  pad_flat_y = 40;  pad_h = 36;

// ================================================================ helpers

// OpenSCAD's sphere has no vertex on its poles, so a faceted sphere stops about
// half a percent short of its radius. This one reaches r on all three axes, so
// flat faces built from it (soles, the torso's back) land exactly where the
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

// Straight cylinder of diameter d between two points.
module cyl_ab(a, b, d) {
  v = b - a;
  L = norm(v);
  translate(a) rotate([0, acos(v[2] / L), atan2(v[1], v[0])]) cylinder(d = d, h = L, $fn = fn_sml);
}

// A stroked polyline as a 2D shape (round ends).
module stroke2d(pts, w) {
  for (i = [0 : len(pts) - 2]) hull() {
    translate(pts[i]) circle(d = w, $fn = fn_sml);
    translate(pts[i + 1]) circle(d = w, $fn = fn_sml);
  }
}

// The head's ellipsoid grown by g (g < 0 shrinks it): the surface that eyes, smile and cheeks follow.
module head_ellipsoid(g = 0) {
  translate(head_c0) scale([head_a + g, head_b + g, head_c + g]) rsphere(1, fn_big);
}

// ================================================================ zib_body

// Torso: hull of eight spheres with flat front, back and sides. `inset` shrinks
// every sphere, which is an exact inward offset of the hull.
module torso_solid(inset = 0) {
  cxb = torso_w / 2 - torso_rb;  cyb = torso_d / 2 - torso_rb;  czb = torso_z0 + torso_rb;
  cxt = torso_w / 2 - torso_rt;  cyt = torso_d / 2 - torso_rt;  czt = torso_z1 - torso_rt;
  rb = torso_rb - inset;  rt = torso_rt - inset;
  hull() {
    translate([-cxb, -cyb, czb]) rsphere(rb);
    translate([ cxb, -cyb, czb]) rsphere(rb);
    translate([-cxb,  cyb, czb]) rsphere(rb);
    translate([ cxb,  cyb, czb]) rsphere(rb);
    translate([-cxt, -cyt, czt]) rsphere(rt);
    translate([ cxt, -cyt, czt]) rsphere(rt);
    translate([-cxt,  cyt, czt]) rsphere(rt);
    translate([ cxt,  cyt, czt]) rsphere(rt);
  }
}

// Corner radius of the torso's plan at height z (the hull's corners are cones between the two sphere rows).
function slice_r(z) = torso_rb + (torso_rt - torso_rb) * (z - (torso_z0 + torso_rb)) / ((torso_z1 - torso_rt) - (torso_z0 + torso_rb));

// Plan of the belt band: the torso's front and sides out to y = belt_y_end, 3 mm thick.
// grow > 0 makes the seat in the torso: a little wider, deeper and longer.
module belt_zone2d(grow = 0) {
  difference() {
    translate([-50, -50]) square([100, 50 + belt_y_end + grow]);
    rrect2d(torso_w - 2 * (belt_t + grow), torso_d - 2 * (belt_t + grow), slice_r(chest_z) - belt_t - grow);
  }
}

module belt_seat() {
  // band
  translate([0, 0, belt_z0 - seat_clear]) linear_extrude(height = belt_h + 2 * seat_clear, convexity = 6) belt_zone2d(seat_clear);
  // buckle plate: through the torso's front wall into the pocket
  translate([0, 0, chest_z]) yprism(front_y - 1, pocket_y0 + eps)
    rrect2d(frame_w + 2 * seat_clear, frame_h + 2 * seat_clear, frame_r + seat_clear);
}

module boot_leg(s) {
  // boot: rounded box, flat sole at z = 0
  rbox_ab([s * boot_x - boot_w / 2, boot_y - boot_d / 2, 0],
          [s * boot_x + boot_w / 2, boot_y + boot_d / 2, boot_h], boot_r);
  translate([s * boot_x, boot_y, leg_z0]) cylinder(d = leg_d, h = leg_z1 - leg_z0, $fn = fn_mid);
}

module legs_solid() {
  for (s = [-1, 1]) boot_leg(s);
  // web: joins the legs and wraps the cable channel; set back behind the leg fronts
  rbox_ab([-web_x, web_y0, 0], [web_x, web_y1, web_z1], 1.5);
}

module neck_peg() {
  translate([0, neck_y, torso_z1 - 2]) cylinder(d = peg_d, h = peg_exposed + 2, $fn = fn_sml);
}

module zib_body() {
  difference() {
    union() {
      torso_solid();
      legs_solid();
      neck_peg();
    }
    // two M3 heat-set insert holes, 4.0 x 6.5 from the sole, in the boots
    for (s = [-1, 1])
      translate([s * insert_x, 0, -eps]) cylinder(d = insert_d, h = insert_depth + eps, $fn = fn_sml);
    // cable channel: 7 mm, vertical, from the sole up into the chest pocket
    translate([cable_xy[0], cable_xy[1], -eps]) cylinder(d = cable_d, h = pocket_z0 + 1 + eps, $fn = fn_sml);
    // chest pocket 22 x 22, from the belt's rear face to the cover's inner face (15 deep)
    translate([0, 0, chest_z]) yprism(pocket_y0, cover_y) rrect2d(pocket_w, pocket_h, pocket_r);
    // hatch 20 x 20 in the torso's back, from the pocket out
    translate([0, 0, chest_z]) yprism(cover_y - eps, back_y + 5) rrect2d(hatch_w, hatch_h, hatch_r);
    // seat for the belt band and the buckle plate
    belt_seat();
    // two straight vertical 5 mm LED channels, 2 mm apart (they overlap into one 7 x 5 mm slot):
    // from the pocket's roof up through the peg. The head's channels split from here.
    for (s = [-1, 1])
      translate([s * led_xq, neck_y, pocket_z1 - 1]) cylinder(d = led_d, h = peg_top_z + 2 - (pocket_z1 - 1), $fn = fn_sml);
    // dowel holes for the arms in the torso's flat sides
    for (s = [-1, 1])
      translate([s * (torso_w / 2 - dowel_hole_depth), 0, dowel_z]) rotate([0, s * 90, 0])
        cylinder(d = dowel_hole_d, h = dowel_hole_depth + 1, $fn = fn_sml);
  }
}

// ================================================================ zib_head

// Eyes: ovals 18 x 22, tops leaning outward. Each socket has a flat floor; the
// floor is placed so the socket is 2.5 mm deep at the shallowest point of its
// rim (the centre is deeper, about 6 mm, because the head curves away).
eye_dx = 13;  eye_dz = 0.5;           // eye centre x = +-13, z = head centre + 0.5
eye_a = 9;  eye_b = 11;  eye_tilt = 10;
eye_depth = 2.5;  eye_clear = 0.2;    // insert outline is 0.2 mm smaller a side than the socket
eye_proud = 0.4;                      // the insert's domed face stands 0.4 mm proud of the skin
dot_h = 0.4;                          // raised highlight dots (paint them white)
smile_low = -16;  smile_chord = 11;  smile_sag = 2.4;  smile_w = 1.8;
cheek_x = 23;  cheek_dz = -10.5;  cheek_a = 5;  cheek_b = 3;
recess_depth = 0.6;                   // the smile and the cheeks are recesses this deep, for paint
paint_t = 0.3;  paint_lift = 0.05;    // view-only paint layers: skin thickness, and how far it stands proud of what it covers

function surf_y(x, z) = head_c0[1] - head_b * sqrt(max(0, 1 - pow((x - head_c0[0]) / head_a, 2) - pow((z - head_c0[2]) / head_c, 2)));
function eye_pt(t) = [eye_dx + eye_a * cos(t) * cos(eye_tilt) + eye_b * sin(t) * sin(eye_tilt),
                      head_c0[2] + eye_dz - eye_a * cos(t) * sin(eye_tilt) + eye_b * sin(t) * cos(eye_tilt)];
eye_floor_y = max([for (t = [0 : 3 : 357]) surf_y(eye_pt(t)[0], eye_pt(t)[1])]) + eye_depth;
eye_front_y = head_c0[1] - head_b - 5;   // anywhere in front of the head

// The eye oval in figure (x, z), s = -1 left, +1 right; grow < 0 shrinks it.
module eye2d(s, grow = 0) {
  offset(delta = grow) translate([s * eye_dx, head_c0[2] + eye_dz]) rotate(-s * eye_tilt) scale([eye_a, eye_b]) circle(r = 1, $fn = fn_big);
}

smile_r  = (pow(smile_chord / 2, 2) + pow(smile_sag, 2)) / (2 * smile_sag);
smile_a0 = asin(smile_chord / 2 / smile_r);
smile_pts = [for (i = [0 : 16])
  let (a = -90 - smile_a0 + 2 * smile_a0 * i / 16)
  [smile_r * cos(a), head_c0[2] + smile_low + smile_r + smile_r * sin(a)]];

// Local frame of an antenna: origin on the head surface, +Z along the stalk, leaning outward.
module ant_frame(s) {
  translate(ant_base(s)) rotate([0, s * ant_tilt, 0]) children();
}

// Shallow recesses in the skin that are painted: the smile and the pink cheeks.
// Each is a 2D shape pushed along Y with the head's own inner ellipsoid taken
// away, which leaves just a 0.6 mm skin (and the air in front of it). One cutter
// for all three keeps the preview's CSG tree small.
module smile2d() { stroke2d(smile_pts, smile_w); }
module cheek2d(s) { translate([s * cheek_x, head_c0[2] + cheek_dz]) scale([cheek_a, cheek_b]) circle(r = 1, $fn = fn_sml); }

module recess_cutter() {
  difference() {
    yprism(eye_front_y, head_c0[1]) { smile2d(); cheek2d(-1); cheek2d(1); }
    head_ellipsoid(-recess_depth);
  }
}

module zib_head() {
  difference() {
    intersection() {
      head_ellipsoid(0);
      translate([-60, -60, seat_z]) cube([120, 120, 100]);   // flat seat on the torso
    }
    // neck socket 10.4 x 6.5 on the shared neck axis
    translate([0, neck_y, seat_z - eps]) cylinder(d = socket_d, h = socket_depth + eps, $fn = fn_sml);
    for (s = [-1, 1]) {
      // straight LED channel from the socket ceiling to the antenna socket
      cyl_ab(led_p0(s), ant_bot(s), led_d);
      // antenna socket for the stalk's plug
      ant_frame(s) translate([0, 0, -ant_plug_len]) cylinder(d = ant_sock_d, h = ant_plug_len + 3, $fn = fn_sml);
      // eye socket
      yprism(eye_front_y, eye_floor_y) eye2d(s, 0);
    }
    // smile groove and the two pink cheeks, 0.6 mm deep
    recess_cutter();
  }
}

// ================================================================ zib_eye_left, zib_eye_right

// Local 2D frame of an eye (tilted with it); p is an offset in the eye's own frame.
module eye_dot2d(s, p, d) {
  translate([s * eye_dx, head_c0[2] + eye_dz]) rotate(-s * eye_tilt) translate(p) circle(d = d, $fn = fn_sml);
}

// Insert: flat back on the socket floor, domed face following the head, outline 0.2 mm smaller a side.
module eye_plug(s) {
  intersection() {
    yprism(eye_front_y, eye_floor_y) eye2d(s, -eye_clear);
    head_ellipsoid(eye_proud);
  }
}

// Two raised highlight dots, both up and to the right like the drawing (paint them white).
module eye_dots2d(s) { eye_dot2d(s, [2.8, 4.0], 6.0); eye_dot2d(s, [-3.0, -5.5], 2.8); }
module eye_dots(s) {
  intersection() {
    yprism(eye_front_y, eye_floor_y - 0.5) eye_dots2d(s);
    head_ellipsoid(eye_proud + dot_h);
  }
}

module zib_eye(s) { union() { eye_plug(s); eye_dots(s); } }

// ================================================================ zib_paint_white, zib_paint_pink, zib_paint_dark (view only)

// Paint layers for the 3D viewer, never printed. Each is a paint_t skin standing paint_lift
// proud of the surface it covers, so the viewer can colour the paint on its own and never
// z-fights with the head or the eyes.
//
// The raised highlight dots get a cup over their top and sides: the dots grown by paint_lift
// (their foot 0.1 mm inside the insert) minus the dots shrunk by the rest of the wall.
module eye_dots_paint(s) {
  difference() {
    intersection() {
      yprism(eye_front_y, eye_floor_y - 0.5) offset(delta = paint_lift) eye_dots2d(s);
      difference() { head_ellipsoid(eye_proud + dot_h + paint_lift); head_ellipsoid(eye_proud - 0.1); }
    }
    intersection() {
      yprism(eye_front_y, eye_floor_y - 0.5) offset(delta = paint_lift - paint_t) eye_dots2d(s);
      head_ellipsoid(eye_proud + dot_h + paint_lift - paint_t);
    }
  }
}

// Paint that fills a recess in the skin (the smile, the cheeks): a plate over the recess's
// opening, the same outline grown by paint_lift, flush with the skin and paint_lift above it.
module recess_paint() {
  difference() {
    intersection() {
      yprism(eye_front_y, head_c0[1]) offset(delta = paint_lift) children();
      head_ellipsoid(paint_lift);
    }
    head_ellipsoid(paint_lift - paint_t);
  }
}

module zib_paint_white() { for (s = [-1, 1]) eye_dots_paint(s); }
module zib_paint_pink()  { recess_paint() { cheek2d(-1); cheek2d(1); } }
module zib_paint_dark()  { recess_paint() smile2d(); }

// ================================================================ zib_arm_left, zib_arm_right

// A capsule down the torso's side ending in a round hand, cut flat 0.2 mm off the
// torso for gluing (and for lying flat on the print bed), with a blind dowel hole
// that matches the one in the torso.
module zib_arm(s) {
  difference() {
    intersection() {
      union() {
        hull() {
          translate([s * arm_sh[0], arm_sh[1], arm_sh[2]]) rsphere(arm_r);
          translate([s * arm_ha[0], arm_ha[1], arm_ha[2]]) rsphere(arm_r);
        }
        translate([s * arm_ha[0], arm_ha[1], arm_ha[2]]) rsphere(hand_r);
      }
      translate([s > 0 ? arm_flat_x : -60, -20, arm_ha[2] - hand_r - 2]) cube([60 - arm_flat_x, 40, 40]);   // flat face; kept clear of the pad plane
    }
    translate([s * (arm_flat_x - eps), 0, dowel_z]) rotate([0, s * 90, 0])
      cylinder(d = dowel_hole_d, h = dowel_hole_depth + eps, $fn = fn_sml);
  }
}

// ================================================================ zib_belt

// Band around the front and sides (z 25.5 to 30.5) and the buckle plate (17.6 x 15.6),
// both following the torso's surface. 3 mm thick; the plate's window holds the cap.
module belt_band() {
  intersection() {
    torso_solid();
    translate([0, 0, belt_z0]) linear_extrude(height = belt_h, convexity = 6) belt_zone2d(0);
  }
}
module belt_plate() {
  intersection() {
    torso_solid();
    translate([0, 0, chest_z]) yprism(front_y - 1, pocket_y0) rrect2d(frame_w, frame_h, frame_r);
  }
}

module zib_belt() {
  difference() {
    union() { belt_band(); belt_plate(); }
    // window for the cap, 0.3 mm clear all round
    translate([0, 0, chest_z]) yprism(front_y - 1, pocket_y0 + 1) rrect2d(win_w, win_h, cap_r + cap_clear);
    // counterbore behind the lip for the cap's flange
    translate([0, 0, chest_z]) yprism(front_y + lip_t, pocket_y0 + 1) rrect2d(cb_w, cb_h, flange_r + cap_clear);
  }
}

// ================================================================ zib_buckle_cap

// Local frame: front face at z = 0, +Z toward the back of the figure.
module cap_local() {
  body_len = cap_proud + lip_t;
  union() {
    // button face: 0.5 mm chamfer on the front edge
    hull() {
      linear_extrude(height = eps) rrect2d(cap_w - 1, cap_h - 1, cap_r - 0.5);
      translate([0, 0, 0.5]) linear_extrude(height = eps) rrect2d(cap_w, cap_h, cap_r);
    }
    translate([0, 0, 0.5 - eps]) linear_extrude(height = body_len - 0.5 + 2 * eps) rrect2d(cap_w, cap_h, cap_r);
    // flange behind the lip, so the cap cannot fall out of the front
    translate([0, 0, body_len]) linear_extrude(height = flange_t) rrect2d(flange_w, flange_h, flange_r);
    // stem toward the switch: its tip stops 0.3 mm short of a 6 x 6 x 9.5 mm switch on a 1.6 mm board resting on the back cover
    translate([0, 0, body_len + flange_t - eps]) cylinder(d = stem_d, h = stem_len + eps, $fn = fn_sml);
  }
}

module zib_buckle_cap() {
  translate([0, cap_front_y, chest_z]) rotate([-90, 0, 0]) cap_local();
}

// ================================================================ zib_back_cover

// Plug for the hatch: 0.15 mm smaller a side, its inner face at y = +1 (backs the
// board), its outer face the torso's own surface so it ends flush.
module zib_back_cover() {
  intersection() {
    torso_solid();
    translate([0, 0, chest_z]) yprism(cover_y, back_y + 5)
      rrect2d(hatch_w - 2 * cover_clear, hatch_h - 2 * cover_clear, hatch_r - cover_clear);
  }
}

// ================================================================ zib_antenna_stalk

stalk_end = stalk_len + ball_plug_len;   // far end of the stalk (ball side)

// The part of the ball's sphere below its flat rim, in green: the stalk ends in
// it, so the antenna reads as a full ball on a holder and the ball can have a
// mouth wide enough for the LED board.
module stalk_holder() {
  R = ball_d / 2;
  n = 16;
  rotate_extrude($fn = fn_mid, convexity = 4)
    polygon(concat(
      [[0, -holder_depth]],
      [for (i = [0 : n]) let (z = -holder_depth + holder_depth * i / n)
        [sqrt(R * R - pow(z - ball_cut, 2)), z]],
      [[0, 0]]));
}

module stalk_local() {
  difference() {
    union() {
      // plug that glues into the head's antenna socket, with a small stub above the surface
      translate([0, 0, -ant_plug_len]) cylinder(d = ant_plug_d, h = ant_plug_len + ant_stub, $fn = fn_sml);
      translate([0, 0, ant_stub - eps]) cylinder(d = stalk_d, h = stalk_len - holder_depth - ant_stub + 2 * eps, $fn = fn_sml);
      translate([0, 0, stalk_len]) stalk_holder();
      // plug that closes the ball's mouth; the LED board sits on its end face
      translate([0, 0, stalk_len - eps]) cylinder(d = ball_plug_d, h = ball_plug_len + eps, $fn = fn_mid);
    }
    // wire bore for the three 30 AWG wires of the LED
    translate([0, 0, -ant_plug_len - 1]) cylinder(d = stalk_bore, h = stalk_end + ant_plug_len + 2, $fn = fn_sml);
  }
}

// s = -1 is the left antenna (at -X, "zib_antenna_stalk"), +1 the right one.
module zib_antenna_stalk(s = -1) { ant_frame(s) stalk_local(); }

// ================================================================ zib_antenna_ball

// Local frame: flat rim at z = 0, mouth facing -Z toward the stalk.
module ball_local() {
  difference() {
    intersection() {
      translate([0, 0, ball_cut]) sphere(d = ball_d, $fn = fn_mid);
      translate([-10, -10, 0]) cube([20, 20, 20]);
    }
    translate([0, 0, ball_cut]) sphere(d = ball_inner_d, $fn = fn_mid);
    translate([0, 0, -eps]) cylinder(d = ball_mouth_d, h = ball_cut + eps, $fn = fn_mid);
  }
}

module zib_antenna_ball(s = -1) { ant_frame(s) translate([0, 0, stalk_len]) ball_local(); }

// @@PARTS (the part modules go above this line)

// ================================================================ dispatcher

// "view": the part where it sits when assembled (figure coordinates).
module view_part(p) {
  if      (p == "zib_body")               zib_body();
  else if (p == "zib_head")               zib_head();
  else if (p == "zib_eye_left")           zib_eye(-1);
  else if (p == "zib_eye_right")          zib_eye(1);
  else if (p == "zib_arm_left")           zib_arm(-1);
  else if (p == "zib_arm_right")          zib_arm(1);
  else if (p == "zib_belt")               zib_belt();
  else if (p == "zib_buckle_cap")         zib_buckle_cap();
  else if (p == "zib_back_cover")         zib_back_cover();
  else if (p == "zib_antenna_stalk")      zib_antenna_stalk(-1);
  else if (p == "zib_antenna_ball")       zib_antenna_ball(-1);
  else if (p == "zib_antenna_stalk_right") zib_antenna_stalk(1);   // view only: same part as the left one
  else if (p == "zib_antenna_ball_right")  zib_antenna_ball(1);    // view only
  else if (p == "zib_paint_white")        zib_paint_white();       // view only
  else if (p == "zib_paint_pink")         zib_paint_pink();        // view only
  else if (p == "zib_paint_dark")         zib_paint_dark();        // view only
  else assert(false, str("unknown part: ", p));
}

// "print": the part alone, resting on z = 0, centred on x = y = 0.
// rotate([-90, 0, 0]) maps (x, y, z) to (x, z, -y): the figure's +Y face goes down.
// The right-hand antenna ids print like the left ones (the same part).
module print_part(p) {
  eye_c = head_c0[2] + eye_dz;                   // eye centre height
  arm_zc = (arm_ha[2] - hand_r + arm_sh[2] + arm_r) / 2;   // arms are centred on their length
  if      (p == "zib_body")          zib_body();                                          // upright on its boots
  else if (p == "zib_head")          translate([0, -head_c0[1], -seat_z]) zib_head();     // flat seat on the bed, face to the front
  else if (p == "zib_eye_left")      translate([eye_dx, -eye_c, eye_floor_y]) rotate([-90, 0, 0]) zib_eye(-1);   // flat back down, dome up
  else if (p == "zib_eye_right")     translate([-eye_dx, -eye_c, eye_floor_y]) rotate([-90, 0, 0]) zib_eye(1);
  else if (p == "zib_arm_left")      translate([0, 0, -arm_flat_x]) rotate([0, 90, 0]) translate([0, 0, -arm_zc]) zib_arm(-1);   // flat glue face down
  else if (p == "zib_arm_right")     translate([0, 0, -arm_flat_x]) rotate([0, -90, 0]) translate([0, 0, -arm_zc]) zib_arm(1);
  else if (p == "zib_belt")          translate([0, -(front_y + belt_y_end) / 2, -(chest_z - frame_h / 2)]) zib_belt();   // upright, buckle plate to the front
  else if (p == "zib_buckle_cap")    cap_local();                                         // front face down, stem up
  else if (p == "zib_back_cover")    translate([0, chest_z, -cover_y]) rotate([90, 0, 0]) zib_back_cover();   // inner face on the bed
  else if (p == "zib_antenna_stalk" || p == "zib_antenna_stalk_right")   // standing on the ball plug
    translate([0, 0, stalk_end]) rotate([180, 0, 0]) stalk_local();
  else if (p == "zib_antenna_ball" || p == "zib_antenna_ball_right") ball_local();      // flat rim on the bed
  else if (p == "zib_paint_white" || p == "zib_paint_pink" || p == "zib_paint_dark")
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

// Colour bands of the body: boots below the first pause, legs up to the second.
// (the slabs stop 0.01 mm off the real boot top and torso bottom so no faces coincide in the preview)
module boots_slab() { translate([-50, -50, -1]) cube([100, 100, boot_h + 0.01 + 1]); }
module legs_slab()  { translate([-50, -50, boot_h + 0.01]) cube([100, 100, torso_z0 - boot_h - 0.02]); }

// The recess filled with paint, a hair below the skin so no faces coincide (picture only).
module paint_in() {
  intersection() {
    head_ellipsoid(-0.03);
    difference() {
      yprism(eye_front_y, head_c0[1]) offset(delta = -0.03) children();
      head_ellipsoid(-recess_depth);
    }
  }
}

// The part of the web between the two legs (picture only: it is painted a darker green).
module web_gap() { translate([-(web_x - 2), -20, 0]) cube([2 * (web_x - 2), 40, 20]); }

module assembly() {
  pad_standin();
  translate(fig) {
    // body in its three colours: dark purple boots (pause at 7 mm), green legs (pause at 14 mm), purple jumpsuit
    // Each band is rendered to a plain solid first (the body itself is computed once and
    // reused): the preview's own CSG draws speckles and seams for products this big.
    color(c_boot)  uniq(0) render() intersection() { zib_body(); boots_slab(); }
    color(c_skin)  uniq(1) render() difference()   { intersection() { zib_body(); legs_slab(); } web_gap(); }
    color(c_shade) uniq(5) render() intersection() { zib_body(); legs_slab(); web_gap(); }   // the web between the legs, a darker green recess
    color(c_suit)  uniq(2) render() difference()   { zib_body(); boots_slab(); legs_slab(); }
    color(c_suit) render() zib_back_cover();
    color(c_belt) render() zib_belt();
    color(c_lime) zib_buckle_cap();                       // in real life LED 0 lights it from behind
    color(c_skin) { zib_arm(-1); zib_arm(1); }
    // the head is lifted 0.15 mm so its seat does not z-fight with the torso's top in the preview
    translate([0, 0, 0.15]) {
      color(c_skin) render() zib_head();
      // the painted details, shown filled in the picture: dark smile, pink cheeks
      // (also rendered to plain solids: an intersection with the head's big ellipsoid speckles in the preview)
      color(c_eye)   uniq(1) render() paint_in() smile2d();
      color(c_cheek) uniq(2) render() paint_in() { cheek2d(-1); cheek2d(1); }
      color(c_eye)   uniq(3) { render() eye_plug(-1); render() eye_plug(1); }
      color(c_white) uniq(4) { render() eye_dots(-1); render() eye_dots(1); }
    }
    color(c_skin) { zib_antenna_stalk(-1); zib_antenna_stalk(1); }
    color(c_lime, lime_alpha) { zib_antenna_ball(-1); zib_antenna_ball(1); }
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
