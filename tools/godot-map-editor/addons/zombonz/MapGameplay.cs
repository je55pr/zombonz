using System.Text.Json.Nodes;
using Godot;
using static MapDocument;

/// <summary>Links gameplay anchors to their editable collision and entry points.</summary>
public static class MapGameplay
{
    public static Transform3D MapTransform(Node3D node)
    {
        var transform = node.Transform;
        for (var parent = node.GetParent(); parent is not null && parent is not ZombonzMapRoot; parent = parent.GetParent())
            if (parent is Node3D spatial) transform = spatial.Transform * transform;
        return transform;
    }

    public static string TypeFor(string path)
    {
        var parts = path.Split('/');
        if (parts[0] == "new") parts = parts[1..];
        if (parts.Length < 2 || parts[0] != "gameplay") return "";
        if (parts[1] is "collisionBoxes" or "shotBlockers") return "collision";
        if (parts[1] == "barriers" && (parts.Contains("insidePoint") || parts.Contains("approachPath"))) return "routePoint";
        if (parts[^1] is "blocker" or "zone") return "collision";
        return parts[1] == "navigation" ? "routePoint" : parts[1];
    }

    public static void Prepare(ZombonzMapRoot root, JsonObject document)
    {
        foreach (var item in MapPreview.ItemsIn(root).ToArray())
        {
            var type = TypeFor(item.DataPath);
            if (type.Length == 0 || item.Kind == "box") continue;
            var fields = AtPath(document, item.DataPath[..Math.Max(0, item.DataPath.LastIndexOf('/'))]) as JsonObject ?? new JsonObject();
            var sourcePoint = Vector(fields["position"]);
            if (item.GameplayType.Length == 0)
            {
                item.GameplayType = type;
                item.HazardKind = Text(fields["kind"], "barrel");
                item.PerkId = Text(fields["perk"], "juggernog");
                item.Outward = fields["outward"] is null ? Vector3.Forward : Vector(fields["outward"]);
                item.Width = (float)Number(fields["width"], 1.5);
                if (type == "doors")
                {
                    var style = document["presentation"]?["doorStyles"]?[Text(fields["id"])] as JsonObject;
                    item.DoorAppearance = Text(style?["kind"], "planks");
                    item.DoorLabel = Text(style?["label"]);
                    item.Width = (float)Number(style?["width"], 2.4);
                    item.InitialYaw = (float)Number(style?["yaw"]);
                    item.Rotation += new Vector3(0, item.InitialYaw, 0);
                }
                var facingField = FacingField(type);
                if (facingField.Length > 0)
                {
                    item.InitialYaw = (float)Number(document["presentation"]?[facingField]?[Text(fields["id"])]);
                    item.Rotation += new Vector3(0, item.InitialYaw, 0);
                }
                if (type == "mysteryBoxes")
                {
                    var location = (fields["locations"] as JsonArray)?.FirstOrDefault();
                    var center = Vector(location?["center"] ?? document["presentation"]?["boxCenter"]);
                    item.InitialYaw = (float)Number(location?["yaw"], Number(document["presentation"]?["boxYaw"]));
                    item.Rotation += new Vector3(0, item.InitialYaw, 0);
                    item.PreviewOffset = new Basis(Vector3.Up, -item.InitialYaw) * (center - sourcePoint - Vector3.Up * 0.52f);
                }
            }
            if (item.Kind == "new") sourcePoint = item.Position;
            var initial = new Transform3D(new Basis(Vector3.Up, item.InitialYaw), sourcePoint);
            var parentPath = item.DataPath.EndsWith("/position") || item.DataPath.EndsWith("/switchPosition")
                ? item.DataPath[..item.DataPath.LastIndexOf('/')] : item.DataPath;
            if (type == "barriers")
            {
                LinkPoint(root, item, parentPath + "/insidePoint", "Inside point", fields["insidePoint"] is null
                    ? sourcePoint + Vector3.Back : Vector(fields["insidePoint"]), initial);
                var route = Items(fields, "approachPath");
                if (route.Count == 0 && item.Kind == "new") route = new JsonArray(Point(sourcePoint + Vector3.Forward * 3), Point(sourcePoint + Vector3.Forward));
                for (var i = 0; i < route.Count; i++) LinkPoint(root, item, $"{parentPath}/approachPath/{i}", "Approach " + i, Vector(route[i]), initial);
            }
            if (type == "doors") LinkBox(root, item, parentPath + "/blocker", "Blocker", fields["blocker"] as JsonObject
                ?? new JsonObject { ["min"] = Point(sourcePoint + new Vector3(-0.2f, 0, -item.Width / 2)),
                    ["max"] = Point(sourcePoint + new Vector3(0.2f, 2.85f, item.Width / 2)) }, initial);
            if (type == "mysteryBoxes" && fields["locations"] is null)
            {
                var center = Vector(document["presentation"]?["boxCenter"]);
                var body = MapPreview.ItemsIn(root).FirstOrDefault(candidate => candidate.DataPath.StartsWith("presentation/greybox/")
                    && AtPath(document, candidate.DataPath) is JsonObject box && Text(box["material"]) == "barrier"
                    && Vector(box["center"]).IsEqualApprox(center));
                if (body is not null && body.GetParent() != item)
                {
                    var transform = MapTransform(body); body.Owner = null; body.GetParent()?.RemoveChild(body);
                    item.AddChild(body); body.Transform = initial.AffineInverse() * transform; MapPreview.Own(root, body);
                }
            }
            if (type == "traps" && fields["zone"] is JsonObject zone) LinkBox(root, item, parentPath + "/zone", "Trap zone", zone,
                new Transform3D(Basis.Identity, Vector(fields["switchPosition"])));
        }
    }

    private static void LinkPoint(ZombonzMapRoot root, ZombonzMapItem parent, string path, string name, Vector3 position, Transform3D initial)
    {
        var existing = MapPreview.ItemsIn(root).FirstOrDefault(item => item.DataPath == path);
        if (existing?.GetParent() == parent) return;
        var item = existing ?? new ZombonzMapItem { Name = name, Kind = "marker", DataPath = path, GameplayType = "routePoint", Position = position };
        var transform = existing is null ? new Transform3D(Basis.Identity, position) : MapTransform(item);
        item.Owner = null;
        item.GetParent()?.RemoveChild(item); parent.AddChild(item); item.Transform = initial.AffineInverse() * transform;
        MapPreview.Own(root, item);
        item.GameplayType = "routePoint";
    }

    private static void LinkBox(ZombonzMapRoot root, ZombonzMapItem parent, string path, string name, JsonObject box, Transform3D initial)
    {
        if (MapPreview.ItemsIn(root).Any(item => item.DataPath == path)) return;
        var min = Vector(box["min"]); var max = Vector(box["max"]);
        var item = new ZombonzMapItem { Name = name, Kind = "box", DataPath = path, BaseSize = max - min, GameplayType = "collision",
            Transform = initial.AffineInverse() * new Transform3D(Basis.Identity, (min + max) / 2) };
        parent.AddChild(item); item.Owner = root;
        var view = new MeshInstance3D { Name = "Handle", Mesh = new BoxMesh { Size = item.BaseSize }, MaterialOverride = new StandardMaterial3D
            { AlbedoColor = new Color(1, 0.2f, 0.2f, 0.2f), Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
                ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded } };
        item.AddChild(view); view.Owner = root;
    }

    public static string FacingField(string type) => type switch
    { "wallWeapons" => "wallWeaponFacing", "perkMachines" => "perkMachineFacing", "equipment" => "equipmentFacing", _ => "" };

    public static double QuarterYaw(float yaw) => Math.Abs(Math.Sin(2 * yaw)) < 0.0001
        ? Math.Round(yaw / (Math.PI / 2)) * (Math.PI / 2) : yaw;

    public static void WritePresentation(JsonObject document, ZombonzMapItem item, string originalId)
    {
        var presentation = (JsonObject)document["presentation"]!;
        var facing = FacingField(item.GameplayType);
        if (facing.Length > 0)
        {
            var values = presentation[facing] as JsonObject ?? new JsonObject();
            if (values.ContainsKey(originalId) || item.Kind == "new" || Math.Abs(item.Rotation.Y) > 0.0001)
            {
                if (presentation[facing] is null) presentation[facing] = values;
                if (originalId != item.ObjectId && values.ContainsKey(originalId)) values[item.ObjectId] = values[originalId]?.DeepClone();
                if (item.ObjectId.Length > 0) SetNumber(values, item.ObjectId, item.Rotation.Y, true);
            }
        }
        if (item.GameplayType == "doors")
        {
            var styles = presentation["doorStyles"] as JsonObject ?? new JsonObject();
            if (presentation["doorStyles"] is null) presentation["doorStyles"] = styles;
            if (originalId != item.ObjectId && styles.ContainsKey(originalId)) styles[item.ObjectId] = styles[originalId]?.DeepClone();
            var style = styles[item.ObjectId] as JsonObject ?? new JsonObject();
            if (styles[item.ObjectId] is null) styles[item.ObjectId] = style;
            style["kind"] = item.DoorAppearance;
            SetNumber(style, "yaw", item.Rotation.Y, true); SetNumber(style, "width", item.Width);
            if (style.ContainsKey("label") || item.DoorLabel.Length > 0) style["label"] = item.DoorLabel;
        }
        if (item.GameplayType == "mysteryBoxes")
        {
            var fields = AtPath(document, item.DataPath[..item.DataPath.LastIndexOf('/')]) as JsonObject;
            var location = (fields?["locations"] as JsonArray)?.FirstOrDefault() as JsonObject;
            var center = MapTransform(item) * (item.PreviewOffset + Vector3.Up * 0.52f);
            if (location?["center"] is JsonObject point)
            {
                SetPosition(point, center); SetNumber(location, "yaw", item.Rotation.Y, true);
                if (location["position"] is JsonObject buyPoint) SetPosition(buyPoint, MapTransform(item).Origin);
            }
            if (presentation["boxCenter"] is JsonObject boxCenter) SetPosition(boxCenter, center);
            if (presentation.ContainsKey("boxYaw")) SetNumber(presentation, "boxYaw", item.Rotation.Y, true);
        }
        if (item.GameplayType == "barriers")
        {
            var window = Items(presentation, "windows").OfType<JsonObject>().FirstOrDefault(window => Text(window["id"]) == originalId);
            if (window is null && item.Kind == "new" && item.MaxBoards > 0)
            {
                var windows = presentation["windows"] as JsonArray ?? new JsonArray();
                if (presentation["windows"] is null) presentation["windows"] = windows;
                window = new JsonObject(); windows.Add(window);
            }
            if (window is null) return;
            window["id"] = item.ObjectId;
            SetPosition(window, MapTransform(item).Origin); SetNumber(window, "width", item.Width);
            var outward = new Basis(Vector3.Up, item.Rotation.Y) * item.Outward;
            if (window["outward"] is not JsonObject direction) window["outward"] = direction = new JsonObject();
            SetPosition(direction, outward);
            window["axis"] = Math.Abs(outward.X) > 0.5 ? "z" : "x";
        }
    }
}
