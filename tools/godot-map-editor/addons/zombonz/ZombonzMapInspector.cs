using Godot;

[Tool]
public partial class ZombonzMapInspector : EditorInspectorPlugin
{
    public override bool _CanHandle(GodotObject @object) => @object is ZombonzMapItem;

    public override void _ParseBegin(GodotObject @object)
    {
        if (@object is not ZombonzMapItem item) return;
        var hint = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        hint.Text = item.GameplayType switch
        {
            "doors" => "Move/rotate the door; its Blocker child follows. Edit appearance, width, cost, and power requirement below. Refresh after changing fields.",
            "barriers" => "Move/rotate the barrier; inside and approach points follow. Edit child points with Entry routes enabled. Width, outward direction, and board count are exported.",
            "hazards" => "Move/rotate this hazard. Choose barrel, jeep, or truck below; refresh to update its model. The game uses a fixed size for each type.",
            "wallWeapons" => "Move/rotate the wall purchase. Weapon and ammo costs are exported. Purchased wall guns is an editor preview toggle; the game starts with chalk only.",
            "perkMachines" => "Move/rotate this machine's purchase point. Select its perk below and refresh to change the paint.",
            "mysteryBoxes" => "Move/rotate the purchase point; the box and its initial location follow. Other relocation locations stay in the source map.",
            "packAPunch" => "Move the machine and set its cost. Rotate only in 90-degree steps (the game requires axis alignment).",
            "traps" => "Move the switch; its Trap zone child follows. Enable Collision boxes to edit the zone, then refresh its preview.",
            "routePoint" => "Move this route/inside point. Its position is exported in map coordinates.",
            "playerSpawn" or "zombieSpawns" => "The footprint is the spawn's floor position. Zombie Barrier ID links a spawn to an entry barrier.",
            _ => item.Kind switch
        {
            "new" => "New map object. Set a unique ID and relevant fields, then export.",
            "box" => "Move or scale this box in the 3D view. The source path is " + item.DataPath,
            "prop" => "Move, rotate, or scale this prop. Asset and ID are exported.",
            _ => "Move this marker in the 3D view. Related fields below are exported where applicable."
        }};
        AddCustomControl(hint);
    }

    public override bool _ParseProperty(GodotObject @object, Variant.Type type, string name, PropertyHint hint,
        string hintString, PropertyUsageFlags usageFlags, bool wide)
    {
        if (@object is not ZombonzMapItem item) return false;
        var game = item.GameplayType;
        // Hide internal bookkeeping and unrelated fields without dropping them from saved scenes.
        return name switch
        {
            nameof(ZombonzMapItem.DataPath) or nameof(ZombonzMapItem.Kind) or nameof(ZombonzMapItem.GameplayType)
                or nameof(ZombonzMapItem.InitialYaw) or nameof(ZombonzMapItem.PreviewOffset) or nameof(ZombonzMapItem.BaseHeight) => true,
            nameof(ZombonzMapItem.BaseSize) => item.Kind != "box" && item.Kind != "prop" && !item.DataPath.Contains("presentation/"),
            nameof(ZombonzMapItem.ObjectId) => item.Kind == "box" || (game == "routePoint" && !item.DataPath.Contains("navigation"))
                || game is "playerSpawn" or "zombieSpawns" or "powerSwitch",
            nameof(ZombonzMapItem.Cost) => game is not ("doors" or "traps" or "equipment" or "packAPunch" or "mysteryBoxes"),
            nameof(ZombonzMapItem.WeaponId) or nameof(ZombonzMapItem.WeaponCost) or nameof(ZombonzMapItem.AmmoCost) => game != "wallWeapons",
            nameof(ZombonzMapItem.MaxBoards) or nameof(ZombonzMapItem.Outward) => game != "barriers",
            nameof(ZombonzMapItem.Width) => game is not ("barriers" or "doors"),
            nameof(ZombonzMapItem.RequiresPower) => game is not ("doors" or "traps"),
            nameof(ZombonzMapItem.DoorAppearance) or nameof(ZombonzMapItem.DoorLabel) => game != "doors",
            nameof(ZombonzMapItem.HazardKind) => game != "hazards",
            nameof(ZombonzMapItem.PerkId) => game != "perkMachines",
            nameof(ZombonzMapItem.BarrierId) => game != "zombieSpawns",
            nameof(ZombonzMapItem.Asset) => item.Kind != "prop" && !item.DataPath.Contains("presentation/props"),
            nameof(ZombonzMapItem.Material) => !item.DataPath.Contains("presentation/greybox") && !item.DataPath.Contains("presentation/scenery"),
            _ => false
        };
    }
}
