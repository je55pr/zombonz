using System.Globalization;
using System.Text.Json.Nodes;
using Godot;

/// <summary>Preserves source JSON values and emits only actual authoring changes.</summary>
public static class MapDocument
{
    public sealed record Addition(ZombonzMapItem Item, string Path, string Kind);

    public static JsonObject Read(string path) => JsonNode.Parse(System.IO.File.ReadAllText(path)) as JsonObject
        ?? throw new InvalidDataException("Map must be a JSON object: " + path);

    public static JsonArray Items(JsonObject section, string field) => section[field] as JsonArray ?? new JsonArray();
    public static string Text(JsonNode? node, string fallback = "") => node is JsonValue value
        && value.TryGetValue<string>(out var text) ? text : fallback;
    public static double Number(JsonNode? node, double fallback = 0) => node is not null
        && double.TryParse(node.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) ? number : fallback;
    public static bool Boolean(JsonNode? node) => node is JsonValue value && value.TryGetValue<bool>(out var result) && result;
    public static bool HasXyz(JsonNode? node) => node is JsonObject obj && obj.ContainsKey("x") && obj.ContainsKey("y") && obj.ContainsKey("z");
    public static Vector3 Vector(JsonNode? node) => new((float)Number(node?["x"]), (float)Number(node?["y"]), (float)Number(node?["z"]));
    public static JsonObject Point(Vector3 point) => new() { ["x"] = point.X, ["y"] = point.Y, ["z"] = point.Z };

    public static JsonNode? AtPath(JsonObject document, string path)
    {
        JsonNode? value = document;
        foreach (var segment in path.Split('/'))
        {
            if (value is JsonObject obj) value = obj[segment];
            else if (value is JsonArray array && int.TryParse(segment, out var index) && index >= 0 && index < array.Count) value = array[index];
            else return null;
        }
        return value;
    }

    private static void SetNumber(JsonObject target, string key, double value, bool angle = false)
    {
        var difference = Number(target[key]) - value;
        if (angle) difference = Math.IEEERemainder(difference, Math.Tau);
        if (!target.ContainsKey(key) || Math.Abs(difference) > 0.0001)
            target[key] = Math.Round(value, 4, MidpointRounding.AwayFromZero);
    }

    private static void SetPosition(JsonObject target, Vector3 position)
    {
        SetNumber(target, "x", position.X);
        SetNumber(target, "y", position.Y);
        SetNumber(target, "z", position.Z);
    }

    private static void SetField(JsonObject target, string key, JsonNode value, bool enabled = true)
    {
        if (enabled && target.ContainsKey(key) && !JsonNode.DeepEquals(target[key], value)) target[key] = value;
    }

    public static void ApplyItem(JsonObject document, ZombonzMapItem item)
    {
        if (AtPath(document, item.DataPath) is not JsonObject target) return;
        var size = item.Scale.Abs() * item.BaseSize;
        if (item.Kind == "box")
        {
            if (target["center"] is JsonObject center && target["size"] is JsonObject boxSize)
            {
                SetPosition(center, item.Position);
                SetPosition(boxSize, size);
                if (target.ContainsKey("rotationX") || Math.Abs(item.Rotation.X) > 0.0001) SetNumber(target, "rotationX", item.Rotation.X, true);
                if (target.ContainsKey("rotationZ") || Math.Abs(item.Rotation.Z) > 0.0001) SetNumber(target, "rotationZ", item.Rotation.Z, true);
            }
            else if (target["min"] is JsonObject min && target["max"] is JsonObject max)
            {
                SetPosition(min, item.Position - size / 2);
                SetPosition(max, item.Position + size / 2);
            }
            return;
        }
        SetPosition(target, item.Position);
        if (item.DataPath.StartsWith("gameplay/zombieSpawns/") && item.BarrierId.Length > 0)
            target["barrierId"] = item.BarrierId;
        var slash = item.DataPath.LastIndexOf('/');
        if (slash < 0 || item.Kind == "marker" || AtPath(document, item.DataPath[..slash]) is not JsonObject parent) return;
        SetField(parent, "id", JsonValue.Create(item.ObjectId)!, item.ObjectId.Length > 0);
        if (parent.ContainsKey("yaw")) SetNumber(parent, "yaw", item.Rotation.Y, true);
        if (item.Kind == "prop" && parent["size"] is JsonObject propSize) SetPosition(propSize, size);
        SetField(parent, "cost", JsonValue.Create(item.Cost)!, item.Cost >= 0);
        SetField(parent, "weaponId", JsonValue.Create(item.WeaponId)!, item.WeaponId.Length > 0);
        SetField(parent, "weaponCost", JsonValue.Create(item.WeaponCost)!);
        SetField(parent, "ammoCost", JsonValue.Create(item.AmmoCost)!);
        SetField(parent, "maxBoards", JsonValue.Create(item.MaxBoards)!);
        SetField(parent, "requiresPower", JsonValue.Create(item.RequiresPower)!);
        SetField(parent, "asset", JsonValue.Create(item.Asset)!, item.Asset.Length > 0);
    }

    private static void AppendNew(JsonObject document, ZombonzMapItem item, List<Addition> pending)
    {
        var parts = item.DataPath.Split('/');
        if (parts.Length < 3 || document[parts[1]] is not JsonObject section) return;
        var field = parts[2];
        var target = (field == "navigation" ? section["navigation"]?["nodes"] : section[field]) as JsonArray;
        if (target is null) return;
        var position = Point(item.Position);
        var size = item.Scale.Abs() * item.BaseSize;
        JsonObject? entry = field switch
        {
            "props" => new() { ["id"] = item.ObjectId, ["asset"] = item.Asset.Length > 0 ? item.Asset : "wooden-crate", ["position"] = position,
                ["size"] = Point(size), ["yaw"] = item.Rotation.Y, ["solid"] = false, ["background"] = false },
            "greybox" => new() { ["center"] = position, ["size"] = Point(size), ["material"] = item.Material, ["collides"] = false },
            "collisionBoxes" => new() { ["min"] = Point(item.Position - size / 2), ["max"] = Point(item.Position + size / 2) },
            "zombieSpawns" => position,
            "barriers" => new() { ["id"] = item.ObjectId, ["position"] = position, ["outward"] = Point(new Vector3(0, 0, -1)),
                ["width"] = 1.5, ["maxBoards"] = item.MaxBoards,
                ["approachPath"] = new JsonArray(Point(item.Position + new Vector3(0, 0, -3)), Point(item.Position + new Vector3(0, 0, -1))),
                ["insidePoint"] = Point(item.Position + new Vector3(0, 0, 1)) },
            "doors" => new() { ["id"] = item.ObjectId, ["position"] = position, ["cost"] = Math.Max(0, item.Cost),
                ["blocker"] = new JsonObject { ["min"] = Point(item.Position + new Vector3(-0.5f, 0, -0.15f)),
                    ["max"] = Point(item.Position + new Vector3(0.5f, 2.4f, 0.15f)) } },
            "wallWeapons" => new() { ["id"] = item.ObjectId, ["position"] = position, ["weaponId"] = item.WeaponId.Length > 0 ? item.WeaponId : "kar98k",
                ["weaponCost"] = item.WeaponCost, ["ammoCost"] = item.AmmoCost },
            "hazards" => new() { ["id"] = item.ObjectId, ["kind"] = "barrel", ["position"] = position, ["yaw"] = 0 },
            "navigation" => new() { ["id"] = item.ObjectId, ["position"] = position, ["neighbors"] = new JsonArray() },
            _ => null
        };
        if (entry is null) return;
        if (field == "zombieSpawns" && item.BarrierId.Length > 0) entry["barrierId"] = item.BarrierId;
        var kind = field is "greybox" or "collisionBoxes" ? "box" : field == "props" ? "prop" : "gameplay";
        var suffix = field is "greybox" or "collisionBoxes" or "zombieSpawns" ? "" : "/position";
        pending.Add(new(item, $"{parts[1]}/{(field == "navigation" ? "navigation/nodes" : field)}/{target.Count}{suffix}", kind));
        target.Add(entry);
    }

    public static void WalkItems(JsonObject document, Node node, List<Addition>? pending = null)
    {
        pending ??= new();
        if (node is ZombonzMapItem item)
        {
            if (item.Kind == "new") AppendNew(document, item, pending);
            else ApplyItem(document, item);
        }
        foreach (var child in node.GetChildren()) WalkItems(document, child, pending);
    }

    public static JsonArray CollectChanges(JsonNode before, JsonNode after)
    {
        var changes = new JsonArray();
        Collect(before, after, new JsonArray(), changes);
        return changes;
    }

    private static void Collect(JsonNode? before, JsonNode? after, JsonArray path, JsonArray changes)
    {
        if (before is JsonObject left && after is JsonObject right)
        {
            foreach (var (key, value) in right)
            {
                var childPath = (JsonArray)path.DeepClone(); childPath.Add(key);
                if (left.ContainsKey(key)) Collect(left[key], value, childPath, changes);
                else changes.Add(new JsonObject { ["path"] = childPath, ["value"] = value?.DeepClone() });
            }
        }
        else if (before is JsonArray leftArray && after is JsonArray rightArray && rightArray.Count >= leftArray.Count)
        {
            for (var i = 0; i < rightArray.Count; i++)
            {
                var childPath = (JsonArray)path.DeepClone(); childPath.Add(i);
                if (i < leftArray.Count) Collect(leftArray[i], rightArray[i], childPath, changes);
                else changes.Add(new JsonObject { ["path"] = childPath, ["value"] = rightArray[i]?.DeepClone() });
            }
        }
        else if (!JsonNode.DeepEquals(before, after)) changes.Add(new JsonObject { ["path"] = path, ["value"] = after?.DeepClone() });
    }

    public static List<string> Validate(JsonObject document)
    {
        var errors = new List<string>();
        if (Number(document["version"]) != 1) errors.Add("version must be 1");
        foreach (var section in new[] { "metadata", "gameplay", "presentation" })
            if (document[section] is not JsonObject) errors.Add("Missing " + section);
        if (errors.Count > 0) return errors;
        var gameplay = (JsonObject)document["gameplay"]!;
        if (!HasXyz(gameplay["playerSpawn"])) errors.Add("gameplay.playerSpawn needs x, y, z");
        var barriers = new HashSet<string>();
        foreach (var barrier in Items(gameplay, "barriers"))
        {
            var id = Text(barrier?["id"]);
            if (!barriers.Add(id)) errors.Add("Duplicate barrier ID: " + id);
            if (!HasXyz(barrier?["position"]) || !HasXyz(barrier?["insidePoint"])) errors.Add("Barrier needs position and insidePoint: " + id);
        }
        var spawns = Items(gameplay, "zombieSpawns");
        for (var i = 0; i < spawns.Count; i++)
        {
            if (!HasXyz(spawns[i])) errors.Add("Invalid zombie spawn " + i);
            if (spawns[i]?["barrierId"] is { } id && !barriers.Contains(Text(id))) errors.Add("Unknown barrier at zombie spawn " + i);
        }
        var nodes = gameplay["navigation"]?["nodes"] as JsonArray ?? new JsonArray();
        var nodeIds = new HashSet<string>();
        foreach (var node in nodes) if (!nodeIds.Add(Text(node?["id"]))) errors.Add("Duplicate navigation ID: " + Text(node?["id"]));
        foreach (var node in nodes)
            foreach (var neighbor in node?["neighbors"] as JsonArray ?? new JsonArray())
                if (!nodeIds.Contains(Text(neighbor))) errors.Add("Unknown navigation neighbor: " + Text(neighbor));
        foreach (var door in Items(gameplay, "doors")) if (Number(door?["cost"], -1) < 0) errors.Add("Negative door cost: " + Text(door?["id"]));
        return errors;
    }
}
