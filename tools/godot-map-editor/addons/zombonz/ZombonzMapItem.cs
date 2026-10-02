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

    [ExportGroup("Game object")]
    [Export] public string GameplayType { get; set; } = "";
    [Export(PropertyHint.Enum, "barrel,jeep,truck")] public string HazardKind { get; set; } = "barrel";
    [Export(PropertyHint.Enum, "juggernog,double-tap,speed-cola,quick-revive")] public string PerkId { get; set; } = "juggernog";
    [Export(PropertyHint.Range, "0.1,20,0.05,or_greater")] public float Width { get; set; } = 1.5f;
    [Export] public Vector3 Outward { get; set; } = Vector3.Forward;
    [Export(PropertyHint.Enum, "planks,debris")] public string DoorAppearance { get; set; } = "planks";
    [Export] public string DoorLabel { get; set; } = "";
    [Export] public float InitialYaw { get; set; }
    [Export] public Vector3 PreviewOffset { get; set; }

    [ExportGroup("Lighting")]
    [Export] public Color LightColor { get; set; } = new(1f, 195f / 255f, 139f / 255f);
    [Export(PropertyHint.Range, "0,100,0.1,or_greater")] public float LightIntensity { get; set; } = 11f;
    [Export(PropertyHint.Range, "0,50,0.1,or_greater")] public float LightRange { get; set; } = 10f;
    [Export(PropertyHint.Range, "0,4,0.1,or_greater")] public float LightDecay { get; set; } = 1.6f;
    [Export] public float LightPriority { get; set; }
    [Export(PropertyHint.Enum, "fluorescent,none")] public string LightFlicker { get; set; } = "fluorescent";
    [Export(PropertyHint.Enum, "always,dim-until-power,power-only")] public string LightPower { get; set; } = "always";
    [Export(PropertyHint.Range, "0,1,0.05")] public float LightUnpoweredLevel { get; set; } = 0.4f;
}
