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

    [ExportGroup("Atmosphere")]
    [Export] public Color FogColor { get; set; } = new(29f / 255f, 43f / 255f, 48f / 255f);
    [Export(PropertyHint.Range, "0,0.2,0.001,or_greater")] public float FogDensity { get; set; } = 0.027f;
    [Export(PropertyHint.Range, "0.1,4,0.05,or_greater")] public float Exposure { get; set; } = 1.35f;
    [Export] public Color AmbientSkyColor { get; set; } = new(170f / 255f, 191f / 255f, 201f / 255f);
    [Export] public Color AmbientGroundColor { get; set; } = new(55f / 255f, 48f / 255f, 38f / 255f);
    [Export(PropertyHint.Range, "0,10,0.05,or_greater")] public float AmbientIntensity { get; set; } = 1.4f;
    [Export] public Color MoonColor { get; set; } = new(180f / 255f, 206f / 255f, 215f / 255f);
    [Export(PropertyHint.Range, "0,10,0.05,or_greater")] public float MoonIntensity { get; set; } = 2.4f;
    [Export(PropertyHint.Range, "0,2,0.05,or_greater")] public float SkyIntensity { get; set; } = 0.5f;
    [Export] public Vector3 MoonOffset { get; set; } = new(-12, 22, -16);

    public override void _Ready() => MapPreview.ApplyVisibility(this);
}
