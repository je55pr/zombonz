using System.Text.Json.Nodes;
using Godot;
using static MapDocument;

/// <summary>Static game-object appearance and clearly labeled authoring guides.</summary>
public static class GameplayPreview
{
    public static Node3D Build(MapPreviewAssets assets, ZombonzMapRoot root, ZombonzMapItem item, JsonObject document)
    {
        var art = new Node3D { Name = "Art" };
        try
        {
            switch (item.GameplayType)
            {
                case "hazards":
                    var (asset, size) = Hazard(item.HazardKind);
                    var model = assets.Prop(asset, size); model.Scale /= item.Scale;
                    art.AddChild(model);
                    Caption(art, item.HazardKind.ToUpperInvariant() + " · " + item.ObjectId, new Vector3(0, size.Y + 0.25f, 0));
                    break;
                case "doors": Door(assets, art, item); break;
                case "barriers": Barrier(assets, art, item); break;
                case "wallWeapons": WallGun(assets, art, root, item); break;
                case "playerSpawn": case "zombieSpawns":
                    var color = item.GameplayType == "playerSpawn" ? Colors.LightGreen : Colors.OrangeRed;
                    Part(art, new CapsuleMesh { Radius = 0.28f, Height = 1.72f }, new Vector3(0, 0.86f, 0), Guide(color, 0.22f), "SpawnBody");
                    Part(art, new CylinderMesh { TopRadius = 0.4f, BottomRadius = 0.4f, Height = 0.025f }, new Vector3(0, 0.015f, 0), Guide(color), "SpawnFootprint");
                    Caption(art, item.GameplayType == "playerSpawn" ? "PLAYER SPAWN" : "ZOMBIE SPAWN\n" + item.BarrierId, new Vector3(0, 1.95f, 0));
                    break;
                case "routePoint":
                    Part(art, new SphereMesh { Radius = 0.09f, Height = 0.18f }, Vector3.Zero, Guide(Colors.Magenta), "Waypoint");
                    Caption(art, item.Name, new Vector3(0, 0.2f, 0));
                    break;
                case "perkMachines":
                    var vending = assets.PerkModel(item.PerkId, Paint);
                    art.Position = new Vector3(0, -1, -1); art.AddChild(vending);
                    Caption(art, item.PerkId.ToUpperInvariant(), new Vector3(0, 2.5f, 0));
                    break;
                case "mysteryBoxes":
                    art.Position = item.PreviewOffset;
                    if (!item.GetChildren().OfType<ZombonzMapItem>().Any(child => child.DataPath.StartsWith("presentation/greybox/")))
                        Box(assets, art, "splintered-wood", new Vector3(0, 0.52f, 0), new Vector3(0.95f, 1.04f, 2.35f));
                    Box(assets, art, "splintered-wood", new Vector3(0, 1.06f, 0), new Vector3(1.06f, 0.13f, 2.4f));
                    foreach (var z in new[] { -0.8f, 0.8f }) Box(assets, art, "rusted-metal", new Vector3(0, 0.55f, z), new Vector3(1.01f, 1.12f, 0.12f));
                    Caption(art, "?   ?   ?", new Vector3(0, 1.5f, 0));
                    break;
                case "packAPunch": PackAPunch(assets, art); break;
                case "powerSwitch":
                    Box(assets, art, "rusted-metal", new Vector3(0, 0.15f, -0.03f), new Vector3(0.6f, 0.7f, 0.1f));
                    Box(assets, art, "rusted-metal", new Vector3(0.18f, 0.18f, 0), new Vector3(0.07f, 0.36f, 0.07f));
                    Box(assets, art, "splintered-wood", new Vector3(0.18f, 0.38f, 0), Vector3.One * 0.1f);
                    Part(art, new SphereMesh { Radius = 0.05f, Height = 0.1f }, new Vector3(-0.2f, 0.35f, 0), Guide(new Color(0.25f, 0.04f, 0.04f)), "PowerLamp");
                    Caption(art, "POWER SWITCH", new Vector3(0, 0.75f, 0));
                    break;
                case "equipment":
                    art.Position = new Vector3(0, 0.4f, 0);
                    Box(assets, art, "splintered-wood", new Vector3(0, -0.2f, 0.16f), new Vector3(0.9f, 0.05f, 0.3f));
                    foreach (var x in new[] { -0.2f, 0.2f }) Part(art, new CylinderMesh { TopRadius = 0.14f, BottomRadius = 0.16f, Height = 0.09f }, new Vector3(x, -0.1f, 0.16f), assets.Material("rusted-metal"), "Mine" + x);
                    Caption(art, "BOUNCING BETTIES", new Vector3(0, 0.3f, 0));
                    break;
                case "traps":
                    Box(assets, art, "rusted-metal", Vector3.Zero, new Vector3(0.4f, 0.55f, 0.12f));
                    Caption(art, "ELECTRIC TRAP", new Vector3(0, 0.5f, 0));
                    var zone = item.GetChildren().OfType<ZombonzMapItem>().FirstOrDefault(child => child.DataPath.EndsWith("/zone"));
                    if (zone is not null)
                    {
                        var zoneView = new Node3D { Name = "TrapStrip", Transform = zone.Transform };
                        art.AddChild(zoneView);
                        var floor = -zone.BaseSize.Y / 2 + 0.5f;
                        var alongX = zone.BaseSize.X >= zone.BaseSize.Z;
                        var halfSpan = (alongX ? zone.BaseSize.X : zone.BaseSize.Z) / 2 - 0.15f;
                        foreach (var side in new[] { -1, 1 })
                        {
                            var end = alongX ? new Vector3(side * halfSpan, floor, 0) : new Vector3(0, floor, side * halfSpan);
                            Box(assets, zoneView, "rusted-metal", end + Vector3.Up * 1.1f, new Vector3(0.14f, 2.2f, 0.14f));
                            foreach (var h in new[] { 0.5f, 1.1f, 1.7f }) Box(assets, zoneView, "rusted-metal", end + Vector3.Up * h, new Vector3(0.26f, 0.1f, 0.26f));
                        }
                        Box(assets, zoneView, "rusted-metal", new Vector3(0, floor + 0.01f, 0),
                            alongX ? new Vector3(halfSpan * 2, 0.02f, 0.5f) : new Vector3(0.5f, 0.02f, halfSpan * 2));
                    }
                    break;
            }
            return art;
        }
        catch { art.Free(); throw; }
    }

    public static (string Asset, Vector3 Size) Hazard(string kind) => kind switch
    {
        "barrel" => ("explosive-barrel", new Vector3(0.58f, 0.9f, 0.58f)),
        "jeep" => ("vehicles/gaz-67", new Vector3(1.68f, 1.56f, 3.35f)),
        "truck" => ("vehicles/soviet-offroad", new Vector3(2.01f, 2, 4.2f)),
        _ => throw new InvalidDataException("Unknown hazard kind: " + kind)
    };

    private static void Door(MapPreviewAssets assets, Node3D art, ZombonzMapItem item)
    {
        var width = item.Width;
        if (item.DoorAppearance == "planks")
        {
            var count = Math.Max(2, (int)Math.Round(width / 0.4f));
            for (var i = 0; i < count; i++) Box(assets, art, "splintered-wood", new Vector3(0, 1.4f, -width / 2 + (i + 0.5f) * width / count), new Vector3(0.24f, 2.8f, width / count - 0.02f));
            foreach (var y in new[] { 0.65f, 2.05f }) Box(assets, art, "rusted-metal", new Vector3(-0.14f, y, 0), new Vector3(0.06f, 0.12f, width - 0.1f));
            if (item.DoorLabel.Length > 0) art.AddChild(new Label3D { Name = "PaintedLabel", Text = item.DoorLabel,
                Position = new Vector3(0.17f, 1.5f, 0), Rotation = new Vector3(0, Mathf.Pi / 2, 0), FontSize = 90, PixelSize = 0.006f,
                Modulate = Colors.Beige, OutlineSize = 0 });
        }
        else
        {
            Box(assets, art, "sofa-upholstery", new Vector3(0, 0.35f, 0), new Vector3(width, 0.55f, 0.75f));
            Box(assets, art, "sofa-upholstery", new Vector3(0, 0.85f, 0.3f), new Vector3(width, 0.7f, 0.25f));
            foreach (var side in new[] { -1, 1 }) Box(assets, art, "sofa-upholstery", new Vector3(side * (width / 2 - 0.12f), 0.8f, 0), new Vector3(0.24f, 0.65f, 0.75f));
            Box(assets, art, "splintered-wood", new Vector3(0.2f, 1.4f, 0), new Vector3(0.8f, 0.7f, 0.7f)).Rotation = new Vector3(0, 0.23f, 0);
        }
        Caption(art, (item.DoorLabel.Length > 0 ? item.DoorLabel : item.DoorAppearance == "debris" ? "CLEAR DEBRIS" : "DOOR") + "\n" + (item.RequiresPower ? "POWER REQUIRED" : item.Cost + " POINTS"), new Vector3(0, 3.1f, 0));
    }

    private static void Barrier(MapPreviewAssets assets, Node3D art, ZombonzMapItem item)
    {
        var frame = new Node3D { Name = "WindowFrame", Rotation = new Vector3(0, Math.Abs(item.Outward.X) > 0.5f ? Mathf.Pi / 2 : 0, 0) };
        art.AddChild(frame);
        if (item.MaxBoards > 0)
        {
            Box(assets, frame, "weathered-concrete-a", new Vector3(0, 0.83f, 0), new Vector3(item.Width + 0.25f, 0.15f, 0.65f));
            foreach (var side in new[] { -1, 1 }) Box(assets, frame, "rusted-metal", new Vector3(side * item.Width / 2, 1.75f, 0), new Vector3(0.09f, 1.8f, 0.25f));
            uint seed = 0x811c9dc5;
            foreach (var c in item.ObjectId) seed = unchecked((seed ^ c) * 0x01000193);
            double Wobble(int slot, int purpose)
            {
                var h = seed ^ unchecked((uint)(slot + 1) * 0x9e3779b9) ^ unchecked((uint)(purpose + 1) * 0x85ebca6b);
                h = unchecked((h ^ (h >> 16)) * 0x7feb352d); h = unchecked((h ^ (h >> 15)) * 0x846ca68b); h ^= h >> 16;
                return h / 4294967296.0 - 0.5;
            }
            var tilts = new[] { 0.05, -0.07, 0.06, -0.04, 0.07, -0.03 };
            for (var i = 0; i < item.MaxBoards; i++)
            {
                var low = item.MaxBoards / 2;
                var y = item.MaxBoards > 6 ? 1 + i * 1.4f / (item.MaxBoards - 1) : i < low ? 1.37f - (low - 1 - i) * 0.19f : 1.87f + (i - low) * 0.19f;
                var reach = item.Width / 2 + 0.07;
                var limit = Math.Asin(Math.Min(1, 0.08 / reach));
                var tilt = Math.Clamp(tilts[(i + (int)Math.Floor((Wobble(0, 3) + 0.5) * tilts.Length)) % tilts.Length]
                    * (Wobble(i, 4) > 0 ? 1 : -1) + Wobble(i, 2) * 0.04, -limit, limit);
                y = (float)Math.Max(0.905 + 0.085 + reach * Math.Abs(Math.Sin(tilt)), y + Wobble(i, 0) * 0.03);
                var plank = Box(assets, frame, "old-planks", new Vector3((float)(Wobble(i, 1) * 0.06), y, 0.03f + i % 2 * 0.014f), new Vector3(item.Width + 0.14f, 0.17f, 0.025f));
                plank.Name = "Board" + i; plank.Rotation = new Vector3(0, 0, (float)tilt);
                var geometry = (ArrayMesh)plank.Mesh;
                var arrays = geometry.SurfaceGetArrays(0); var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                for (var vertex = 0; vertex < uv.Length; vertex++) uv[vertex] = new Vector2(uv[vertex].Y, uv[vertex].X);
                arrays[(int)Mesh.ArrayType.TexUV] = uv;
                var turned = new ArrayMesh(); turned.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays); plank.Mesh = turned;
            }
        }
        Caption(art, (item.MaxBoards == 0 ? "OPEN ENTRY · " : "BARRIER · ") + item.ObjectId, new Vector3(0, 2.8f, 0));
    }

    private static void WallGun(MapPreviewAssets assets, Node3D art, ZombonzMapRoot root, ZombonzMapItem item)
    {
        var asset = item.WeaponId == "starter-pistol" ? "m1911" : item.WeaponId;
        var display = assets.Variant(asset, "weapons", "wall-v2-" + asset, () => MountedGun(assets, asset)).Instantiate<Node3D>();
        display.Name = "WallDisplay"; art.AddChild(display);
        art.Position = new Vector3(0, 0.4f, 0);
        display.GetNode<Node3D>("PurchasedGun").Visible = root.ShowPurchasedWallGuns;
        Caption(art, item.WeaponId.ToUpperInvariant() + "\n" + item.WeaponCost + " / AMMO " + item.AmmoCost, new Vector3(0, -0.55f, 0.03f), false);
    }

    private static Node3D MountedGun(MapPreviewAssets assets, string asset)
    {
        var art = new Node3D { Name = "WallDisplay" };
        var model = assets.Model(asset, category: "weapons").Instantiate<Node3D>();
        MakeEditable(model);
        model.Rotation = new Vector3(0, asset == "bar" ? Mathf.Pi / 2 : Mathf.Pi, 0);
        foreach (var mesh in Meshes(model).ToArray())
        {
            if (asset == "kar98k" && mesh.Name.ToString().Contains("Scope") || asset == "bar" && mesh.Name.ToString().StartsWith("Handle"))
            { mesh.GetParent().RemoveChild(mesh); mesh.Free(); }
            else if (mesh.Name.ToString().Contains("Magazine", StringComparison.OrdinalIgnoreCase) && asset is "bar" or "m1911")
            {
                var parentBasis = Basis.Identity;
                for (var parent = mesh.GetParent(); parent is not null && parent != model; parent = parent.GetParent())
                    if (parent is Node3D spatial) parentBasis = spatial.Basis * parentBasis;
                mesh.Position += parentBasis.Inverse() * (asset == "bar" ? new Vector3(0, 0, 0.29047f) : new Vector3(-0.250698f, 0, 0));
            }
        }
        var bounds = MapPreviewAssets.Bounds(model);
        var length = WeaponLength(asset); var fit = length / bounds.Size.Z;
        var centered = new Node3D { Position = -bounds.GetCenter() }; centered.AddChild(model);
        var normalized = new Node3D { Scale = Vector3.One * fit }; normalized.AddChild(centered);
        var size = bounds.Size * fit;
        void Mount(string name, Vector3 scale, float depth, Material? material)
        {
            var copy = (Node3D)normalized.Duplicate();
            var mount = new Node3D { Name = name, Rotation = new Vector3(0, -Mathf.Pi / 2, 0), Scale = scale, Position = new Vector3(0, 0, depth) };
            mount.AddChild(copy); art.AddChild(mount);
            if (material is not null) foreach (var mesh in Meshes(copy)) mesh.MaterialOverride = material;
        }
        try
        {
            Mount("ChalkOutline", new Vector3(0.002f, (size.Y * 1.15f + 0.08f) / size.Y, (size.Z * 1.15f + 0.08f) / size.Z), 0.004f, Guide(new Color(0.79f, 0.78f, 0.65f)));
            Mount("ChalkInset", new Vector3(0.002f, (size.Y * 1.15f - 0.015f) / size.Y, (size.Z * 1.15f - 0.015f) / size.Z), 0.009f, Guide(new Color(0.14f, 0.14f, 0.12f)));
            Mount("PurchasedGun", Vector3.One * 1.15f, 0.04f + size.X * 1.15f / 2, null);
            art.GetNode<Node3D>("PurchasedGun").Visible = false;
            return art;
        }
        finally { normalized.Free(); }
    }

    private static float WeaponLength(string asset) => asset switch
    {
        "kar98k" or "springfield" or "m1-garand" or "rpg7" => 0.95f, "bar" or "mg42" => 1.05f,
        "thompson" => 0.74f, "double-barrel" => 0.98f, "trench-gun" or "ithaca37" => 0.86f,
        "m1-carbine" => 0.78f, "m14" => 0.96f, "mp5k" => 0.45f, "ak74u" => 0.63f,
        "mp40" => 0.72f, "stg44" => 0.81f, "m1911" => 0.36f, "mosin" => 1.1f,
        "ppsh41" => 0.73f, "fg42" => 0.84f, "fal" => 0.94f, "rpk" => 0.92f, "commando" => 0.66f,
        "spas12" => 0.9f, "skorpion" => 0.52f, "magnum-357" or "irrlicht" => 0.42f,
        "python" or "molniya" => 0.4f, _ => 1.05f
    };

    private static void PackAPunch(MapPreviewAssets assets, Node3D art)
    {
        Box(assets, art, "rusted-metal", new Vector3(0, 0.06f, 0), new Vector3(1.7f, 0.12f, 1.1f));
        Box(assets, art, "rusted-metal", new Vector3(0, 0.87f, -0.04f), new Vector3(1.5f, 1.5f, 0.86f));
        Box(assets, art, "rusted-metal", new Vector3(0, 1.65f, -0.04f), new Vector3(1.58f, 0.06f, 0.94f));
        Box(assets, art, "rusted-metal", new Vector3(0, 1.95f, -0.04f), new Vector3(1.44f, 0.54f, 0.8f));
        Box(assets, art, "rusted-metal", new Vector3(0, 2.27f, -0.04f), new Vector3(1.56f, 0.06f, 0.96f));
        Part(art, new BoxMesh { Size = new Vector3(0.78f, 0.09f, 0.03f) }, new Vector3(0, 1.08f, 0.44f), Guide(Colors.LightSkyBlue), "Intake");
        Box(assets, art, "rusted-metal", new Vector3(0, 0.9f, 0.56f), new Vector3(0.96f, 0.03f, 0.34f));
        Caption(art, "PACK-A-PUNCH", new Vector3(0, 2.02f, 0.46f), false);
        Part(art, new CylinderMesh { TopRadius = 0.09f, BottomRadius = 0.09f, Height = 0.42f }, new Vector3(0.5f, 2.51f, -0.1f), assets.Material("rusted-metal"), "Exhaust");
        foreach (var side in new[] { -1, 1 })
            Part(art, new CylinderMesh { TopRadius = 0.05f, BottomRadius = 0.05f, Height = 1.9f }, new Vector3(side * 0.78f, 1.07f, -0.3f), assets.Material("rusted-metal"), "Pipe" + side);
        foreach (var y in new[] { 1.46f, 1.16f })
        {
            var dial = Part(art, new CylinderMesh { TopRadius = 0.11f, BottomRadius = 0.11f, Height = 0.04f }, new Vector3(-0.635f, y, 0.44f), Guide(Colors.LightSkyBlue), "Dial" + y);
            dial.Rotation = new Vector3(Mathf.Pi / 2, 0, 0);
        }
        foreach (var index in new[] { 0, 1, 2 }) Part(art, new SphereMesh { Radius = 0.045f, Height = 0.09f }, new Vector3(0.635f, 1.48f - index * 0.16f, 0.45f),
            Guide(index == 0 ? Colors.DarkRed : index == 1 ? Colors.DarkGoldenrod : Colors.DarkGreen), "Lamp" + index);
    }

    private static MeshInstance3D Box(MapPreviewAssets assets, Node3D parent, string look, Vector3 position, Vector3 size)
        => Part(parent, MapPreviewAssets.ProjectUvs(new BoxMesh { Size = size }, position, MapPreviewAssets.LookScale(look)), position, assets.Material(look), "Part" + parent.GetChildCount());

    private static MeshInstance3D Part(Node3D parent, Mesh mesh, Vector3 position, Material material, string name)
    {
        var view = new MeshInstance3D { Name = name.ValidateNodeName(), Mesh = mesh, Position = position, MaterialOverride = material };
        parent.AddChild(view); return view;
    }

    private static StandardMaterial3D Guide(Color color, float alpha = 1) => new()
    { AlbedoColor = new Color(color.R, color.G, color.B, alpha), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        Transparency = alpha < 1 ? BaseMaterial3D.TransparencyEnum.Alpha : BaseMaterial3D.TransparencyEnum.Disabled,
        CullMode = BaseMaterial3D.CullModeEnum.Disabled };

    private static void Caption(Node3D parent, string text, Vector3 position, bool billboard = true)
        => parent.AddChild(new Label3D { Name = "EditorLabel", Text = text, Position = position, FontSize = 32, PixelSize = 0.004f,
            Billboard = billboard ? BaseMaterial3D.BillboardModeEnum.Enabled : BaseMaterial3D.BillboardModeEnum.Disabled,
            Modulate = Colors.Beige, OutlineSize = 5 });

    private static IEnumerable<MeshInstance3D> Meshes(Node node)
    {
        if (node is MeshInstance3D mesh) yield return mesh;
        foreach (var child in node.GetChildren()) foreach (var meshChild in Meshes(child)) yield return meshChild;
    }

    // Modified mesh materials and hidden parts must be saved, rather than reset from the cached scene.
    private static void MakeEditable(Node node)
    {
        node.SceneFilePath = "";
        foreach (var child in node.GetChildren()) MakeEditable(child);
    }

    private static void Paint(Node node, Texture2D paint)
    {
        // Keep the prepared GLB self-contained, including its alternative paint texture.
        var embedded = (Texture2D)paint.Duplicate(); embedded.ResourcePath = "";
        foreach (var mesh in Meshes(node))
            for (var i = 0; i < mesh.Mesh.GetSurfaceCount(); i++)
                if (mesh.GetActiveMaterial(i) is BaseMaterial3D material && material.Transparency == BaseMaterial3D.TransparencyEnum.Disabled)
                { var own = (BaseMaterial3D)material.Duplicate(); own.AlbedoTexture = embedded; mesh.SetSurfaceOverrideMaterial(i, own); }
    }
}
