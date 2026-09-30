using Godot;

[Tool, GlobalClass]
public partial class ZombonzMapItem : Node3D
{
    [Export] public string DataPath { get; set; } = "";
    [Export] public string Kind { get; set; } = "";
    [Export] public string ObjectId { get; set; } = "";
    [Export] public Vector3 BaseSize { get; set; } = Vector3.One;
    [Export] public float BaseHeight { get; set; }

    [ExportGroup("Gameplay")]
    [Export] public int Cost { get; set; } = -1;
    [Export] public string WeaponId { get; set; } = "";
    [Export(PropertyHint.Range, "0,30,1")] public int MaxBoards { get; set; }
    [Export] public bool RequiresPower { get; set; }
    [Export] public string Asset { get; set; } = "";
    [Export] public int WeaponCost { get; set; } = 200;
    [Export] public int AmmoCost { get; set; } = 100;
    [Export] public string BarrierId { get; set; } = "";
    [Export] public string Material { get; set; } = "wall";
}
