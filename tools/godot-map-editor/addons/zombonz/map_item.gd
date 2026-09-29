@tool
extends Node3D
class_name ZombonzMapItem

## JSON path within the versioned map document; set by the importer.
@export var data_path: String
@export var kind: String
@export var object_id: String
@export var base_size: Vector3 = Vector3.ONE
@export var base_height: float = 0.0

@export_group("Gameplay")
@export var cost: int = -1
@export var weapon_id: String = ""
@export_range(0, 30) var max_boards: int = 0
@export var requires_power: bool = false
@export var asset: String = ""
@export var weapon_cost: int = 200
@export var ammo_cost: int = 100
@export var barrier_id: String = ""
@export var material: String = "wall"
