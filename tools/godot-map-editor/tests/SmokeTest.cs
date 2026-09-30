using System.Text.Json.Nodes;
using Godot;

public partial class SmokeTest : Node
{
    public override void _Ready()
    {
        try
        {
            foreach (var id in new[] { "bunker", "asylum" }) CheckMap(id);
            GD.Print("C# map editor: both maps load textured models and PBR surfaces, preserve previews after reopening, preserve untouched JSON, edit, add objects, and export through the browser validator.");
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
        try
        {
            CheckPreview(built, document);
            Require(packed.Pack(built) == Error.Ok, "Packing C# map scene failed");
        }
        finally { built.Free(); }
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
            Require(MapPreview.Refresh(root, document).Count == 0, "Refresh failed after scene edits");
            Require(spawn.Position.X == (float)originalX + 1 && item.Position == new Vector3(1, 2, 3)
                && item.Scale == new Vector3(2, 1, 3), "Refresh discarded scene edits");
            var modelScale = item.Scale * item.GetNode<Node3D>("Art").Scale;
            Require(Math.Abs(modelScale.X - modelScale.Y) < 0.001 && Math.Abs(modelScale.Y - modelScale.Z) < 0.001,
                "A resized prop stretched instead of matching the browser's uniform fit");
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
                var testRoot = MapScene.Build(candidate, source, previewAssets: false);
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

    private static IEnumerable<MeshInstance3D> Meshes(Node node)
    {
        if (node is MeshInstance3D mesh) yield return mesh;
        foreach (var child in node.GetChildren()) foreach (var descendant in Meshes(child)) yield return descendant;
    }

    private static void CheckPreview(ZombonzMapRoot root, JsonObject document)
    {
        Require(MapPreview.Refresh(root, document).Count == 0, "A map preview asset could not load");
        foreach (var item in MapPreview.ItemsIn(root).Where(item => item.Kind == "prop"))
        {
            var art = item.GetNode<Node3D>("Art");
            var bounds = MapPreviewAssets.Bounds(art);
            Require(Math.Abs(bounds.Position.Y) < 0.001 && Math.Abs(bounds.GetCenter().X) < 0.001 && Math.Abs(bounds.GetCenter().Z) < 0.001,
                "Model is not centered at its foot: " + item.Asset);
            Require(bounds.Size.X <= item.BaseSize.X + 0.001 && bounds.Size.Y <= item.BaseSize.Y + 0.001 && bounds.Size.Z <= item.BaseSize.Z + 0.001,
                "Model does not fit the runtime prop size: " + item.Asset);
            using var reader = new BinaryReader(System.IO.File.OpenRead(ZombonzMapPlugin.SourcePath("../../public/assets/props/" + item.Asset + "/model.glb")));
            reader.BaseStream.Position = 12; var length = reader.ReadInt32(); reader.ReadInt32();
            var gltf = JsonNode.Parse(reader.ReadBytes(length))!;
            var expectsTextures = ((JsonArray)gltf["materials"]!).Any(material => material?["pbrMetallicRoughness"]?["baseColorTexture"] is not null);
            var materials = Meshes(art).SelectMany(mesh => Enumerable.Range(0, mesh.Mesh.GetSurfaceCount()).Select(mesh.GetActiveMaterial)).OfType<BaseMaterial3D>().ToArray();
            Require(materials.Length > 0 && (!expectsTextures || materials.Any(material => material.AlbedoTexture is not null)),
                "Prop lost its source materials or embedded textures: " + item.Asset);
        }
        foreach (var item in MapPreview.ItemsIn(root).Where(item => item.DataPath.StartsWith("presentation/greybox/") || item.DataPath.StartsWith("presentation/scenery/")))
        {
            var mesh = item.GetNode<MeshInstance3D>("Art/Surface");
            Require(mesh.MaterialOverride is OrmMaterial3D { AlbedoTexture: not null, NormalTexture: not null, OrmTexture: not null }, "Architecture lost PBR maps");
            var box = (JsonObject)MapDocument.AtPath(document, item.DataPath)!;
            Require(mesh.MaterialOverride.ResourceName == MapDocument.Text(box["underside"], MapPreviewAssets.Look(box, item)), "Wrong architecture look");
            Require(item.GetNode<Node3D>("Art").Visible == (box["visible"] is null || MapDocument.Boolean(box["visible"])), "Invisible geometry became visible");
        }
        var presentation = (JsonObject)document["presentation"]!;
        Require(root.GetNode("Preview").GetChildren().Count(node => node.Name.ToString().StartsWith("Decal")) == MapDocument.Items(presentation, "decals").Count, "Missing decals");
        Require(root.GetNode("Preview").GetChildren().Count(node => node.Name.ToString().StartsWith("Prism")) == MapDocument.Items(presentation, "prisms").Count, "Missing prism geometry");
        var path = "user://preview-roundtrip.tscn";
        using var packed = new PackedScene();
        Require(packed.Pack(root) == Error.Ok && ResourceSaver.Save(packed, path) == Error.Ok, "Saving textured scene failed");
        try
        {
            var restored = ResourceLoader.Load<PackedScene>(path, cacheMode: ResourceLoader.CacheMode.Ignore).Instantiate<ZombonzMapRoot>();
            try
            {
                Require(Meshes(restored).Count() == Meshes(root).Count(), "Reopened map lost models");
                Require(Meshes(restored).Count(mesh => mesh.MaterialOverride is OrmMaterial3D { OrmTexture: not null })
                    == Meshes(root).Count(mesh => mesh.MaterialOverride is OrmMaterial3D { OrmTexture: not null }), "Reopened map lost PBR textures");
                var roundtrip = (JsonObject)document.DeepClone(); MapDocument.WalkItems(roundtrip, restored);
                Require(JsonNode.DeepEquals(roundtrip, document), "Preview nodes changed exported JSON after reopening");
            }
            finally { restored.Free(); }
        }
        finally { System.IO.File.Delete(ProjectSettings.GlobalizePath(path)); }
        var prop = MapPreview.ItemsIn(root).First(item => item.Kind == "prop");
        var asset = prop.Asset; var oldArt = prop.GetNode("Art");
        prop.Asset = "missing-preview-model";
        Require(MapPreview.Refresh(root, document).Count == 1 && prop.GetNode("Art") == oldArt, "Missing asset did not preserve an editable preview");
        prop.Asset = asset;
        Require(MapPreview.Refresh(root, document).Count == 0, "Preview did not recover after restoring the asset");
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
