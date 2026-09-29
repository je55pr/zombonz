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

**Eye relief** (how far the rear sight is from the eye) is where a shouldered gun would put the eye: about 12 cm in
front of the butt, so a rear sight far up the barrel (Kar98k, MG42) is looked at from far away and a peep sight on the
receiver from close, within 13 to 42 cm. (On the exact line of sight, a fixed 13 cm puts the Kar98k's eye directly over
its receiver, which then fills the view.) Handguns and machine pistols are held out at arm's length and list their own
(28 and 24 cm); at 13 cm a pistol's rear sight fills the screen.

The viewmodel has its own camera with a fixed vertical field of view, so none of this depends on the field-of-view
setting (which only zooms the world while aiming) and the sights stay on the centre at any window shape.

The hip pose is the aimed pose plus a fixed offset, as before. A gun's own `relief` moves the aimed pose but not the
hip pose. Raising the gun blends position and rotation together, and the rear sight closes in on the centre of the
screen without overshooting it (a test checks that for a rifle, the pistol and a shotgun).

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
