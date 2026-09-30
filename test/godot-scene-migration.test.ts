import { describe, expect, it } from 'vitest';
import { migrateScene } from '../scripts/migrate-godot-scenes.mjs';

describe('Godot C# scene migration', () => {
  const scene = `[gd_scene format=3]
[ext_resource type="Script" uid="uid://oldroot" path="res://addons/zombonz/map_root.gd" id="1"]
[ext_resource type="Script" uid="uid://olditem" path="res://addons/zombonz/map_item.gd" id="2"]
[sub_resource type="Material" id="other"]
material = "unrelated"
[node name="Asylum" type="Node3D"]
script = ExtResource("1")
source_file = "../../src/maps/data/asylum.v1.json"
[node name="Edited prop" type="Node3D" parent="."]
position = Vector3(10, 2, -5)
rotation = Vector3(0, 1.7, 0)
scale = Vector3(2, 3, 4)
script = ExtResource("2")
data_path = "presentation/props/3/position"
object_id = "my-prop"
asset = "wooden-crate"
material = "wall"
[node name="Other" type="Node3D" parent="."]
material = "also unrelated"
`;

  it('updates script references and exported names while preserving scene edits and unrelated resources', () => {
    const result = migrateScene(scene);
    expect(result).toContain('path="res://addons/zombonz/ZombonzMapRoot.cs"');
    expect(result).toContain('path="res://addons/zombonz/ZombonzMapItem.cs"');
    expect(result).not.toContain('uid://old');
    expect(result).toContain('SourceFile = "../../src/maps/data/asylum.v1.json"');
    expect(result).toContain('DataPath = "presentation/props/3/position"');
    expect(result).toContain('ObjectId = "my-prop"');
    expect(result).toContain('Asset = "wooden-crate"');
    expect(result).toContain('Material = "wall"');
    expect(result).toContain('material = "unrelated"');
    expect(result).toContain('material = "also unrelated"');
    expect(result).toContain('position = Vector3(10, 2, -5)\nrotation = Vector3(0, 1.7, 0)\nscale = Vector3(2, 3, 4)');
  });

  it('is idempotent and preserves Windows line endings', () => {
    const result = migrateScene(scene.replaceAll('\n', '\r\n'));
    expect(result).toContain('DataPath = "presentation/props/3/position"\r\n');
    expect(migrateScene(result)).toBe(result);
  });

  it('leaves scenes without the old map scripts untouched', () => {
    const plain = '[node name="Other"]\nmaterial = "wall"\n';
    expect(migrateScene(plain)).toBe(plain);
  });
});
