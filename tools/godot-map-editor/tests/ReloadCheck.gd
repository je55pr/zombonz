@tool
extends Node
## Checks the Zombonz dock still works after the editor reloads the C# code, as it does whenever the project is rebuilt
## with the editor open. A dock button connected to a C# lambda went dead after that, logging "delegate_handle.value is
## null". This is GDScript because it has to outlive the reload it causes. The editor smoke test starts it.

# Buttons that write files or change the open scene are left alone.
const SKIP := ["Import map into scene", "Add selected object", "Export open map", "Export and play in browser"]
const RELOAD_TIMEOUT_MSEC := 60000

var _stamp := ""
var _waiting_since := 0
var _polled := 0


func _ready() -> void:
	if not _press_dock("before the reload"):
		return
	_stamp = _assembly_stamp()
	# The editor reloads the assembly when the file on disk is newer than the one it loaded, so write it back unchanged.
	var path := ProjectSettings.globalize_path("res://.godot/mono/temp/bin/Debug/%s.dll"
		% ProjectSettings.get_setting("dotnet/project/assembly_name"))
	var bytes := FileAccess.get_file_as_bytes(path)
	var file := FileAccess.open(path, FileAccess.WRITE)
	if bytes.is_empty() or file == null:
		_fail("Could not rewrite the C# assembly at " + path)
		return
	file.store_buffer(bytes)
	file.close()
	_waiting_since = Time.get_ticks_msec()


func _process(_delta: float) -> void:
	if _waiting_since == 0 or Time.get_ticks_msec() - _polled < 250:
		return
	_polled = Time.get_ticks_msec()
	if _assembly_stamp() == _stamp:
		if _polled - _waiting_since > RELOAD_TIMEOUT_MSEC:
			_waiting_since = 0
			_fail("The editor did not reload the C# assembly")
		return
	_waiting_since = 0
	if _press_dock("after the reload"):
		print("C# map editor (reload): the dock's buttons and toggles still work after the editor reloads the C# code.")
		get_tree().quit()


## Changes whenever the C# code is loaded again.
func _assembly_stamp() -> String:
	var smoke: Node = load("res://tests/SmokeTest.cs").new()
	var stamp: String = smoke.call("AssemblyStamp")
	smoke.free()
	return stamp


## Presses each dock button that only reads, checking it reports something, and flips each preview toggle and back.
## A dead connection logs an error, which fails the check.
func _press_dock(when: String) -> bool:
	var validate := _find_button(EditorInterface.get_base_control(), "Validate open map")
	if validate == null:
		_fail("The Zombonz dock is missing")
		return false
	var controls := validate.get_parent()
	var message: Label = controls.get_child(controls.get_child_count() - 1)
	for child in controls.get_children():
		var button := child as Button
		if button == null or button is OptionButton:
			continue
		if button is CheckButton:
			button.button_pressed = not button.button_pressed
			button.button_pressed = not button.button_pressed
		elif not button.text in SKIP:
			message.text = ""
			button.pressed.emit()
			if message.text.is_empty():
				_fail("%s did nothing %s" % [button.text, when])
				return false
	return true


func _find_button(node: Node, text: String) -> Button:
	if node is Button and node.text == text:
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found != null:
			return found
	return null


func _fail(message: String) -> void:
	push_error("C# map editor (reload): " + message)
	get_tree().quit(1)
