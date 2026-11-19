// OpenStellarFirm desk pet: Nova, the astronaut (the owner's default pet).
//
// OpenSCAD 2021.01, millimetres. Self-contained: no include or use.
// Coordinates (the same for every desk pet figure):
//   * Z is up and the FRONT of the figure faces -Y. Viewer's left is -X, so the
//     antenna (on the helmet's upper left in the drawing) is at -X.
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
//   nova_body          ivory suit with arms, gloves, legs and boots. One piece.
//                      Pause the print at z = 8 to swap to grey for the boots,
//                      or paint them. Holds the insert holes, the cable
//                      channel, the chest pocket, the LED channel and the neck
//                      peg.
//   nova_helmet        ivory sphere with a flat seat, the neck socket, the LED
//                      channel to the antenna and the visor pocket.
//   nova_visor         dark plug that fills the helmet's visor pocket, with the
//                      raised eyes, smile and glints for painting.
//   nova_collar        suit-shade neck ring between the torso and the helmet
//                      (an extra part: it makes the neck read right and seats the helmet).
//   nova_backpack      warm grey box on the back, offset to -X like the drawing.
//   nova_chest_panel   dark bezel (28 x 17) that is glued into the chest seat
//                      and holds the lime cap.
//   nova_chest_cap     translucent lime button cap: flange behind the bezel's lip
//                      and a 4 mm stem that presses the tactile switch.
//   nova_antenna_stalk grey stalk with a wire bore, a plug for the helmet and a
//                      plug for the ball.
//   nova_antenna_ball  translucent lime hollow ball (inner 11 mm) for a 10 mm
//                      LED board (LED 1).
//   View only (for the 3D viewer, never printed: layout "print" refuses them).
//   Each is a 0.3 mm paint skin standing 0.05 mm proud of the visor's raised details:
//   nova_paint_ivory   the raised eyes and smile, ivory.
//   nova_paint_lime    the glint arc and dot, lime.
//
// Assembly order:
//   1. Press two M3 heat-set inserts into the soles.
//   2. Solder the chest module (switch, LED 0, skin ID resistor) on a board up to
//      20 x 16 mm, slide it into the pocket through the front window and glue it
//      to the pocket's back wall with the switch on the cap axis (x = -5, z = 27).
//      Run its wires down the 7 mm channel and crimp the plug afterwards.
//   3. Press the cap into the panel from behind, then glue the panel into its seat.
//   4. Put LED 1 on the stalk's plug end and thread its three wires through the
//      stalk, the helmet's channel and the neck peg into the pocket. Glue the
//      stalk into the helmet, then the ball over the LED.
//   5. Slide the collar over the peg, glue the helmet on, glue the visor into its
//      pocket and the backpack onto the back.

part   = "assembly";
layout = "view";
cut    = "";   // "", "x", "y" or "z"
cut_at = 0;    // world coordinate of the cutting plane

// ---------------------------------------------------------------- resolution
fn_view  = 48;   // viewer exports
fn_print = 96;   // print exports (kept under 12 MB per STL)
pretty   = layout == "print" || part == "assembly";   // PNG previews look best smooth
fn_big   = pretty ? fn_print : fn_view;               // helmet, visor
fn_mid   = pretty ? 48 : 32;                          // rounded corners 4 to 10 mm
fn_sml   = pretty ? 40 : 24;                          // pegs, holes, small details
$fn = fn_mid;
eps = 0.02;      // overlap so unions and cuts never leave coincident faces

// ---------------------------------------------------------------- placement
fig = [0, 8, 36];                    // figure origin in world (launch pad) coordinates

// ---------------------------------------------------------------- palette (the OpenStellarFirm pet colours)
c_suit   = "#f3efe6";  c_shade  = "#cdc8bc";  c_glove = "#e3dfd5";  c_boot  = "#8c90a0";
c_pack   = "#b7b3a8";  c_panel  = "#23242e";  c_marks = "#9d998f";  c_visor = "#2a3550";
c_eyes   = "#f3efe6";  c_metal  = "#a2a8b8";  c_lime  = "#d9ff3f";  c_pad   = "#1b1b22";
lime_alpha = 0.85;                   // translucent caps and ball in the picture

// ---------------------------------------------------------------- boots, legs and the web between them
boot_w = 17;  boot_d = 20;  boot_h = 8;  boot_r = 3;   // rounded box, flat sole
boot_x = 11;                          // boot centre at x = +-11
boot_y = -2;                          // boots stand 2 mm forward so the web can sit behind the leg fronts
leg_d  = 14;  leg_z0 = 6;  leg_z1 = 16;
web_x = 7;   web_y0 = -8.7; web_y1 = 2.5;  web_z1 = 14; // block that joins the legs around the cable channel
insert_x = 12;                        // M3 heat-set inserts at (+-12, 0)
insert_d = 4.0;  insert_depth = 6.5;
cable_xy = [0, -4];                   // 7 mm cable channel axis (and the LED channel axis above)
cable_d  = 7;

// ---------------------------------------------------------------- torso, arms
torso_w = 42;  torso_d = 36;  torso_z0 = 12;  torso_z1 = 40;
torso_rb = 6;  torso_rt = 5;          // bottom and top corner radii
front_y = -torso_d / 2;               // front surface of the torso (-18)
arm_r = 4.5;   glove_r = 5.5;
shoulder = [22, 0, 34.5];             // arm top, per side (x mirrored)
glove_c  = [26.5, 0, 20.5];           // glove centre, per side (x about 27, z about 20)

// ---------------------------------------------------------------- chest pocket, panel and cap
chest_z  = 27;                        // centre height of the panel and the cap
cap_x    = -5;                        // the light sits on the panel's left half (viewer's left = -X)
pocket_w = 22;  pocket_h = 22;  pocket_d = 15;   // the chest module pocket
panel_w  = 28;  panel_h  = 17;  panel_t  = 3;  panel_r = 4;
seat_clear = 0.2;                     // per side, panel in its seat
// The pocket starts behind the panel (its back face is the seat floor), so the
// panel closes it and the pocket is 15 mm deep behind the bezel.
pocket_y0 = front_y + panel_t;
pocket_y1 = pocket_y0 + pocket_d;     // = 0, the centre of the torso
pocket_z0 = chest_z - pocket_h / 2;   // 16
pocket_z1 = chest_z + pocket_h / 2;   // 38
cap_d = 11;  cap_clear = 0.3;  cap_proud = 0.6;
cap_flange_d = 14;  cap_flange_t = 1.0;
cap_stem_d = 5;  cap_stem_len = 4;
lip_t = 1.6;                          // bezel in front of the flange; keeps the cap in
hole_d = cap_d + 2 * cap_clear;       // hole in the bezel
cb_d   = cap_flange_d + 2 * cap_clear;// counterbore behind the lip for the flange
bar_h  = 0.8;                         // raised marks on the panel (paint them panel-mark grey)

// ---------------------------------------------------------------- neck, collar, helmet
neck_y     = cable_xy[1];             // peg, socket, LED channel and collar hole share this axis (y = -4)
peg_d = 10;  peg_exposed = 6;         // peg 10 x 6 on the body
socket_d = 10.4;  socket_depth = 6.5; // socket in the helmet (0.2 clearance a side)
collar_d = 28;  collar_h = 3;  collar_hole_d = 10.4;
helmet_d  = 62;  helmet_cz = 68;      // sphere centre at z = 68, top at 99
helmet_seat_z = torso_z1 + collar_h;  // flat seat of the helmet on the collar
led_d = 5;                            // LED wire channels
peg_top_z = helmet_seat_z + peg_exposed;

// ---------------------------------------------------------------- visor
visor_a = 21;  visor_b = 18;          // oval 42 x 36 (the first plan said about 40 x 34; a little larger matches the drawing)
visor_dz = -1;                        // visor sits 1 mm below the helmet centre like the drawing
visor_recess = 1;                     // its face is 1 mm below the helmet's surface
visor_edge_t = 4;                     // plug thickness at the oval's thinnest edge
visor_clear = 0.2;                    // glue clearance per side in the helmet pocket
detail_h = 0.8;                       // raised eyes, smile and glints
eye_dx = 6.5;  eye_dz = -1.4;  eye_w = 6.2;  eye_h = 8.8;
smile_low = -12;  smile_chord = 12;  smile_sag = 2.6;  smile_w = 2.2;
glint_t0 = 95;  glint_t1 = 165;  glint_w = 2.6;  glint_k = 0.88;
dot_x = 13.5;  dot_z = 10;  dot_d = 3.6;
paint_t = 0.3;  paint_lift = 0.05;    // view-only paint layers: skin thickness, and how far it stands proud of what it covers

// ---------------------------------------------------------------- antenna (LED 1)
ant_tilt   = 20;                      // degrees outward (toward -X) from vertical
stalk_len  = 16;  stalk_d = 4.0;  stalk_bore = 2.4;
ant_plug_d = 5.4;  ant_plug_len = 4;  ant_stub = 1;   // plug in the helmet
ant_sock_d = 5.8;                     // helmet's antenna socket
ball_d = 14;  ball_inner_d = 11;  ball_cut = 3;       // ball centre is 3 above its flat rim (rim 1 mm wide)
holder_depth = 3.6;                   // grey holder under the ball continues its outline down to the stalk
ball_mouth_d = 10.6;                  // opening for the 10 mm LED board
ball_plug_d  = 10.2;  ball_plug_len = ball_cut;       // stalk end that closes the mouth

// ---------------------------------------------------------------- backpack
pack_w = 34;  pack_d = 12;  pack_h = 30;  pack_r = 4;
pack_cx = -17;                        // offset to -X: the drawing shows it peeking out on the viewer's left
pack_z0 = 20;
pack_clear = 1.5;                     // gap to the helmet

// ---------------------------------------------------------------- pad stand-in (assembly picture only)
pad_r = 60;  pad_flat_y = 40;  pad_h = 36;

// ================================================================ helpers

// OpenSCAD's sphere has no vertex on its poles, so a faceted sphere stops about
// half a percent short of its radius. This one reaches r on all three axes, so
// flat faces built from it (soles, the backpack's back) land exactly where the
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

// Thin spherical shell (r1 < r2) over the front (-Y) cap of a sphere centred
// at the origin, within half_angle degrees of the -Y axis. Cheaper than a full
// sphere and exactly the same surface as the helmet.
module front_shell(r1, r2, half_angle, n = 24) {
  rotate([90, 0, 0])
    rotate_extrude($fn = fn_big, convexity = 6)
      polygon(concat(
        [for (i = [0 : n]) let (a = half_angle * i / n) [r2 * sin(a), r2 * cos(a)]],
        [for (i = [n : -1 : 0]) let (a = half_angle * i / n) [r1 * sin(a), r1 * cos(a)]]));
}

// ================================================================ nova_body

module torso_solid() {
  bx = torso_w / 2 - torso_rb;  by = torso_d / 2 - torso_rb;  bz = torso_z0 + torso_rb;
  tx = torso_w / 2 - torso_rt;  ty = torso_d / 2 - torso_rt;  tz = torso_z1 - torso_rt;
  hull() {
    translate([-bx, -by, bz]) rsphere(torso_rb);
    translate([ bx, -by, bz]) rsphere(torso_rb);
    translate([-bx,  by, bz]) rsphere(torso_rb);
    translate([ bx,  by, bz]) rsphere(torso_rb);
    translate([-tx, -ty, tz]) rsphere(torso_rt);
    translate([ tx, -ty, tz]) rsphere(torso_rt);
    translate([-tx,  ty, tz]) rsphere(torso_rt);
    translate([ tx,  ty, tz]) rsphere(torso_rt);
  }
}

module arm_solid(side) {
  hull() {
    translate([side * shoulder[0], shoulder[1], shoulder[2]]) sphere(r = arm_r, $fn = fn_mid);
    translate([side * glove_c[0], glove_c[1], glove_c[2]]) sphere(r = arm_r, $fn = fn_mid);
  }
  translate([side * glove_c[0], glove_c[1], glove_c[2]]) sphere(r = glove_r, $fn = fn_mid);
}

module glove_regions() {
  for (s = [-1, 1]) translate([s * glove_c[0], glove_c[1], glove_c[2]]) sphere(r = glove_r + 0.05, $fn = fn_mid);
}

module boots_slab() {                  // the grey boots: everything below the pause height
  translate([-50, -50, -1]) cube([100, 100, boot_h + 1]);
}

module legs_solid() {
  for (s = [-1, 1]) {
    // boot: rounded box, flat sole at z = 0
    rbox_ab([s * boot_x - boot_w / 2, boot_y - boot_d / 2, 0],
            [s * boot_x + boot_w / 2, boot_y + boot_d / 2, boot_h], boot_r);
    translate([s * boot_x, boot_y, leg_z0]) cylinder(d = leg_d, h = leg_z1 - leg_z0, $fn = fn_mid);
  }
  // web: joins the legs and wraps the cable channel; set back behind the leg fronts
  rbox_ab([-web_x, web_y0, 0], [web_x, web_y1, web_z1], 1.5);
}

module neck_peg() {
  translate([0, neck_y, torso_z1 - 2]) cylinder(d = peg_d, h = peg_top_z - torso_z1 + 2, $fn = fn_sml);
}

module nova_body() {
  difference() {
    union() {
      torso_solid();
      for (s = [-1, 1]) arm_solid(s);
      legs_solid();
      neck_peg();
    }
    // two M3 heat-set insert holes, 4.0 x 6.5 from the sole, in the boots
    for (s = [-1, 1])
      translate([s * insert_x, 0, -eps]) cylinder(d = insert_d, h = insert_depth + eps, $fn = fn_sml);
    // cable channel: 7 mm, vertical, from the sole up into the chest pocket
    translate([cable_xy[0], cable_xy[1], -eps])
      cylinder(d = cable_d, h = pocket_z0 + 1 + eps, $fn = fn_sml);
    // chest pocket (22 x 22 x 15 behind the bezel), centred on the cap
    translate([cap_x, 0, chest_z]) yprism(pocket_y0, pocket_y1) rrect2d(pocket_w, pocket_h, 3);
    // seat for the chest panel, flush with the front of the torso
    translate([0, 0, chest_z]) yprism(front_y - 1, pocket_y0 + eps)
      rrect2d(panel_w + 2 * seat_clear, panel_h + 2 * seat_clear, panel_r + seat_clear);
    // LED wire channel: 5 mm, vertical, from the pocket up through the neck peg
    translate([0, neck_y, pocket_z1 - 1]) cylinder(d = led_d, h = peg_top_z + 1 - (pocket_z1 - 1), $fn = fn_sml);
  }
}

// ================================================================ nova_collar
module nova_collar() {
  difference() {
    union() {
      translate([0, 0, torso_z1]) cylinder(d = collar_d, h = collar_h - 0.6, $fn = fn_mid);
      // soft top edge
      translate([0, 0, torso_z1 + collar_h - 0.6 - eps])
        cylinder(d1 = collar_d, d2 = collar_d - 1.2, h = 0.6 + eps, $fn = fn_mid);
    }
    translate([0, neck_y, torso_z1 - 1]) cylinder(d = collar_hole_d, h = collar_h + 2, $fn = fn_sml);
  }
}

// ================================================================ nova_helmet

// Antenna axis. It starts at the centre of the socket ceiling, so one straight
// 5 mm channel runs from the neck to the antenna (the body's vertical channel
// meets it right there), and leaves the sphere where the line crosses it.
ant_dir  = [-sin(ant_tilt), 0, cos(ant_tilt)];
ant_p0   = [0, neck_y, helmet_seat_z + socket_depth];
ant_d    = ant_p0 - [0, 0, helmet_cz];
ant_dot  = ant_dir * ant_d;
ant_t    = -ant_dot + sqrt(ant_dot * ant_dot - (ant_d * ant_d - pow(helmet_d / 2, 2)));
ant_base = ant_p0 + ant_dir * ant_t;  // where the stalk leaves the helmet

// Local frame of the antenna: origin on the helmet surface, +Z along the stalk.
module ant_frame() {
  translate(ant_base) rotate([0, -ant_tilt, 0]) children();
}

// Centre and front sphere of the visor.
visor_zc  = helmet_cz + visor_dz;
visor_rf  = helmet_d / 2 - visor_recess;
visor_rmax = max([for (t = [0 : 5 : 355])
  sqrt(pow(visor_a * cos(t), 2) + pow(visor_b * sin(t) + visor_dz, 2))]);
visor_y_floor = -sqrt(pow(visor_rf, 2) - pow(visor_rmax, 2)) + visor_edge_t;  // flat back of the plug
// The visor pocket takes the front off the helmet, so the print position is
// centred on the helmet's bounding box (front = nearest ivory to the axis) and
// not on the sphere's centre.
visor_rmin = min([for (t = [0 : 2 : 358])
  sqrt(pow((visor_a + visor_clear) * cos(t), 2) + pow((visor_b + visor_clear) * sin(t) + visor_dz, 2))]);
helmet_front_y  = -sqrt(pow(helmet_d / 2, 2) - pow(visor_rmin, 2));
helmet_print_dy = -(helmet_front_y + helmet_d / 2) / 2;

module visor_oval(grow = 0) {
  offset(delta = grow) scale([visor_a, visor_b]) circle(r = 1, $fn = fn_big);
}

module visor_pocket() {
  translate([0, 0, visor_zc]) yprism(-helmet_d, visor_y_floor) visor_oval(visor_clear);
}

module nova_helmet() {
  difference() {
    intersection() {
      translate([0, 0, helmet_cz]) sphere(d = helmet_d, $fn = fn_big);
      translate([-50, -50, helmet_seat_z]) cube([100, 100, 100]);   // flat seat on the collar
    }
    // neck socket 10.4 x 6.5, on the shared neck axis
    translate([0, neck_y, helmet_seat_z - eps]) cylinder(d = socket_d, h = socket_depth + eps, $fn = fn_sml);
    // straight LED channel from the socket ceiling to the antenna socket
    ant_frame() translate([0, 0, -ant_t - 0.6]) cylinder(d = led_d, h = ant_t + 0.6 + 2, $fn = fn_sml);
    // antenna socket for the stalk's plug
    ant_frame() translate([0, 0, -ant_plug_len]) cylinder(d = ant_sock_d, h = ant_plug_len + 3, $fn = fn_sml);
    // pocket for the visor plug
    visor_pocket();
  }
}

// ================================================================ nova_visor

// Raised detail: a 2D shape (x, z relative to the visor centre) cut by the
// visor's front sphere, standing detail_h proud of it.
module visor_detail() {
  intersection() {
    translate([0, 0, visor_zc]) yprism(-helmet_d, -helmet_d / 4) children();
    translate([0, 0, helmet_cz]) front_shell(visor_rf - 0.3, visor_rf + detail_h, 75);
  }
}

module stroke2d(pts, w) {
  for (i = [0 : len(pts) - 2]) hull() {
    translate(pts[i]) circle(d = w, $fn = fn_sml);
    translate(pts[i + 1]) circle(d = w, $fn = fn_sml);
  }
}

smile_r  = (pow(smile_chord / 2, 2) + pow(smile_sag, 2)) / (2 * smile_sag);
smile_a0 = asin(smile_chord / 2 / smile_r);
smile_pts = [for (i = [0 : 16])
  let (a = -90 - smile_a0 + 2 * smile_a0 * i / 16)
  [smile_r * cos(a), smile_low + smile_r + smile_r * sin(a)]];
glint_pts = [for (i = [0 : 20])
  let (t = glint_t0 + (glint_t1 - glint_t0) * i / 20)
  [glint_k * visor_a * cos(t), glint_k * visor_b * sin(t)]];

// The 2D shapes of the painted details (x, z relative to the visor centre). The raised
// details and the viewer's paint layers are both made from them.
module eyes2d() {
  for (s = [-1, 1]) translate([s * eye_dx, eye_dz]) scale([eye_w / 2, eye_h / 2]) circle(r = 1, $fn = fn_sml);
}
module smile2d()     { stroke2d(smile_pts, smile_w); }
module glint_arc2d() { stroke2d(glint_pts, glint_w); }
module glint_dot2d() { translate([dot_x, dot_z]) circle(d = dot_d, $fn = fn_sml); }

module visor_eyes()   { visor_detail() eyes2d(); }
module visor_smile()  { visor_detail() smile2d(); }
module visor_glints() { visor_detail() glint_arc2d(); visor_detail() glint_dot2d(); }

module visor_base() {
  intersection() {
    translate([0, 0, visor_zc]) yprism(-helmet_d, visor_y_floor) visor_oval(0);
    translate([0, 0, helmet_cz]) front_shell(0.5, visor_rf, 75);
  }
}

module nova_visor() {
  union() {
    visor_base();
    visor_eyes();
    visor_smile();
    visor_glints();
  }
}

// ================================================================ nova_paint_ivory, nova_paint_lime (view only)

// A paint layer for the 3D viewer, never printed: the top and the sides of a raised detail as
// a paint_t wall standing paint_lift proud of it, so the viewer can colour the paint on its own
// and never z-fights with the visor. A cup: the detail grown by paint_lift (its foot 0.1 mm
// inside the visor) minus the detail shrunk by the rest of the wall.
module paint_skin() {
  difference() {
    intersection() {
      translate([0, 0, visor_zc]) yprism(-helmet_d, -helmet_d / 4) offset(delta = paint_lift) children();
      translate([0, 0, helmet_cz]) front_shell(visor_rf - 0.1, visor_rf + detail_h + paint_lift, 75);
    }
    intersection() {
      translate([0, 0, visor_zc]) yprism(-helmet_d, -helmet_d / 4) offset(delta = paint_lift - paint_t) children();
      translate([0, 0, helmet_cz]) front_shell(visor_rf - 0.3, visor_rf + detail_h + paint_lift - paint_t, 75);
    }
  }
}

module nova_paint_ivory() { paint_skin() eyes2d(); paint_skin() smile2d(); }
module nova_paint_lime()  { paint_skin() glint_arc2d(); paint_skin() glint_dot2d(); }

// ================================================================ nova_backpack

module nova_backpack() {
  difference() {
    translate([pack_cx - pack_w / 2, -front_y, pack_z0])
      rbox_ab([0, 0, 0], [pack_w, pack_d, pack_h], pack_r);
    // follow the helmet: a spherical scoop where its lower back comes close
    intersection() {
      translate([0, 0, helmet_cz]) sphere(d = helmet_d + 2 * pack_clear, $fn = fn_big);
      translate([-60, -60, helmet_seat_z - pack_clear]) cube([120, 120, 100]);
    }
  }
}

// ================================================================ nova_chest_panel

module panel_plate() {
  difference() {
    translate([0, 0, chest_z]) yprism(front_y, front_y + panel_t) rrect2d(panel_w, panel_h, panel_r);
    // hole for the cap, 0.3 mm clear all round
    translate([cap_x, 0, chest_z]) yprism(front_y - 1, front_y + panel_t + 1) circle(d = hole_d, $fn = fn_sml);
    // counterbore behind the lip for the cap's flange
    translate([cap_x, 0, chest_z]) yprism(front_y + lip_t, front_y + panel_t + 1) circle(d = cb_d, $fn = fn_sml);
  }
}

// two raised bars on the right half (paint them panel-mark grey)
module panel_bars() {
  translate([0, 0, chest_z]) yprism(front_y - bar_h, front_y + 0.2) {
    hull() { translate([3.5, 2.8]) circle(d = 2, $fn = fn_sml); translate([11, 2.8]) circle(d = 2, $fn = fn_sml); }
    hull() { translate([3.5, -2.4]) circle(d = 2, $fn = fn_sml); translate([8, -2.4]) circle(d = 2, $fn = fn_sml); }
  }
}

module nova_chest_panel() {
  union() { panel_plate(); panel_bars(); }
}

// ================================================================ nova_chest_cap

// Local frame: front face at z = 0, +Z toward the back of the figure.
module cap_local() {
  body_len = cap_proud + lip_t;
  union() {
    // button face: 0.5 mm chamfer on the front edge
    cylinder(d1 = cap_d - 1, d2 = cap_d, h = 0.5, $fn = fn_sml);
    translate([0, 0, 0.5 - eps]) cylinder(d = cap_d, h = body_len - 0.5 + 2 * eps, $fn = fn_sml);
    // flange behind the lip, so the cap cannot fall out of the front
    translate([0, 0, body_len]) cylinder(d = cap_flange_d, h = cap_flange_t, $fn = fn_sml);
    // stem toward the switch: its tip stops 0.3 mm short of a 6 x 6 x 9.5 mm switch on a 1.6 mm board resting on the pocket's back wall
    translate([0, 0, body_len + cap_flange_t - eps]) cylinder(d = cap_stem_d, h = cap_stem_len + eps, $fn = fn_sml);
  }
}

module nova_chest_cap() {
  translate([cap_x, front_y - cap_proud, chest_z]) rotate([-90, 0, 0]) cap_local();
}

// ================================================================ nova_antenna_stalk

stalk_end = stalk_len + ball_plug_len;   // far end of the stalk (ball side)

// The part of the ball's sphere below its flat rim, in grey: the stalk ends in
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
      // plug that glues into the helmet's antenna socket, with a small stub above the surface
      translate([0, 0, -ant_plug_len]) cylinder(d = ant_plug_d, h = ant_plug_len + ant_stub, $fn = fn_sml);
      translate([0, 0, ant_stub - eps]) cylinder(d = stalk_d, h = stalk_len - holder_depth - ant_stub + 2 * eps, $fn = fn_sml);
      translate([0, 0, stalk_len]) stalk_holder();
      // plug that closes the ball's mouth; the LED board sits on its end face
      translate([0, 0, stalk_len - eps]) cylinder(d = ball_plug_d, h = ball_plug_len + eps, $fn = fn_mid);
    }
    // wire bore for the three 30 AWG wires of LED 1
    translate([0, 0, -ant_plug_len - 1]) cylinder(d = stalk_bore, h = stalk_end + ant_plug_len + 2, $fn = fn_sml);
  }
}

module nova_antenna_stalk() { ant_frame() stalk_local(); }

// ================================================================ nova_antenna_ball

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

module nova_antenna_ball() { ant_frame() translate([0, 0, stalk_len]) ball_local(); }

// ================================================================ dispatcher

// "view": the part where it sits when assembled (figure coordinates).
module view_part(p) {
  if      (p == "nova_body")          nova_body();
  else if (p == "nova_helmet")        nova_helmet();
  else if (p == "nova_visor")         nova_visor();
  else if (p == "nova_collar")        nova_collar();
  else if (p == "nova_backpack")      nova_backpack();
  else if (p == "nova_chest_panel")   nova_chest_panel();
  else if (p == "nova_chest_cap")     nova_chest_cap();
  else if (p == "nova_antenna_stalk") nova_antenna_stalk();
  else if (p == "nova_antenna_ball")  nova_antenna_ball();
  else if (p == "nova_paint_ivory")   nova_paint_ivory();   // view only
  else if (p == "nova_paint_lime")    nova_paint_lime();    // view only
  else assert(false, str("unknown part: ", p));
}

// "print": the part alone, resting on z = 0, centred on x = y = 0.
// rotate([-90, 0, 0]) maps (x, y, z) to (x, z, -y): the figure's +Y face goes down.
module print_part(p) {
  if      (p == "nova_body")          nova_body();                                   // upright on its boots
  else if (p == "nova_helmet")        translate([0, helmet_print_dy, -helmet_seat_z]) nova_helmet();   // flat seat on the bed, visor to the front
  else if (p == "nova_collar")        translate([0, 0, -torso_z1]) nova_collar();
  else if (p == "nova_visor")         // flat back down, dome up
    translate([0, -visor_zc, visor_y_floor]) rotate([-90, 0, 0]) nova_visor();
  else if (p == "nova_backpack")      // lying on its back, glue face up
    translate([-pack_cx, -(pack_z0 + pack_h / 2), -front_y + pack_d]) rotate([-90, 0, 0]) nova_backpack();
  else if (p == "nova_chest_panel")   // lying on its back, front up
    translate([0, -chest_z, front_y + panel_t]) rotate([-90, 0, 0]) nova_chest_panel();
  else if (p == "nova_chest_cap")     cap_local();                                   // front face down, stem up
  else if (p == "nova_antenna_stalk") // standing on the ball plug
    translate([0, 0, stalk_end]) rotate([180, 0, 0]) stalk_local();
  else if (p == "nova_antenna_ball")  ball_local();                                  // flat rim on the bed
  else if (p == "nova_paint_ivory" || p == "nova_paint_lime")
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

module assembly() {
  pad_standin();
  translate(fig) {
    // body in its three colours: grey boots (pause at 8 mm), glove colour, suit
    color(c_boot)  uniq(0) intersection() { nova_body(); boots_slab(); }
    color(c_glove) uniq(1) intersection() { nova_body(); glove_regions(); }
    color(c_suit)  uniq(2) difference()   { nova_body(); boots_slab(); glove_regions(); }
    color(c_shade) nova_collar();
    color(c_suit)  nova_helmet();
    color(c_visor) visor_base();
    color(c_eyes)  { visor_eyes(); visor_smile(); }
    color(c_lime)  uniq(1) visor_glints();
    color(c_pack)  nova_backpack();
    color(c_panel) panel_plate();
    color(c_marks) panel_bars();
    color(c_lime, lime_alpha) nova_chest_cap();
    color(c_metal) nova_antenna_stalk();
    color(c_lime, lime_alpha) nova_antenna_ball();
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
