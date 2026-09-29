extends SceneTree

## Run with: godot --headless --path tools/godot-map-editor --script res://smoke_test.gd
func _initialize() -> void:
	var plugin = load("res://addons/zombonz/plugin.gd").new()
	plugin.source_input = LineEdit.new()
	plugin.source_input.text = "../../src/maps/data/bunker.v1.json"
	plugin.message = Label.new()
	plugin._import_map()
	var scene := load("res://maps/bunker.tscn") as PackedScene
	if scene == null:
		printerr("Map import failed: " + plugin.message.text)
		quit(1)
		return
	var root := scene.instantiate()
	var document: Dictionary = plugin._read_document(plugin._source_path(root.source_file))
	if not plugin._validate(document).is_empty():
		printerr("Map validation failed")
		quit(1)
		return
	var before: String = JSON.stringify(document)
	plugin._walk_items(document, root)
	var after: String = JSON.stringify(document)
	if after != before:
		var index := 0
		while index < min(before.length(), after.length()) and before[index] == after[index]:
			index += 1
		printerr("Import/export changed an untouched map at character " + str(index))
		printerr("Before: " + before.substr(max(0, index - 60), 120))
		printerr("After:  " + after.substr(max(0, index - 60), 120))
		root.free()
		plugin.free()
		quit(1)
		return
	var gameplay := root.get_node("Gameplay")
	var spawn := gameplay.get_node("Player spawn")
	var original_x: float = document["gameplay"]["playerSpawn"]["x"]
	spawn.position.x += 1.0
	plugin._walk_items(document, root)
	if absf(float(document["gameplay"]["playerSpawn"]["x"]) - original_x - 1.0) > 0.001:
		printerr("Visual edit did not reach map data")
		quit(1)
		return
	var new_item = load("res://addons/zombonz/map_item.gd").new()
	new_item.data_path = "new/presentation/props"
	new_item.kind = "new"
	new_item.object_id = "smoke-crate"
	new_item.asset = "wooden-crate"
	root.add_child(new_item)
	var pending: Array = []
	var prop_count: int = document["presentation"]["props"].size()
	plugin._walk_items(document, root, pending)
	if document["presentation"]["props"].size() != prop_count + 1 or pending.size() != 1:
		printerr("New visual prop did not reach map data")
		quit(1)
		return
	var original: Dictionary = plugin._read_document(plugin._source_path(root.source_file))
	var changes: Array = []
	plugin._collect_changes(original, document, [], changes)
	if not changes.any(func(edit: Dictionary) -> bool: return edit["path"] == ["presentation", "props", prop_count]):
		printerr("Added prop did not produce a focused JSON edit")
		quit(1)
		return
	print("Godot map import, validation, visual edit and new prop roundtrip passed")
	root.free()
	plugin.free()
	quit()
