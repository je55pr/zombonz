# Exports a weapon .blend to a geometry GLB for convert.mjs, which applies the loose PBR maps.
# Usage: blender -b "<source>.blend" --python blend-to-glb.py -- "<out>.glb"
# Written for the Winchester 1897 source: keeps its meshes, drops the lights and the loose 12-gauge shell.
import sys

import bpy

out = sys.argv[sys.argv.index('--') + 1]
for obj in list(bpy.data.objects):
    if obj.type != 'MESH' or obj.name == '12 cal':
        bpy.data.objects.remove(obj, do_unlink=True)
# Replace the Cyrillic default material names with ASCII ones that weapons.mjs can map.
for material in bpy.data.materials:
    material.name = material.name.replace('Материал', 'm97mat')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True,
                          export_image_format='NONE', export_yup=True)
print('exported', out)
