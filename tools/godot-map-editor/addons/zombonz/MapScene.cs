using System.Text.Json.Nodes;
using Godot;
using static MapDocument;

/// <summary>Builds editable map handles without depending on an open editor window.</summary>
public static class MapScene
{
    public static readonly string[] NewObjectKinds = { "Prop", "Greybox", "Collision box", "Zombie spawn", "Barrier", "Door", "Wall weapon", "Barrel", "Jeep", "Truck", "Navigation node", "Perk machine", "Pack-a-Punch", "Equipment buy", "Light" };

    public static ZombonzMapRoot Build(JsonObject document, string sourceFile, bool previewAssets = true)
    {
        var metadata = (JsonObject)document["metadata"]!;
        var root = new ZombonzMapRoot { Name = Text(metadata["id"]).Capitalize() + "Map", SourceFile = sourceFile };
        var gameplay = (JsonObject)document["gameplay"]!;
        var presentation = (JsonObject)document["presentation"]!;
        ApplyAtmosphere(root, presentation);
        AddMarker(root, "gameplay/playerSpawn", (JsonObject)gameplay["playerSpawn"]!, "Player spawn", Colors.Green);
        AddArray(root, gameplay, "gameplay", "zombieSpawns", "", "Zombie spawn", Colors.Red);
        AddArray(root, gameplay, "gameplay", "doors", "position", "Door", Colors.Orange);
        AddArray(root, gameplay, "gameplay", "wallWeapons", "position", "Wall weapon", Colors.Cyan);
        AddArray(root, gameplay, "gameplay", "mysteryBoxes", "position", "Mystery box", Colors.Purple);
        AddArray(root, gameplay, "gameplay", "perkMachines", "position", "Perk", Colors.Pink);
        AddArray(root, gameplay, "gameplay", "traps", "switchPosition", "Trap", Colors.Yellow);
        AddArray(root, gameplay, "gameplay", "hazards", "position", "Hazard", Colors.Red);
        AddArray(root, gameplay, "gameplay", "equipment", "position", "Equipment", Colors.Cyan);
        AddArray(root, gameplay, "gameplay", "packAPunch", "position", "Pack-a-Punch", Colors.MediumPurple);
        if (gameplay["powerSwitch"] is JsonObject powerSwitch && powerSwitch["position"] is JsonObject switchPoint)
            AddMarker(root, "gameplay/powerSwitch/position", switchPoint, "Power switch", Colors.Yellow, powerSwitch);
        var barriers = Items(gameplay, "barriers");
        for (var i = 0; i < barriers.Count; i++)
        {
            var barrier = (JsonObject)barriers[i]!;
            var path = $"gameplay/barriers/{i}";
            var id = Text(barrier["id"]);
            AddMarker(root, path + "/position", (JsonObject)barrier["position"]!, "Barrier " + id, Colors.Orange, barrier);
            AddMarker(root, path + "/insidePoint", (JsonObject)barrier["insidePoint"]!, "Inside " + id, Colors.Green);
            var route = Items(barrier, "approachPath");
            for (var j = 0; j < route.Count; j++) AddMarker(root, $"{path}/approachPath/{j}", (JsonObject)route[j]!, $"Route {id} {j}", Colors.Magenta);
        }
        var nodes = gameplay["navigation"]?["nodes"] as JsonArray ?? new JsonArray();
        for (var i = 0; i < nodes.Count; i++)
            AddMarker(root, $"gameplay/navigation/nodes/{i}/position", (JsonObject)nodes[i]!["position"]!, "Nav " + Text(nodes[i]!["id"]), Colors.DarkGreen, (JsonObject)nodes[i]!, "Routes");
        foreach (var field in new[] { "collisionBoxes", "shotBlockers" })
        {
            var boxes = Items(gameplay, field);
            for (var i = 0; i < boxes.Count; i++) AddBox(root, $"gameplay/{field}/{i}", (JsonObject)boxes[i]!, $"{field} {i}", new Color(1, 0.2f, 0.2f, 0.25f), "Collision");
        }
        foreach (var field in new[] { "greybox", "scenery" })
        {
            var boxes = Items(presentation, field);
            for (var i = 0; i < boxes.Count; i++) AddBox(root, $"presentation/{field}/{i}", (JsonObject)boxes[i]!, $"{field} {i}", new Color(0.4f, 0.6f, 0.9f, 0.3f), "Geometry");
        }
        AddArray(root, presentation, "presentation", "props", "position", "Prop", new Color(0.6f, 0.45f, 0.3f));
        var lights = Items(presentation, "lights");
        for (var i = 0; i < lights.Count; i++) if (lights[i] is JsonObject light)
            AddLight(root, $"presentation/lights/{i}", light, gameplay["powerSwitch"] is JsonObject);
        MapGameplay.Prepare(root, document);
        if (previewAssets)
            foreach (var warning in MapPreview.Refresh(root, document)) GD.PushWarning(warning);
        return root;
    }

    private static Color Rgb(int value) => new(
        ((value >> 16) & 255) / 255f,
        ((value >> 8) & 255) / 255f,
        (value & 255) / 255f);

    private static void ApplyAtmosphere(ZombonzMapRoot root, JsonObject presentation)
    {
        if (presentation["atmosphere"] is not JsonObject atmosphere) return;
        root.FogColor = Rgb((int)Number(atmosphere["fogColor"], 0x1d2b30));
        root.FogDensity = (float)Number(atmosphere["fogDensity"], 0.027);
        root.Exposure = (float)Number(atmosphere["exposure"], 1.35);
        root.AmbientSkyColor = Rgb((int)Number(atmosphere["ambientSkyColor"], 0xaabfc9));
        root.AmbientGroundColor = Rgb((int)Number(atmosphere["ambientGroundColor"], 0x373026));
        root.AmbientIntensity = (float)Number(atmosphere["ambientIntensity"], 1.4);
        root.MoonColor = Rgb((int)Number(atmosphere["moonColor"], 0xb4ced7));
        root.MoonIntensity = (float)Number(atmosphere["moonIntensity"], 2.4);
        root.SkyIntensity = (float)Number(atmosphere["skyIntensity"], 0.5);
        if (atmosphere["moonOffset"] is JsonObject offset) root.MoonOffset = Vector(offset);
    }

    private static ZombonzMapItem AddLight(ZombonzMapRoot root, string path, JsonObject light, bool hasPowerSwitch)
    {
        var color = Rgb((int)Number(light["color"], 0xffc38b));
        var item = new ZombonzMapItem
        {
            Name = ("Light " + path.Split('/').Last()).ValidateNodeName(),
            DataPath = path,
            Kind = "light",
            Position = Vector(light),
            LightColor = color,
            LightIntensity = (float)Number(light["intensity"], 11),
            LightRange = (float)Number(light["range"], 10),
            LightDecay = (float)Number(light["decay"], 1.6),
            LightPriority = (float)Number(light["priority"]),
            LightFlicker = Text(light["flicker"], "fluorescent"),
            LightPower = Text(light["power"], hasPowerSwitch ? "dim-until-power" : "always"),
            LightUnpoweredLevel = (float)Number(light["unpoweredLevel"], 0.4),
        };
        Attach(root, item, new SphereMesh { Radius = 0.16f, Height = 0.32f }, color, "Lighting", true);
        return item;
    }

    private static Node3D Group(ZombonzMapRoot root, string name)
    {
        var group = root.GetNodeOrNull<Node3D>(name);
        if (group is not null) return group;
        group = new Node3D { Name = name, Visible = name is not ("Routes" or "Collision") };
        root.AddChild(group); group.Owner = root;
        return group;
    }

    private static void Attach(ZombonzMapRoot root, ZombonzMapItem item, Mesh mesh, Color color, string groupName, bool unshaded = false)
    {
        Group(root, groupName).AddChild(item); item.Owner = root;
        var material = new StandardMaterial3D { AlbedoColor = color };
        if (color.A < 1) material.Transparency = BaseMaterial3D.TransparencyEnum.Alpha;
        if (unshaded) material.ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded;
        var view = new MeshInstance3D { Name = "Handle", Mesh = mesh, MaterialOverride = material };
        item.AddChild(view); view.Owner = root;
    }

    private static ZombonzMapItem AddMarker(ZombonzMapRoot root, string path, JsonObject point, string label, Color color,
        JsonObject? fields = null, string groupName = "Gameplay")
    {
        fields ??= new();
        var item = new ZombonzMapItem
        {
            Name = label.ValidateNodeName(), DataPath = path, Kind = fields.Count > 0 ? "gameplay" : "marker",
            ObjectId = Text(fields["id"]), Position = Vector(point), Rotation = new Vector3(0, (float)Number(fields["yaw"]), 0),
            Cost = (int)Number(fields["cost"], -1), WeaponId = Text(fields["weaponId"]), MaxBoards = (int)Number(fields["maxBoards"]),
            RequiresPower = Boolean(fields["requiresPower"]), Asset = Text(fields["asset"]), WeaponCost = (int)Number(fields["weaponCost"], 200),
            AmmoCost = (int)Number(fields["ammoCost"], 100), BarrierId = Text(fields["barrierId"])
        };
        var radius = groupName == "Routes" ? 0.09f : 0.18f;
        Attach(root, item, new SphereMesh { Radius = radius, Height = radius * 2 }, color, groupName, true);
        return item;
    }

    private static void AddArray(ZombonzMapRoot root, JsonObject section, string sectionName, string field, string pointField, string label, Color color)
    {
        var entries = Items(section, field);
        for (var i = 0; i < entries.Count; i++)
        {
            var entry = (JsonObject)entries[i]!;
            var path = $"{sectionName}/{field}/{i}";
            if (field == "props") { AddProp(root, path + "/position", entry); continue; }
            var point = pointField.Length == 0 ? entry : entry[pointField] as JsonObject;
            if (point is null || !HasXyz(point)) continue;
            if (pointField.Length > 0) path += "/" + pointField;
            AddMarker(root, path, point, label + " " + Text(entry["id"], i.ToString()), color, entry);
        }
    }

    private static ZombonzMapItem AddProp(ZombonzMapRoot root, string path, JsonObject prop)
    {
        var item = new ZombonzMapItem
        {
            Name = ("Prop " + Text(prop["id"])).ValidateNodeName(), DataPath = path, Kind = "prop", ObjectId = Text(prop["id"]),
            Asset = Text(prop["asset"]), Position = Vector(prop["position"]), Rotation = new Vector3(0, (float)Number(prop["yaw"]), 0),
            BaseSize = prop["size"] is null ? Vector3.One : Vector(prop["size"])
        };
        Attach(root, item, new BoxMesh { Size = item.BaseSize }, new Color(0.6f, 0.45f, 0.3f, 0.5f), "Props");
        item.GetNode<MeshInstance3D>("Handle").Position = new Vector3(0, item.BaseSize.Y / 2, 0);
        return item;
    }

    private static ZombonzMapItem AddBox(ZombonzMapRoot root, string path, JsonObject box, string label, Color color, string groupName)
    {
        var center = box["center"] is null ? (Vector(box["min"]) + Vector(box["max"])) / 2 : Vector(box["center"]);
        var size = box["size"] is null ? Vector(box["max"]) - Vector(box["min"]) : Vector(box["size"]);
        var item = new ZombonzMapItem
        {
            Name = label.ValidateNodeName(), DataPath = path, Kind = "box", Position = center, BaseSize = size,
            Material = Text(box["material"], "wall"), Rotation = new Vector3((float)Number(box["rotationX"]), 0, (float)Number(box["rotationZ"]))
        };
        Attach(root, item, new BoxMesh { Size = new Vector3(Math.Max(size.X, 0.02f), Math.Max(size.Y, 0.02f), Math.Max(size.Z, 0.02f)) }, color, groupName, true);
        return item;
    }

    public static ZombonzMapItem AddNew(ZombonzMapRoot root, JsonObject document, string kind)
    {
        var origin = Vector(document["gameplay"]?["playerSpawn"]);
        ZombonzMapItem item;
        switch (kind)
        {
            case "Prop":
                item = AddProp(root, "new/presentation/props", new JsonObject { ["position"] = Point(origin), ["asset"] = "wooden-crate", ["size"] = Point(Vector3.One) });
                break;
            case "Greybox":
                item = AddBox(root, "new/presentation/greybox", new JsonObject { ["center"] = Point(origin), ["size"] = Point(Vector3.One) }, "New greybox", new Color(0.4f, 0.6f, 0.9f, 0.3f), "Geometry");
                break;
            case "Light":
                item = AddLight(root, "new/presentation/lights", new JsonObject { ["x"] = origin.X, ["y"] = origin.Y + 2, ["z"] = origin.Z },
                    document["gameplay"]?["powerSwitch"] is JsonObject);
                break;
            case "Collision box":
                item = AddBox(root, "new/gameplay/collisionBoxes", new JsonObject { ["min"] = Point(origin - Vector3.One / 2), ["max"] = Point(origin + Vector3.One / 2) }, "New collision", new Color(1, 0.2f, 0.2f, 0.25f), "Collision");
                break;
            default:
                var field = kind switch { "Zombie spawn" => "zombieSpawns", "Barrier" => "barriers", "Door" => "doors", "Wall weapon" => "wallWeapons", "Hazard" or "Barrel" or "Jeep" or "Truck" => "hazards", "Navigation node" => "navigation/nodes", "Perk machine" => "perkMachines", "Pack-a-Punch" => "packAPunch", "Equipment buy" => "equipment", _ => throw new ArgumentException("Unknown object type: " + kind) };
                item = AddMarker(root, "new/gameplay/" + field, Point(origin), "New " + kind, Colors.Cyan);
                item.GameplayType = field == "navigation/nodes" ? "routePoint" : field;
                item.HazardKind = kind == "Jeep" ? "jeep" : kind == "Truck" ? "truck" : "barrel";
                if (kind == "Door") { item.Width = 2.4f; item.Cost = 1000; }
                if (kind == "Wall weapon") { item.WeaponId = "kar98k"; item.Position += Vector3.Up; }
                if (kind == "Perk machine") item.Position += Vector3.Up;
                if (kind == "Pack-a-Punch") item.Cost = 5000;
                if (kind == "Equipment buy") item.Cost = 1000;
                break;
        }
        item.Kind = "new";
        item.ObjectId = "new-" + kind.ToLowerInvariant().Replace(' ', '-');
        var baseId = item.ObjectId;
        var suffix = 2;
        while (MapPreview.ItemsIn(root).Any(other => other != item && other.ObjectId == item.ObjectId)) item.ObjectId = baseId + "-" + suffix++;
        // New objects have no array index yet; use a unique temporary path for linked children.
        if (kind is "Barrier" or "Door") item.DataPath += "/" + Guid.NewGuid().ToString("N");
        if (kind == "Barrier") item.MaxBoards = 6;
        MapGameplay.Prepare(root, document);
        return item;
    }
}
