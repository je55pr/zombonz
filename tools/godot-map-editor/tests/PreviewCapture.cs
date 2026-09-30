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
