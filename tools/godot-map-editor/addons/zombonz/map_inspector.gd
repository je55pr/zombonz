@tool
extends EditorInspectorPlugin

func _can_handle(object: Object) -> bool:
	return object is ZombonzMapItem

func _parse_begin(object: Object) -> void:
	var item := object as ZombonzMapItem
	var hint := Label.new()
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if item.kind == "new":
		hint.text = "New map object. Set a unique ID and relevant fields, then export."
	elif item.kind == "box":
		hint.text = "Move or scale this box in the 3D view. The source path is " + item.data_path
	elif item.kind == "prop":
		hint.text = "Move, rotate, or scale this prop. Asset and ID are exported."
	else:
		hint.text = "Move this marker in the 3D view. Related fields below are exported where applicable."
	add_custom_control(hint)
