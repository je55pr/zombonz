# Aiming down the sights

Issue #176: most guns did not line up when aimed. The old code put the top of the front sight on the middle of the
screen and guessed where the rear sight was from the highest point on the receiver. That is wrong for any gun whose
rear sight is a peep hole (the hole sat off-centre), a notch (the notch was not where the eye looks), or is not the
highest thing on the gun, and it ignored a rear sight that is not level with the front one.

## How it works now

Every gun has two points in [`src/client/weaponSights.ts`](../src/client/weaponSights.ts):

- **rear**: the middle of the opening the eye looks through (the centre of a peep hole; halfway up a notch);
- **front**: the tip of the front sight post.

Aiming turns the gun (about the vertical and about its own side-to-side axis, never rolled) until the line through
those two points runs straight ahead, and puts the rear point on the view axis, `relief` in front of the eye. So the
eye, the rear sight and the front sight are one line down the middle of the screen. Shots leave the camera along that
same axis, so what is under the sights is what is hit. There is no fixed nudge or per-gun height any more; what a gun
needs is its two points.

## How big the sights are

Lining the sights up did not make them the right size. Black Ops screenshots of the Kar98k aimed (same room, 1280 px wide)
show its iron sights about 3.1% of the window's width, against about 0.8% in ours at that point. Three things set the
size:

- **Zoom.** The world zooms by 1.74 times when a shoulder gun is aimed. Measured from a hip and an aimed Black Ops
  screenshot of the same view: a gate 310 px wide became 538 px and a shelf 137 px became 238 px, both about the screen
  centre (so a pure zoom). Black Ops' pistol does not zoom at all (its two screenshots have the same view); sidearms here
  zoom 1.3 times, a choice, so that aiming one still steadies the view (`ADS_ZOOM` in `src/client/aim.ts`). Machine pistols
  count as shoulder guns.
- **The gun is drawn with the same magnification as the world when it is aimed.** The gun has its own camera, which had
  a fixed 52 degree vertical field of view, so aiming zoomed the world but not the gun and its sights stayed small.
  Aimed, the gun's camera is now Black Ops' 65 degree horizontal field of view narrowed by the gun's zoom
  (`viewmodelFov`), so the sights are the same fraction of the window's *width* at any window shape (a fixed vertical
  field of view would make them smaller on an ultrawide). It blends back to the 52 degree lens at the hip, where the gun is
  unchanged. It does not depend on the field-of-view setting, which only zooms the world.
- **How far the eye is behind the rear sight (`relief`).** Each gun names the sight the eye frames the target with and
  how wide it is in the model (`size` in `weaponSights.ts`), and the eye is put where that sight is 2.8% of the window's
  width (3.1% for the Kar98k, as in Black Ops): a sight of width w at distance d spans w / d / (2 tan(half horizontal
  angle)) of the window. The distance is kept between 13 and 150 cm.

Which sight, and how wide (mm), is a per-gun reading off the same rear-on slices as the sight points: the front guard
(hood, ring or ears) where the gun has one and the eye can be far enough back to see it that size, otherwise the rear leaf,
notch block or aperture holder. Not every gun can reach 2.8%. The M14 wants the eye 11 cm behind its rear sight, closer
than the 13 cm limit, and lands at 2.7%. The M1 Garand's front ears are only 8 mm across, so it is sized by the 21 mm
guard ears of its rear aperture instead, which puts the eye about a metre back: the sight is the right size but the gun is
small. The Skorpion, MP5K, double-barrel and Ithaca are physically large in these models and sit 0.9 to 1.3 m back.

| | sight | width | zoom | eye behind rear sight | share of window |
|---|---|---|---|---|---|
| Kar98k | front ring | 16 mm | 1.74 | 28 cm | 3.1% |
| Starting pistol | rear notch block | 20.6 mm | 1.3 | 75 cm | 2.8% |
| M14 | front ears | 14 mm | 1.74 | 13 cm (limit) | 2.7% |
| Others | see `WEAPON_SIGHTS` | | | | 2.8% |

The hip pose does not move: it is still the aimed pose plus a fixed offset, and relief only moves the aimed pose. Raising the
gun blends position, rotation and lens together, and the rear sight closes in on the centre of the screen without
overshooting it (a test checks that for a rifle, the pistol and a shotgun).

## Looking around while aiming

Mouse look is scaled by 0.7 while the player is aiming (`ADS_LOOK_SCALE`), on top of the zoom having already narrowed the
view, so an aimed shot feels steadier than hip fire. The scale applies to each mouse movement as it happens, using the
simulation's own `aiming` flag (the one that also drives the zoom), so it follows the aim button, the sprint and reload
rules, and a change lasts at most one tick. It is not blended: the speed changes at once when aiming starts or stops.

## Checking the size

`test/weapon-sights.test.ts` projects the sight each gun is sized by through the weapon camera at square, 4:3, 16:9, 21:9
and 32:9 and requires 2.8% of the window's width (3.1% for the Kar98k) within 0.05, or the right side of it for the guns
held at a limit; it also checks that the weapon camera really is on the aim lens, narrowed by the gun's own zoom, when a
gun is aimed. `test/aim-look.test.ts` checks the look scale. To measure a sight in the dev server, isolate it with a
clipping slab through it, draw it white through `weaponView`'s camera at 1280x720 and count pixels.

## Numbers per gun

Points are in millimetres in the gun's baked space: x to the right of the model's centre, y down from its highest
point, z back from the butt (negative toward the muzzle). They were read off the models:

- the front sight from a view of the gun from behind, cut to a thin slice at the sight (a post inside a hood or between
  ears is the post's tip, not the hood's top);
- a peep hole's centre by finding the hole in the same kind of slice; a notch from its bottom and the tops of its ears.

Where the model does not give a real sight picture the choice is deliberate:

- **Shotguns** (`double-barrel`, `trench-gun`, `ithaca37`) have no rear sight. The line starts a few millimetres above
  the end of the receiver, so it clears the receiver and runs along the barrel to the muzzle, and the barrel shows below
  it.
- **`ak74u`**: the model's rear sight is folded down, about 14 mm below its front post, which would tilt the aimed gun
  by almost 4 degrees. The rear point is placed nearly level with the post instead, and the folded leaf shows below.
- **`mg42`**: the rear sight is a solid ridge with no notch, so the rear point sits just above its top.
- **`fal`**: the model's rear aperture is 3 mm left of its front post, so the aimed gun is turned very slightly to
  compensate.
- **`rpg7`**: its sights sit 15 mm left of the tube (a tall slot behind, a post inside a hood ahead), so aimed, the tube
  fills the lower right of the view.
- `kar98k` and `bar` hide parts of their models that block the aimed view (the Kar98k's scope, the BAR's carry handle);
  the points are measured with those parts hidden.

## Checking a gun

[`test/weapon-sights.test.ts`](../test/weapon-sights.test.ts) loads every model and checks that:

- every gun has sights, and only guns that exist do;
- once fully aimed, the rear point and the front point both project to the exact centre of the screen at window shapes
  from square to 32:9;
- the line of sight from the eye to the front sight is not blocked by any part of the gun (this is what catches a rear
  point that is inside the sight, or a hood or receiver in the way);
- the gun is turned by no more than a few degrees, and not rolled.

To look at one gun aimed: `npm run dev`, then open `/?preview=start&weapon=<id>&aim=1`. After changing a model, its
length in `VIEWMODEL_LENGTHS` or the parts hidden in `HIDDEN_PARTS` (`src/client/weaponView.ts`), the numbers move and
the tests will very likely fail; re-measure the points as described above.
