using System.Text.Json.Nodes;
using Godot;

public partial class SmokeTest : Node
{
    private static readonly string LoadStamp = Guid.NewGuid().ToString("N");

    /// <summary>Changes whenever the editor loads this C# code again (ReloadCheck.gd waits on it).</summary>
    public string AssemblyStamp() => LoadStamp;

    /// <summary>After the import checks, makes the editor reload the C# code and presses the dock again (ReloadCheck.gd).</summary>
    public static void StartReloadCheck()
    {
        var check = (Node)GD.Load<GDScript>("res://tests/ReloadCheck.gd").New().AsGodotObject();
        EditorInterface.Singleton.GetBaseControl().CallDeferred(Node.MethodName.AddChild, check);
    }

    public override void _Ready()
    {
        try
        {
            RunChecks();
            GetTree().Quit();
        }
        catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }

    public static void RunChecks()
    {
        var propsDirectory = ZombonzMapPlugin.SourcePath("../../public/assets/props");
        var sourceFiles = System.IO.Directory.GetFiles(propsDirectory, "*", SearchOption.AllDirectories).Order().ToArray();
        // Force a real GLB import even when previous runtime checks already populated the cache.
        var assets = new MapPreviewAssets();
        var coldModel = assets.Model("wooden-table", rebuild: true).Instantiate<Node3D>();
        try { Require(MapPreviewAssets.Bounds(coldModel).Size.Length() > 0, "Cold model import has no renderable meshes"); }
        finally { coldModel.Free(); }
        CheckSharedTypeScriptValidation();
        foreach (var id in new[] { "bunker", "asylum" })
        {
            // Exercise cached native resources after the previous map's managed wrappers are collected.
            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
            CheckMap(id);
        }
        Require(sourceFiles.SequenceEqual(System.IO.Directory.GetFiles(propsDirectory, "*", SearchOption.AllDirectories).Order()),
            "Preview import extracted new files into the browser's source assets");
        GD.Print("C# map editor (" + (Engine.IsEditorHint() ? "editor" : "runtime") + "): both maps load textured models and PBR surfaces, preserve previews after reopening, preserve untouched JSON, edit, add objects, and export through the browser validator.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void CheckSharedTypeScriptValidation()
    {
        var document = MapDocument.Read(ZombonzMapPlugin.SourcePath("../../src/maps/data/bunker.v1.json"));
        var spawns = (JsonArray)document["gameplay"]!["zombieSpawns"]!;
        var first = (JsonObject)spawns[0]!;
        var duplicate = (JsonObject)spawns[1]!;
        duplicate["x"] = first["x"]!.DeepClone();
        duplicate["y"] = first["y"]!.DeepClone();
        duplicate["z"] = first["z"]!.DeepClone();
        Require(MapDocument.Validate(document).Count == 0, "C# preflight unexpectedly owns the semantic spawn rule");
        var result = ZombonzMapPlugin.ValidateWithTypeScript(document);
        Require(!result.Ok && result.Message.Contains("duplicate spawn within"),
            "Godot did not surface the shared TypeScript semantic validator: " + result.Message);
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
                    Require(additions.Count >= 1 && MapDocument.CollectChanges(original, candidate).Count >= 1
                        && MapDocument.Validate(candidate).Count == 0, "Could not add " + kind);
                }
                finally { testRoot.Free(); }
            }
            CheckGameplayEdits(id, (JsonObject)original, source);
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
        CheckGameplayPreview(root);
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
                CheckGameplayPreview(restored);
                Require(Meshes(restored).Count(mesh => mesh.MaterialOverride is OrmMaterial3D { OrmTexture: not null })
                    == Meshes(root).Count(mesh => mesh.MaterialOverride is OrmMaterial3D { OrmTexture: not null }), "Reopened map lost PBR textures");
                var roundtrip = (JsonObject)document.DeepClone(); MapDocument.WalkItems(roundtrip, restored);
                Require(JsonNode.DeepEquals(roundtrip, document), "Preview nodes changed exported JSON after reopening: " + MapDocument.CollectChanges(document, roundtrip).ToJsonString());
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

    private static void CheckGameplayPreview(ZombonzMapRoot root)
    {
        var items = MapPreview.ItemsIn(root).ToArray();
        foreach (var item in items.Where(item => item.GameplayType == "hazards"))
        {
            var bounds = MapPreviewAssets.Bounds(item.GetNode<Node3D>("Art"));
            var size = GameplayPreview.Hazard(item.HazardKind).Size;
            Require(bounds.Size.X <= size.X + 0.001 && bounds.Size.Y <= size.Y + 0.001 && bounds.Size.Z <= size.Z + 0.001,
                "Hazard model does not match runtime dimensions: " + item.ObjectId);
        }
        foreach (var gun in items.Where(item => item.GameplayType == "wallWeapons"))
        {
            Require(!gun.GetNode<Node3D>("Art/WallDisplay/PurchasedGun").Visible, "Unpurchased wall gun model is visible");
            foreach (var layer in new[] { "ChalkOutline", "ChalkInset" })
                Require(Meshes(gun.GetNode("Art/WallDisplay/" + layer)).All(mesh => mesh.MaterialOverride is BaseMaterial3D
                    { ShadingMode: BaseMaterial3D.ShadingModeEnum.Unshaded }), "Chalk materials were lost when saving");
        }
        foreach (var perk in items.Where(item => item.GameplayType == "perkMachines"))
            Require(Meshes(perk).Any(mesh => Enumerable.Range(0, mesh.Mesh.GetSurfaceCount())
                .Any(index => mesh.GetSurfaceOverrideMaterial(index) is BaseMaterial3D { AlbedoTexture: not null })),
                "Perk paint was lost when saving");
        Require(items.Any(item => item.GameplayType == "playerSpawn" && item.HasNode("Art/SpawnBody")), "Missing human-sized player spawn guide");
        root.ShowPurchasedWallGuns = true; root.ShowSpawns = false; root.ShowRoutes = true; root.ShowCollision = true;
        MapPreview.ApplyVisibility(root);
        Require(items.Where(item => item.GameplayType == "wallWeapons").All(item => item.GetNode<Node3D>("Art/WallDisplay/PurchasedGun").Visible), "Purchased preview toggle failed");
        Require(items.Where(item => item.GameplayType is "playerSpawn" or "zombieSpawns").All(item => !item.Visible), "Spawn preview toggle failed");
        Require(items.Where(item => item.GameplayType is "routePoint" or "collision").All(item => item.Visible), "Linked guide toggle failed");
        root.ShowPurchasedWallGuns = false; root.ShowSpawns = true; root.ShowRoutes = false; root.ShowCollision = false;
        MapPreview.ApplyVisibility(root);
    }

    private static void CheckGameplayEdits(string id, JsonObject original, string source)
    {
        var candidate = (JsonObject)original.DeepClone();
        var root = MapScene.Build(candidate, source, previewAssets: false);
        try
        {
            ZombonzMapItem Find(string type) => MapPreview.ItemsIn(root).First(item => item.GameplayType == type);
            // Keep the synthetic edit small enough to remain a valid playable map while still proving linked transforms export.
            var move = new Vector3(0.15f, 0, 0.15f);
            var door = Find("doors"); var blocker = door.GetChildren().OfType<ZombonzMapItem>().Single();
            var oldBlocker = MapGameplay.MapTransform(blocker).Origin;
            door.Position += move; door.DoorLabel = "TEST"; door.Cost = 750; door.RequiresPower = true;
            var barrier = Find("barriers");
            var inside = barrier.GetChildren().OfType<ZombonzMapItem>().First(item => item.DataPath.EndsWith("/insidePoint"));
            var oldInside = MapGameplay.MapTransform(inside).Origin;
            var oldRoute = MapGameplay.MapTransform(barrier.GetChildren().OfType<ZombonzMapItem>().First(item => item.DataPath.Contains("/approachPath/"))).Origin;
            var oldBarrierId = barrier.ObjectId;
            barrier.Position += move; barrier.Width += 0.2f; barrier.ObjectId = "edited-barrier";
            var gun = Find("wallWeapons"); gun.Rotation += new Vector3(0, Mathf.Pi / 2, 0); gun.WeaponId = "mp40";
            var barrel = Find("hazards"); barrel.HazardKind = "jeep"; barrel.Rotation += new Vector3(0, 0.5f, 0);
            var mystery = Find("mysteryBoxes"); mystery.Position += move;
            var pap = Find("packAPunch"); pap.Rotation += new Vector3(0, Mathf.Pi / 2, 0); pap.Cost = 4500;
            MapGameplay.Prepare(root, candidate); // Refresh/migration must not detach linked children or reset edits.
            Require(MapGameplay.MapTransform(blocker).Origin.IsEqualApprox(oldBlocker + move), "Door blocker did not follow its door");
            Require(MapGameplay.MapTransform(inside).Origin.IsEqualApprox(oldInside + move), "Barrier inside point did not follow its anchor");
            MapDocument.WalkItems(candidate, root);
            Require(MapDocument.Boolean(candidate["gameplay"]!["doors"]![0]!["requiresPower"]), "Could not add a door's optional power requirement");
            Require(MapDocument.Number(candidate["gameplay"]!["packAPunch"]![0]!["cost"]) == 4500, "Could not edit an optional Pack-a-Punch cost");
            Require(MapDocument.Vector(MapDocument.AtPath(candidate, inside.DataPath)).IsEqualApprox(oldInside + move), "Nested point export used local coordinates");
            Require(MapDocument.Vector(candidate["gameplay"]!["barriers"]![0]!["approachPath"]![0]).IsEqualApprox(oldRoute + move), "Approach route did not follow barrier");
            var window = MapDocument.Items((JsonObject)candidate["presentation"]!, "windows").First(item => MapDocument.Text(item?["id"]) == barrier.ObjectId);
            Require(MapDocument.Vector(window).IsEqualApprox(barrier.Position), "Window presentation did not follow barrier");
            Require(MapDocument.Items((JsonObject)candidate["gameplay"]!, "zombieSpawns").All(item => MapDocument.Text(item?["barrierId"]) != oldBarrierId), "Barrier rename left invalid spawn references");
            // WalkItems writes each spawn marker's BarrierId back into JSON. Mirror the editor's post-export
            // synchronisation before a second synthetic walk so the renamed reference stays current.
            foreach (var spawnItem in MapPreview.ItemsIn(root).Where(item => item.GameplayType == "zombieSpawns"))
                spawnItem.BarrierId = MapDocument.Text(MapDocument.AtPath(candidate, spawnItem.DataPath)?["barrierId"]);
            Require(MapDocument.Vector(candidate["presentation"]!["boxCenter"]).IsEqualApprox(MapDocument.Vector(original["presentation"]!["boxCenter"]) + move), "Mystery box did not follow purchase point");
            if (candidate["gameplay"]!["mysteryBoxes"]![0]!["locations"] is JsonArray locations)
                Require(MapDocument.Vector(locations[0]!["position"]).IsEqualApprox(mystery.Position), "Initial box location retained its old purchase point");
            foreach (var body in mystery.GetChildren().OfType<ZombonzMapItem>().Where(item => item.Kind == "box"))
                Require(MapDocument.Vector(MapDocument.AtPath(candidate, body.DataPath)?["center"]).IsEqualApprox(MapDocument.Vector(MapDocument.AtPath(original, body.DataPath)?["center"]) + move), "Fixed mystery box body did not follow its lid");
            // Moving the fixed box body through dense nav links is correctly rejected by the semantic validator.
            // The transform behavior was proved above; restore it before testing a valid export of the other edits.
            mystery.Position -= move;
            MapDocument.WalkItems(candidate, root);
            CheckExport(id + "-gameplay", original, candidate, MapDocument.CollectChanges(original, candidate));

            // All add choices together exercise optional arrays, linked child paths, and presentation additions.
            var added = (JsonObject)original.DeepClone();
            var newRoot = MapScene.Build(added, source, previewAssets: false);
            try
            {
                foreach (var kind in MapScene.NewObjectKinds) MapScene.AddNew(newRoot, added, kind);
                var newCollision = MapPreview.ItemsIn(newRoot).First(item => item.Kind == "new" && item.DataPath.Contains("/collisionBoxes"));
                newCollision.Position += new Vector3(100, 0, 100); // a placeholder at player spawn would deliberately block navigation
                var newNavigation = MapPreview.ItemsIn(newRoot).First(item => item.Kind == "new" && item.GameplayType == "routePoint");
                var navigationNodes = (JsonArray)added["gameplay"]!["navigation"]!["nodes"]!;
                var navigationAnchor = (JsonObject)navigationNodes[0]!;
                newNavigation.Position = MapDocument.Vector(navigationAnchor["position"]);
                var second = MapScene.AddNew(newRoot, added, "Barrel");
                Require(second.ObjectId == "new-barrel-2", "Repeated additions did not get unique IDs");
                var newBarrier = MapPreview.ItemsIn(newRoot).First(item => item.Kind == "new" && item.GameplayType == "barriers");
                var secondBarrier = MapScene.AddNew(newRoot, added, "Barrier");
                MapScene.AddNew(newRoot, added, "Door");
                Require(newBarrier.GetChildren().OfType<ZombonzMapItem>().Count() == 3 && secondBarrier.GetChildren().OfType<ZombonzMapItem>().Count() == 3,
                    "Repeated barriers shared or stole route points");
                Require(MapPreview.ItemsIn(newRoot).Where(item => item.Kind == "new" && item.GameplayType == "doors")
                    .All(item => item.GetChildren().OfType<ZombonzMapItem>().Count() == 1), "Repeated doors shared blockers");
                newBarrier.Position += move; newBarrier.Rotation = new Vector3(0, Mathf.Pi / 2, 0);
                var pending = new List<MapDocument.Addition>();
                MapDocument.WalkItems(added, newRoot, pending);
                var authoredNavigation = ((JsonArray)added["gameplay"]!["navigation"]!["nodes"]!).OfType<JsonObject>()
                    .First(node => MapDocument.Text(node["id"]) == newNavigation.ObjectId);
                authoredNavigation["neighbors"] = new JsonArray(MapDocument.Text(navigationAnchor["id"]));
                ((JsonArray)navigationAnchor["neighbors"]!).Add(newNavigation.ObjectId);
                CheckExport(id + "-add-gameplay", original, added, MapDocument.CollectChanges(original, added));
                foreach (var entry in pending) { entry.Item.DataPath = entry.Path; entry.Item.Kind = entry.Kind; }
                var once = added.DeepClone(); MapDocument.WalkItems(added, newRoot);
                Require(JsonNode.DeepEquals(once, added), "Second export changed or duplicated new gameplay objects");
            }
            finally { newRoot.Free(); }
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
