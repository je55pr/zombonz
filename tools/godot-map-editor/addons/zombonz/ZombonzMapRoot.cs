using Godot;

[Tool, GlobalClass]
public partial class ZombonzMapRoot : Node3D
{
    /// <summary>The JSON source relative to this Godot project.</summary>
    [Export] public string SourceFile { get; set; } = "../../src/maps/data/bunker.v1.json";
}
