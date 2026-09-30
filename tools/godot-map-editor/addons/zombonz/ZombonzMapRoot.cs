using Godot;

[Tool, GlobalClass]
public partial class ZombonzMapRoot : Node3D
{
    /// <summary>The JSON source relative to this Godot project.</summary>
    [Export] public string SourceFile { get; set; } = "../../src/maps/data/bunker.v1.json";
    [ExportGroup("Editor preview")]
    [Export] public bool ShowLabels { get; set; } = true;
    [Export] public bool ShowSpawns { get; set; } = true;
    [Export] public bool ShowRoutes { get; set; }
    [Export] public bool ShowCollision { get; set; }
    [Export] public bool ShowPurchasedWallGuns { get; set; }

    public override void _Ready() => MapPreview.ApplyVisibility(this);
}
