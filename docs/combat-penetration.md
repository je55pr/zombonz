# Bullet penetration

The original [WaW weapon files](https://github.com/B2ORG/weaponfiles/tree/main/t4/nazi_zombie_prototype/sp)
and [BO1 weapon files](https://github.com/B2ORG/weaponfiles/tree/main/t5/common_zombie/sp)
provide `penetrateType` tiers. For example, the WaW `zombie_colt` is `small`, the Kar98k is
`medium`, the PTRS-41 is `large`, and BO1's M14 is `large`. The WaW Thompson is `medium`
despite being an SMG; the FG42 is `small`. The BO1 Pack-a-Punched M1911 switches to an
explosive weapon with `penetrateType` `none`. These are original game configuration files
preserved in a community mirror.

Those files establish weapon differences, but do not specify an exact count of zombie bodies
or damage retained after each body. The engine's penetration calculation was not verified here.
Zombonz maps `small` to two hits at 70% retained damage, `medium` to three at 80%, and `large`
to four at 85%. These counts and fractions are **gameplay approximations**, not asserted WaW/BO1
values. Each later hit applies its own head/body multiplier; the shot's ordered intersections
are stable across peers. Solid world geometry stops the ray. Pellet, explosive and chain
weapons retain their existing distinct behavior. Zombonz has no Pack-a-Punch system yet, so
there is no upgraded-weapon penetration modifier to apply.
