using System.Text.Json.Nodes;
using Godot;

public partial class SmokeTest : Node
{
    public override void _Ready()
    {
        try
        {
            foreach (var id in new[] { "bunker", "asylum" }) CheckMap(id);
            GD.Print("C# map editor: both maps import, preserve untouched JSON, edit, add objects, serialize scenes, and export through the browser validator.");
            GetTree().Quit();
        }
        catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void CheckMap(string id)
    {
        var source = $"../../src/maps/data/{id}.v1.json";
        var document = MapDocument.Read(ZombonzMapPlugin.SourcePath(source));
        Require(MapDocument.Validate(document).Count == 0, id + " failed validation");
        var original = document.DeepClone();
        var built = MapScene.Build(document, source);
        using var packed = new PackedScene();
        Require(packed.Pack(built) == Error.Ok, "Packing C# map scene failed");
        built.Free();
        var root = packed.Instantiate<ZombonzMapRoot>();
        try
        {
            Require(root.SourceFile == source, "Source property did not survive scene serialization");
            MapDocument.WalkItems(document, root);
            Require(JsonNode.DeepEquals(original, document), id + " changed during untouched roundtrip");
            Require(MapDocument.CollectChanges(original, document).Count == 0, "Untouched map emitted edits");
            var spawn = root.GetNode<ZombonzMapItem>("Gameplay/Player spawn");
            var originalX = MapDocument.Number(document["gameplay"]!["playerSpawn"]!["x"]);
            spawn.Position += Vector3.Right;
            MapDocument.WalkItems(document, root);
            Require(Math.Abs(MapDocument.Number(document["gameplay"]!["playerSpawn"]!["x"]) - originalX - 1) < 0.001, "Visual move did not update JSON");
            var propCount = ((JsonArray)document["presentation"]!["props"]!).Count;
            var item = MapScene.AddNew(root, document, "Prop");
            item.ObjectId = "csharp-smoke-crate";
            item.Position = new Vector3(1, 2, 3);
            item.Scale = new Vector3(2, 1, 3);
            var pending = new List<MapDocument.Addition>();
            MapDocument.WalkItems(document, root, pending);
            Require(((JsonArray)document["presentation"]!["props"]!).Count == propCount + 1 && pending.Count == 1, "New prop did not reach JSON");
            var changes = MapDocument.CollectChanges(original, document);
            Require(changes.Count == 2, "Move and addition should produce exactly two focused JSON edits");
            CheckExport(id, original, document, changes);
            // Every existing add-object choice must still produce an exportable entry.
            foreach (var kind in MapScene.NewObjectKinds)
            {
                var candidate = (JsonObject)original.DeepClone();
                var testRoot = MapScene.Build(candidate, source);
                try
                {
                    MapScene.AddNew(testRoot, candidate, kind);
                    var additions = new List<MapDocument.Addition>();
                    MapDocument.WalkItems(candidate, testRoot, additions);
                    Require(additions.Count == 1 && MapDocument.CollectChanges(original, candidate).Count == 1, "Could not add " + kind);
                }
                finally { testRoot.Free(); }
            }
        }
        finally { root.Free(); }
    }

    private static void CheckExport(string id, JsonNode original, JsonNode expected, JsonArray changes)
    {
        var mapPath = System.IO.Path.Combine(OS.GetUserDataDir(), $"smoke-{id}.json");
        var editsPath = System.IO.Path.Combine(OS.GetUserDataDir(), $"smoke-{id}-edits.json");
        try
        {
            System.IO.File.WriteAllText(mapPath, original.ToJsonString());
            System.IO.File.WriteAllText(editsPath, changes.ToJsonString());
            var output = new Godot.Collections.Array();
            var script = ZombonzMapPlugin.SourcePath("../../scripts/apply-map-edits.mjs");
            Require(OS.Execute("node", new[] { script, mapPath, editsPath }, output, true) == 0, "Validated export failed: " + string.Join('\n', output));
            Require(JsonNode.DeepEquals(MapDocument.Read(mapPath), expected), "Exported JSON differs from editor data");
            var validExport = System.IO.File.ReadAllText(mapPath);
            System.IO.File.WriteAllText(editsPath, "[{\"path\":[\"version\"],\"value\":999}]");
            Require(OS.Execute("node", new[] { script, mapPath, editsPath }, output, true) != 0, "Invalid export was accepted");
            Require(System.IO.File.ReadAllText(mapPath) == validExport, "Failed export changed the source JSON");
        }
        finally { System.IO.File.Delete(mapPath); System.IO.File.Delete(editsPath); }
    }
}
