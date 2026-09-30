using Godot;

/// <summary>Optional visual check with the real renderer, separate from the headless smoke tests.</summary>
public partial class PreviewCapture : Node
{
    public override async void _Ready()
    {
        try
        {
            var output = OS.GetCmdlineUserArgs().FirstOrDefault() ?? OS.GetUserDataDir();
            System.IO.Directory.CreateDirectory(output);
            var viewport = new SubViewport { Size = new Vector2I(1280, 800), OwnWorld3D = true,
                RenderTargetUpdateMode = SubViewport.UpdateMode.Always, Msaa3D = Viewport.Msaa.Msaa4X };
            AddChild(viewport);
            if (OS.GetCmdlineUserArgs().Contains("--gameplay"))
            {
                foreach (var gallery in new[] { "hazards", "entries", "machines" })
                {
                    var source = "../../src/maps/data/" + (gallery == "machines" ? "asylum" : "bunker") + ".v1.json";
                    var document = MapDocument.Read(ZombonzMapPlugin.SourcePath(source));
                    var root = MapScene.Build(document, source);
                    if (gallery == "hazards") { MapScene.AddNew(root, document, "Truck"); MapPreview.Refresh(root, document); }
                    viewport.AddChild(root);
                    root.GetNode<Node3D>("Geometry").Visible = false; root.GetNode<Node3D>("Props").Visible = false;
                    foreach (var mesh in root.GetNode("Preview").GetChildren().OfType<MeshInstance3D>()) mesh.Visible = false;
                    var items = MapPreview.ItemsIn(root).ToArray();
                    foreach (var item in items) item.Visible = false;
                    var types = gallery == "hazards" ? new[] { "barrel", "jeep", "truck" }
                        : gallery == "entries" ? new[] { "doors", "barriers", "wallWeapons", "playerSpawn" }
                        : new[] { "perkMachines", "mysteryBoxes", "packAPunch" };
                    for (var index = 0; index < types.Length; index++)
                    {
                        var type = types[index];
                        var item = items.First(item => gallery == "hazards" ? item.GameplayType == "hazards" && item.HazardKind == type : item.GameplayType == type);
                        item.Visible = true; item.Position = new Vector3((index - (types.Length - 1) / 2f) * 3.8f, type == "wallWeapons" ? 1 : 0, 0);
                        item.Rotation = Vector3.Zero;
                        if (type == "perkMachines") item.Position += Vector3.Up;
                        if (type == "mysteryBoxes") item.GetNode<Node3D>("Art").Position = Vector3.Zero;
                        if (type == "wallWeapons")
                        {
                            var wall = new MeshInstance3D { Mesh = new BoxMesh { Size = new Vector3(2.5f, 2.8f, 0.12f) }, Position = item.Position + new Vector3(0, 0.4f, -0.07f),
                                MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color(0.32f, 0.31f, 0.27f) } };
                            root.AddChild(wall);
                        }
                    }
                    root.AddChild(new MeshInstance3D { Mesh = new PlaneMesh { Size = new Vector2(40, 40) },
                        MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color(0.24f, 0.26f, 0.28f) } });
                    var camera = new Camera3D { Fov = 60, Current = true, Position = new Vector3(7, 5, 13) };
                    root.AddChild(camera); camera.LookAt(new Vector3(0, 1, 0));
                    for (var frame = 0; frame < 12; frame++) await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    using var capture = viewport.GetTexture().GetImage();
                    var path = System.IO.Path.Combine(output, "godot-gameplay-" + gallery + ".png");
                    if (capture.SavePng(path) != Error.Ok) throw new IOException("Could not capture " + path);
                    GD.Print(path); root.Free();
                }
                GetTree().Quit(); return;
            }
            foreach (var id in new[] { "bunker", "asylum" })
            {
                var source = $"../../src/maps/data/{id}.v1.json";
                var document = MapDocument.Read(ZombonzMapPlugin.SourcePath(source));
                var root = MapScene.Build(document, source);
                viewport.AddChild(root);
                root.GetNode<Node3D>("Gameplay").Visible = false;
                var camera = new Camera3D { Fov = 65, Current = true };
                root.AddChild(camera);
                if (id == "bunker")
                {
                    camera.Position = new Vector3(2.3f, 1.5f, -1.5f);
                    camera.LookAt(new Vector3(2.3f, 0.65f, -2.9f));
                }
                else
                {
                    var bed = MapPreview.ItemsIn(root).First(item => item.Asset == "hospital-bed");
                    camera.Position = bed.Position + new Vector3(3, 1.6f, 3);
                    camera.LookAt(bed.Position + new Vector3(0, 0.6f, 0));
                }
                for (var i = 0; i < 12; i++) await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                using var image = viewport.GetTexture().GetImage();
                var path = System.IO.Path.Combine(output, "godot-preview-" + id + ".png");
                if (image.SavePng(path) != Error.Ok) throw new IOException("Could not capture " + path);
                GD.Print(path); root.Free();
            }
            GetTree().Quit();
        }
        catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
