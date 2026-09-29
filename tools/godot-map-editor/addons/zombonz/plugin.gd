@tool
extends EditorPlugin

const MapRoot = preload("res://addons/zombonz/map_root.gd")
const MapItem = preload("res://addons/zombonz/map_item.gd")
const MapInspector = preload("res://addons/zombonz/map_inspector.gd")
const DEFAULT_SOURCE = "../../src/maps/data/bunker.v1.json"

var dock: VBoxContainer
var source_input: LineEdit
var message: Label
var add_kind: OptionButton
var inspector_plugin: EditorInspectorPlugin

func _enter_tree() -> void:
	dock = VBoxContainer.new()
	dock.name = "Zombonz Maps"
	var title := Label.new()
	title.text = "Versioned map authoring"
	dock.add_child(title)
	source_input = LineEdit.new()
	source_input.text = DEFAULT_SOURCE
	source_input.tooltip_text = "JSON file relative to the Godot project"
	dock.add_child(source_input)
	_add_button("Import map into scene", _import_map)
	add_kind = OptionButton.new()
	for kind in ["Prop", "Greybox", "Collision box", "Zombie spawn", "Barrier", "Door", "Wall weapon", "Hazard", "Navigation node"]:
		add_kind.add_item(kind)
	dock.add_child(add_kind)
	_add_button("Add selected object", _add_new_item)
	_add_button("Validate open map", _validate_open_map)
	_add_button("Export open map", _export_map)
	_add_button("Export and play in browser", _export_and_play)
	message = Label.new()
	message.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	dock.add_child(message)
	add_control_to_dock(DOCK_SLOT_RIGHT_UL, dock)
	inspector_plugin = MapInspector.new()
	add_inspector_plugin(inspector_plugin)

func _exit_tree() -> void:
	remove_inspector_plugin(inspector_plugin)
	remove_control_from_docks(dock)
	dock.queue_free()

func _add_button(label: String, action: Callable) -> void:
	var button := Button.new()
	button.text = label
	button.pressed.connect(action)
	dock.add_child(button)

func _source_path(relative_path: String) -> String:
	return ProjectSettings.globalize_path("res://").path_join(relative_path).simplify_path()

func _read_document(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		message.text = "Map file not found: " + path
		return {}
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(data) != TYPE_DICTIONARY:
		message.text = "Invalid JSON map: " + path
		return {}
	return data

func _import_map() -> void:
	var relative_path := source_input.text.strip_edges()
	var document := _read_document(_source_path(relative_path))
	if document.is_empty():
		return
	var errors := _validate(document)
	if not errors.is_empty():
		message.text = "Import failed: " + errors[0]
		return
	var metadata: Dictionary = document["metadata"]
	var root: Node3D = MapRoot.new()
	root.name = str(metadata["id"]).capitalize() + "Map"
	root.source_file = relative_path
	var gameplay: Dictionary = document["gameplay"]
	var presentation: Dictionary = document["presentation"]
	_add_marker(root, "gameplay/playerSpawn", gameplay["playerSpawn"], "Player spawn", Color.GREEN)
	_add_array(root, gameplay, "gameplay", "zombieSpawns", "", "Zombie spawn", Color.RED)
	_add_array(root, gameplay, "gameplay", "doors", "position", "Door", Color.ORANGE)
	_add_array(root, gameplay, "gameplay", "wallWeapons", "position", "Wall weapon", Color.CYAN)
	_add_array(root, gameplay, "gameplay", "mysteryBoxes", "position", "Mystery box", Color.PURPLE)
	_add_array(root, gameplay, "gameplay", "perkMachines", "position", "Perk", Color.PINK)
	_add_array(root, gameplay, "gameplay", "traps", "switchPosition", "Trap", Color.YELLOW)
	_add_array(root, gameplay, "gameplay", "hazards", "position", "Hazard", Color.RED)
	_add_array(root, gameplay, "gameplay", "equipment", "position", "Equipment", Color.CYAN)
	_add_array(root, gameplay, "gameplay", "packAPunch", "position", "Pack-a-Punch", Color.MEDIUM_PURPLE)
	if gameplay.has("powerSwitch"):
		_add_marker(root, "gameplay/powerSwitch/position", gameplay["powerSwitch"]["position"], "Power switch", Color.YELLOW, gameplay["powerSwitch"])
	for i in range(gameplay["barriers"].size()):
		var barrier: Dictionary = gameplay["barriers"][i]
		var base := "gameplay/barriers/%d" % i
		_add_marker(root, base + "/position", barrier["position"], "Barrier " + str(barrier["id"]), Color.ORANGE, barrier)
		_add_marker(root, base + "/insidePoint", barrier["insidePoint"], "Inside " + str(barrier["id"]), Color.GREEN)
		for j in range(barrier["approachPath"].size()):
			_add_marker(root, base + "/approachPath/%d" % j, barrier["approachPath"][j], "Route %s %d" % [barrier["id"], j], Color.MAGENTA)
	for i in range(gameplay["navigation"]["nodes"].size()):
		var node: Dictionary = gameplay["navigation"]["nodes"][i]
		_add_marker(root, "gameplay/navigation/nodes/%d/position" % i, node["position"], "Nav " + str(node["id"]), Color.DARK_GREEN, {}, "Routes")
	for field in ["collisionBoxes", "shotBlockers"]:
		for i in range(gameplay[field].size()):
			_add_box(root, "gameplay/%s/%d" % [field, i], gameplay[field][i], field + " " + str(i), Color(1.0, 0.2, 0.2, 0.25), "Collision")
	for field in ["greybox", "scenery"]:
		if not presentation.has(field):
			continue
		for i in range(presentation[field].size()):
			var box: Dictionary = presentation[field][i]
			_add_box(root, "presentation/%s/%d" % [field, i], box, field + " " + str(i), Color(0.4, 0.6, 0.9, 0.3), "Geometry")
	_add_array(root, presentation, "presentation", "props", "position", "Prop", Color(0.6, 0.45, 0.3))
	var scene_path := "res://maps/%s.tscn" % metadata["id"]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://maps"))
	var packed := PackedScene.new()
	var result := packed.pack(root)
	if result == OK:
		result = ResourceSaver.save(packed, scene_path)
	root.free()
	if result != OK:
		message.text = "Could not save scene: " + str(result)
		return
	if Engine.is_editor_hint():
		if EditorInterface.get_current_path() == scene_path:
			EditorInterface.reload_scene_from_path(scene_path)
		else:
			EditorInterface.open_scene_from_path(scene_path)
	message.text = "Imported " + str(metadata["name"]) + ". Edit nodes in the 3D scene, then export."

func _group(root: Node3D, name: String) -> Node3D:
	var group := root.get_node_or_null(name) as Node3D
	if group == null:
		group = Node3D.new()
		group.name = name
		root.add_child(group)
		group.owner = root
		if name == "Routes" or name == "Collision":
			group.visible = false
	return group

func _add_marker(root: Node3D, path: String, point: Dictionary, label: String, color: Color, fields: Dictionary = {}, group_name: String = "Gameplay") -> void:
	if not _has_xyz(point):
		return
	var item: Node3D = MapItem.new()
	item.name = label.validate_node_name()
	item.data_path = path
	item.kind = "gameplay" if not fields.is_empty() else "marker"
	item.object_id = str(fields.get("id", ""))
	item.position = Vector3(point["x"], point["y"], point["z"])
	item.rotation.y = float(fields.get("yaw", 0.0))
	item.cost = int(fields.get("cost", -1))
	item.weapon_id = str(fields.get("weaponId", ""))
	item.max_boards = int(fields.get("maxBoards", 0))
	item.requires_power = bool(fields.get("requiresPower", false))
	item.asset = str(fields.get("asset", ""))
	item.weapon_cost = int(fields.get("weaponCost", 200))
	item.ammo_cost = int(fields.get("ammoCost", 100))
	item.barrier_id = str(fields.get("barrierId", ""))
	var group := _group(root, group_name)
	group.add_child(item)
	item.owner = root
	var mesh := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.18 if group_name != "Routes" else 0.09
	sphere.height = sphere.radius * 2.0
	mesh.mesh = sphere
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mesh.material_override = material
	item.add_child(mesh)
	mesh.owner = root

func _add_array(root: Node3D, section: Dictionary, section_name: String, field: String, point_field: String, label: String, color: Color) -> void:
	if not section.has(field):
		return
	for i in range(section[field].size()):
		var entry: Dictionary = section[field][i]
		var path := "%s/%s/%d" % [section_name, field, i]
		if field == "props":
			_add_prop(root, path + "/position", entry)
			continue
		var point: Dictionary = entry if point_field.is_empty() else entry.get(point_field, {})
		if not point_field.is_empty():
			path += "/" + point_field
		_add_marker(root, path, point, label + " " + str(entry.get("id", i)), color, entry)

func _add_prop(root: Node3D, path: String, prop: Dictionary) -> void:
	var point: Dictionary = prop.get("position", {})
	if not _has_xyz(point):
		return
	var size: Dictionary = prop.get("size", {"x": 1.0, "y": 1.0, "z": 1.0})
	var item: Node3D = MapItem.new()
	item.name = ("Prop " + str(prop.get("id", ""))).validate_node_name()
	item.data_path = path
	item.kind = "prop"
	item.object_id = str(prop.get("id", ""))
	item.asset = str(prop.get("asset", ""))
	item.position = Vector3(point["x"], point["y"], point["z"])
	item.rotation.y = float(prop.get("yaw", 0.0))
	item.base_size = Vector3(size["x"], size["y"], size["z"])
	var group := _group(root, "Props")
	group.add_child(item)
	item.owner = root
	var mesh := MeshInstance3D.new()
	var box_mesh := BoxMesh.new()
	box_mesh.size = item.base_size
	mesh.mesh = box_mesh
	var material := StandardMaterial3D.new()
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_color = Color(0.6, 0.45, 0.3, 0.5)
	mesh.material_override = material
	item.add_child(mesh)
	mesh.owner = root

func _add_box(root: Node3D, path: String, box: Dictionary, label: String, color: Color, group_name: String) -> void:
	var center := Vector3.ZERO
	var size := Vector3.ONE
	if box.has("center") and box.has("size"):
		center = Vector3(box["center"]["x"], box["center"]["y"], box["center"]["z"])
		size = Vector3(box["size"]["x"], box["size"]["y"], box["size"]["z"])
	elif box.has("min") and box.has("max"):
		var minimum: Dictionary = box["min"]
		var maximum: Dictionary = box["max"]
		center = Vector3((minimum["x"] + maximum["x"]) / 2.0, (minimum["y"] + maximum["y"]) / 2.0, (minimum["z"] + maximum["z"]) / 2.0)
		size = Vector3(maximum["x"] - minimum["x"], maximum["y"] - minimum["y"], maximum["z"] - minimum["z"])
	else:
		return
	var item: Node3D = MapItem.new()
	item.name = label.validate_node_name()
	item.data_path = path
	item.kind = "box"
	item.position = center
	item.base_size = size
	item.material = str(box.get("material", "wall"))
	item.rotation.x = float(box.get("rotationX", 0.0))
	item.rotation.z = float(box.get("rotationZ", 0.0))
	var group := _group(root, group_name)
	group.add_child(item)
	item.owner = root
	var mesh := MeshInstance3D.new()
	var box_mesh := BoxMesh.new()
	box_mesh.size = Vector3(maxf(size.x, 0.02), maxf(size.y, 0.02), maxf(size.z, 0.02))
	mesh.mesh = box_mesh
	var material := StandardMaterial3D.new()
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mesh.material_override = material
	item.add_child(mesh)
	mesh.owner = root

func _has_xyz(value: Variant) -> bool:
	return typeof(value) == TYPE_DICTIONARY and value.has("x") and value.has("y") and value.has("z")

func _add_new_item() -> void:
	var root := EditorInterface.get_edited_scene_root()
	if not root is ZombonzMapRoot:
		message.text = "Open a Zombonz map scene first."
		return
	var kind := add_kind.get_item_text(add_kind.selected)
	var origin := Vector3.ZERO
	var document := _open_document()
	if document.has("gameplay"):
		var spawn: Dictionary = document["gameplay"]["playerSpawn"]
		origin = Vector3(spawn["x"], spawn["y"], spawn["z"])
	var path := ""
	var item: Node3D
	match kind:
		"Prop":
			path = "new/presentation/props"
			_add_prop(root, path, {"id": "new-prop", "asset": "wooden-crate", "position": _point(origin), "size": {"x": 1.0, "y": 1.0, "z": 1.0}, "yaw": 0.0})
			item = _group(root, "Props").get_child(_group(root, "Props").get_child_count() - 1)
		"Greybox":
			path = "new/presentation/greybox"
			_add_box(root, path, {"center": _point(origin), "size": {"x": 1.0, "y": 1.0, "z": 1.0}, "material": "wall"}, "New greybox", Color(0.4, 0.6, 0.9, 0.3), "Geometry")
			item = _group(root, "Geometry").get_child(_group(root, "Geometry").get_child_count() - 1)
		"Collision box":
			path = "new/gameplay/collisionBoxes"
			_add_box(root, path, {"min": _point(origin - Vector3.ONE / 2.0), "max": _point(origin + Vector3.ONE / 2.0)}, "New collision", Color(1.0, 0.2, 0.2, 0.25), "Collision")
			item = _group(root, "Collision").get_child(_group(root, "Collision").get_child_count() - 1)
		"Zombie spawn", "Barrier", "Door", "Wall weapon", "Hazard", "Navigation node":
			var field: String = {"Zombie spawn": "zombieSpawns", "Barrier": "barriers", "Door": "doors", "Wall weapon": "wallWeapons", "Hazard": "hazards", "Navigation node": "navigation/nodes"}[kind]
			path = "new/gameplay/" + field
			_add_marker(root, path, _point(origin), "New " + kind, Color.CYAN)
			item = _group(root, "Gameplay").get_child(_group(root, "Gameplay").get_child_count() - 1)
	if item == null:
		return
	item.kind = "new"
	item.object_id = "new-" + kind.to_lower().replace(" ", "-")
	if kind == "Barrier":
		item.max_boards = 6
	item.owner = root
	EditorInterface.edit_node(item)
	EditorInterface.mark_scene_as_unsaved()
	message.text = "Added " + kind + ". Set its ID and fields in the Inspector, then export."

func _point(position: Vector3) -> Dictionary:
	return {"x": position.x, "y": position.y, "z": position.z}

func _at_path(document: Dictionary, path: String) -> Variant:
	var value: Variant = document
	for segment in path.split("/"):
		if typeof(value) == TYPE_ARRAY:
			value = value[int(segment)]
		elif typeof(value) == TYPE_DICTIONARY:
			value = value[segment]
		else:
			return null
	return value

func _set_number(target: Dictionary, key: String, value: float) -> void:
	if not target.has(key) or absf(float(target[key]) - value) > 0.0001:
		target[key] = snappedf(value, 0.0001)

func _set_angle(target: Dictionary, key: String, value: float) -> void:
	if not target.has(key) or absf(wrapf(float(target[key]) - value, -PI, PI)) > 0.0001:
		target[key] = snappedf(value, 0.0001)

func _set_position(target: Dictionary, position: Vector3) -> void:
	_set_number(target, "x", position.x)
	_set_number(target, "y", position.y)
	_set_number(target, "z", position.z)

func _apply_item(document: Dictionary, item: Node3D) -> void:
	var target: Variant = _at_path(document, item.data_path)
	if typeof(target) != TYPE_DICTIONARY:
		return
	if item.kind == "box":
		var size: Vector3 = item.scale.abs() * item.base_size
		if target.has("center"):
			_set_position(target["center"], item.position)
			_set_position(target["size"], size)
			if target.has("rotationX") or absf(item.rotation.x) > 0.0001:
				_set_angle(target, "rotationX", item.rotation.x)
			if target.has("rotationZ") or absf(item.rotation.z) > 0.0001:
				_set_angle(target, "rotationZ", item.rotation.z)
		else:
			_set_position(target["min"], item.position - size / 2.0)
			_set_position(target["max"], item.position + size / 2.0)
	else:
		_set_position(target, item.position)
		if str(item.data_path).begins_with("gameplay/zombieSpawns/") and not item.barrier_id.is_empty() and target.get("barrierId", "") != item.barrier_id:
			target["barrierId"] = item.barrier_id
		var parent_path: String = str(item.data_path).get_base_dir().replace("\\", "/")
		var parent: Variant = _at_path(document, parent_path)
		if typeof(parent) == TYPE_DICTIONARY and item.kind != "marker":
			if parent.has("id") and not item.object_id.is_empty() and parent["id"] != item.object_id:
				parent["id"] = item.object_id
			if parent.has("yaw"):
				_set_angle(parent, "yaw", item.rotation.y)
			if item.kind == "prop":
				if parent.has("size"):
					_set_position(parent["size"], item.scale.abs() * item.base_size)
				if parent.has("yaw"):
					_set_angle(parent, "yaw", item.rotation.y)
			if parent.has("cost") and item.cost >= 0 and int(parent["cost"]) != item.cost:
				parent["cost"] = item.cost
			if parent.has("weaponId") and not item.weapon_id.is_empty() and parent["weaponId"] != item.weapon_id:
				parent["weaponId"] = item.weapon_id
			if parent.has("weaponCost") and int(parent["weaponCost"]) != item.weapon_cost:
				parent["weaponCost"] = item.weapon_cost
			if parent.has("ammoCost") and int(parent["ammoCost"]) != item.ammo_cost:
				parent["ammoCost"] = item.ammo_cost
			if parent.has("maxBoards") and int(parent["maxBoards"]) != item.max_boards:
				parent["maxBoards"] = item.max_boards
			if parent.has("requiresPower") and parent["requiresPower"] != item.requires_power:
				parent["requiresPower"] = item.requires_power
			if parent.has("asset") and not item.asset.is_empty() and parent["asset"] != item.asset:
				parent["asset"] = item.asset

func _append_new(document: Dictionary, item: Node3D, pending: Array) -> void:
	var parts: PackedStringArray = str(item.data_path).split("/")
	if parts.size() < 3:
		return
	var section: Dictionary = document[parts[1]]
	var field: String = parts[2]
	var target: Array
	if field == "navigation":
		target = section["navigation"]["nodes"]
	else:
		target = section[field]
	var position := _point(item.position)
	var size: Vector3 = item.scale.abs() * item.base_size
	var entry: Dictionary
	var suffix := ""
	match field:
		"props":
			entry = {"id": item.object_id, "asset": item.asset if not item.asset.is_empty() else "wooden-crate", "position": position, "size": _point(size), "yaw": item.rotation.y, "solid": false, "background": false}
			suffix = "/position"
		"greybox":
			entry = {"center": position, "size": _point(size), "material": item.material, "collides": false}
		"collisionBoxes":
			entry = {"min": _point(item.position - size / 2.0), "max": _point(item.position + size / 2.0)}
		"zombieSpawns":
			entry = position
			if not item.barrier_id.is_empty():
				entry["barrierId"] = item.barrier_id
		"barriers":
			entry = {"id": item.object_id, "position": position, "outward": {"x": 0.0, "y": 0.0, "z": -1.0}, "width": 1.5, "maxBoards": item.max_boards, "approachPath": [_point(item.position + Vector3(0, 0, -3)), _point(item.position + Vector3(0, 0, -1))], "insidePoint": _point(item.position + Vector3(0, 0, 1))}
			suffix = "/position"
		"doors":
			entry = {"id": item.object_id, "position": position, "cost": max(0, item.cost), "blocker": {"min": _point(item.position + Vector3(-0.5, 0.0, -0.15)), "max": _point(item.position + Vector3(0.5, 2.4, 0.15))}}
			suffix = "/position"
		"wallWeapons":
			entry = {"id": item.object_id, "position": position, "weaponId": item.weapon_id if not item.weapon_id.is_empty() else "kar98k", "weaponCost": item.weapon_cost, "ammoCost": item.ammo_cost}
			suffix = "/position"
		"hazards":
			entry = {"id": item.object_id, "kind": "barrel", "position": position, "yaw": 0.0}
			suffix = "/position"
		"navigation":
			entry = {"id": item.object_id, "position": position, "neighbors": []}
			suffix = "/position"
		_:
			return
	var index := target.size()
	target.append(entry)
	var final_path := "%s/%s/%d%s" % [parts[1], "navigation/nodes" if field == "navigation" else field, index, suffix]
	pending.append({"item": item, "path": final_path, "kind": "box" if field == "greybox" or field == "collisionBoxes" else "prop" if field == "props" else "gameplay"})

func _walk_items(document: Dictionary, node: Node, pending: Array = []) -> void:
	if node is ZombonzMapItem:
		if node.kind == "new":
			_append_new(document, node, pending)
		else:
			_apply_item(document, node)
	for child in node.get_children():
		_walk_items(document, child, pending)

func _open_document() -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	if not root is ZombonzMapRoot:
		message.text = "Open a Zombonz map scene first."
		return {}
	return _read_document(_source_path(root.source_file))

func _validate_open_map() -> void:
	var document := _open_document()
	if document.is_empty():
		return
	_walk_items(document, EditorInterface.get_edited_scene_root())
	var errors := _validate(document)
	message.text = "Map valid." if errors.is_empty() else "Validation failed:\n" + "\n".join(errors.slice(0, 8))

func _collect_changes(before: Variant, after: Variant, path: Array, changes: Array) -> void:
	if typeof(before) == TYPE_DICTIONARY and typeof(after) == TYPE_DICTIONARY:
		for key in after.keys():
			var child_path := path.duplicate()
			child_path.append(key)
			if before.has(key):
				_collect_changes(before[key], after[key], child_path, changes)
			else:
				changes.append({"path": child_path, "value": after[key]})
	elif typeof(before) == TYPE_ARRAY and typeof(after) == TYPE_ARRAY and after.size() >= before.size():
		for i in range(after.size()):
			var child_path := path.duplicate()
			child_path.append(i)
			if i < before.size():
				_collect_changes(before[i], after[i], child_path, changes)
			else:
				changes.append({"path": child_path, "value": after[i]})
	elif before != after:
		changes.append({"path": path, "value": after})

func _export_map() -> bool:
	var document := _open_document()
	if document.is_empty():
		return false
	var original := document.duplicate(true)
	var root := EditorInterface.get_edited_scene_root()
	var pending: Array = []
	_walk_items(document, root, pending)
	var errors := _validate(document)
	if not errors.is_empty():
		message.text = "Export stopped:\n" + "\n".join(errors.slice(0, 8))
		return false
	var changes: Array = []
	_collect_changes(original, document, [], changes)
	if not changes.is_empty():
		var edits_path := OS.get_user_data_dir().path_join("zombonz-map-edits.json")
		var edits_file := FileAccess.open(edits_path, FileAccess.WRITE)
		if edits_file == null:
			message.text = "Could not write temporary map edits"
			return false
		edits_file.store_string(JSON.stringify(changes))
		edits_file.close()
		var repository := _source_path("../..")
		var script_path := repository.path_join("scripts/apply-map-edits.mjs")
		var output: Array = []
		var result := OS.execute("node", [script_path, _source_path(root.source_file), edits_path], output, true)
		if result != 0:
			message.text = "Export failed. Node.js is required. " + "\n".join(output)
			return false
	for addition in pending:
		addition["item"].data_path = addition["path"]
		addition["item"].kind = addition["kind"]
	EditorInterface.save_scene()
	message.text = "Exported %d change(s) to %s" % [changes.size(), _source_path(root.source_file)]
	return true

func _export_and_play() -> void:
	if not _export_map():
		return
	var repository := _source_path("../..")
	var vite := repository.path_join("node_modules/vite/bin/vite.js")
	var process_id := OS.create_process("node", [vite, repository, "--host", "127.0.0.1", "--strictPort"])
	if process_id < 0:
		message.text = "Could not start Vite. Run npm run dev in the repository, then open the preview URL."
		return
	await get_tree().create_timer(2.0).timeout
	OS.shell_open("http://127.0.0.1:5173/?preview=start&map=" + str(_open_document()["metadata"]["id"]))

func _validate(document: Dictionary) -> Array[String]:
	var errors: Array[String] = []
	if document.get("version") != 1:
		errors.append("version must be 1")
	for section in ["metadata", "gameplay", "presentation"]:
		if not document.has(section) or typeof(document[section]) != TYPE_DICTIONARY:
			errors.append("Missing " + section)
	if not errors.is_empty():
		return errors
	var gameplay: Dictionary = document["gameplay"]
	if not _has_xyz(gameplay.get("playerSpawn", null)):
		errors.append("gameplay.playerSpawn needs x, y, z")
	var barrier_ids := {}
	for barrier in gameplay.get("barriers", []):
		if barrier_ids.has(barrier.get("id", "")):
			errors.append("Duplicate barrier ID: " + str(barrier.get("id", "")))
		barrier_ids[barrier.get("id", "")] = true
		if not _has_xyz(barrier.get("position", null)) or not _has_xyz(barrier.get("insidePoint", null)):
			errors.append("Barrier needs position and insidePoint: " + str(barrier.get("id", "")))
	for i in range(gameplay.get("zombieSpawns", []).size()):
		var spawn: Dictionary = gameplay["zombieSpawns"][i]
		if not _has_xyz(spawn):
			errors.append("Invalid zombie spawn " + str(i))
		if spawn.has("barrierId") and not barrier_ids.has(spawn["barrierId"]):
			errors.append("Unknown barrier at zombie spawn " + str(i))
	var node_ids := {}
	for node in gameplay.get("navigation", {}).get("nodes", []):
		if node_ids.has(node.get("id", "")):
			errors.append("Duplicate navigation ID: " + str(node.get("id", "")))
		node_ids[node.get("id", "")] = true
	for node in gameplay.get("navigation", {}).get("nodes", []):
		for neighbor in node.get("neighbors", []):
			if not node_ids.has(neighbor):
				errors.append("Unknown navigation neighbor: " + str(neighbor))
	for door in gameplay.get("doors", []):
		if float(door.get("cost", -1)) < 0:
			errors.append("Negative door cost: " + str(door.get("id", "")))
	return errors
