using System.Text.Json.Nodes;
using Godot;

[Tool]
public partial class ZombonzMapPlugin : EditorPlugin
{
    private EditorDock? _dock;
    private VBoxContainer _controls = null!;
    private LineEdit _sourceInput = null!;
    private Label _message = null!;
    private OptionButton _addKind = null!;
    private ZombonzMapInspector? _inspector;
    private readonly List<(CheckButton Button, Func<ZombonzMapRoot, bool> Read)> _previewToggles = new();

    public override void _EnterTree()
    {
        _controls = new VBoxContainer();
        _controls.AddChild(new Label { Text = "Versioned map authoring" });
        _sourceInput = new LineEdit { Text = "../../src/maps/data/bunker.v1.json", TooltipText = "JSON file relative to the Godot project" };
        _controls.AddChild(_sourceInput);
        AddButton("Import map into scene", ImportMap);
        AddButton("Refresh models and textures", RefreshPreview);
        AddPreviewToggle("Labels", root => root.ShowLabels, (root, value) => root.ShowLabels = value);
        AddPreviewToggle("Spawn guides", root => root.ShowSpawns, (root, value) => root.ShowSpawns = value);
        AddPreviewToggle("Entry routes", root => root.ShowRoutes, (root, value) => root.ShowRoutes = value);
        AddPreviewToggle("Collision boxes", root => root.ShowCollision, (root, value) => root.ShowCollision = value);
        AddPreviewToggle("Purchased wall guns", root => root.ShowPurchasedWallGuns, (root, value) => root.ShowPurchasedWallGuns = value);
        SceneChanged += SyncPreviewToggles;
        _addKind = new OptionButton();
        foreach (var kind in MapScene.NewObjectKinds) _addKind.AddItem(kind);
        _controls.AddChild(_addKind);
        AddButton("Add selected object", AddNewItem);
        AddButton("Validate open map", ValidateOpenMap);
        AddButton("Export open map", () => { ExportMap(); });
        AddButton("Export and play in browser", ExportAndPlay);
        _message = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        _controls.AddChild(_message);
        _dock = new EditorDock { Title = "Zombonz Maps", DefaultSlot = EditorDock.DockSlot.RightUl,
            AvailableLayouts = EditorDock.DockLayout.Vertical | EditorDock.DockLayout.Floating };
        _dock.AddChild(_controls);
        AddDock(_dock);
        _inspector = new ZombonzMapInspector();
        AddInspectorPlugin(_inspector);
        // Opt-in CLI check executes imports in the same editor context as the dock buttons.
        if (OS.GetEnvironment("ZOMBONZ_EDITOR_SMOKE_TEST") == "1")
        {
            try { SmokeTest.RunChecks(); }
            catch (Exception error) { GD.PushError(error.ToString()); }
        }
    }

    public override void _ExitTree()
    {
        SceneChanged -= SyncPreviewToggles;
        _previewToggles.Clear();
        if (_inspector is not null) { RemoveInspectorPlugin(_inspector); _inspector.Dispose(); _inspector = null; }
        if (_dock is not null) { RemoveDock(_dock); _dock.QueueFree(); _dock = null; }
    }

    private void AddPreviewToggle(string text, Func<ZombonzMapRoot, bool> read, Action<ZombonzMapRoot, bool> write)
    {
        var button = new CheckButton { Text = text, Disabled = true, TooltipText = "Editor preview only; does not change gameplay." };
        button.Toggled += value =>
        {
            if (EditorInterface.Singleton.GetEditedSceneRoot() is not ZombonzMapRoot root) return;
            write(root, value); MapPreview.ApplyVisibility(root); EditorInterface.Singleton.MarkSceneAsUnsaved();
        };
        _controls.AddChild(button); _previewToggles.Add((button, read));
    }

    private void SyncPreviewToggles(Node scene)
    {
        foreach (var (button, read) in _previewToggles)
        {
            button.Disabled = scene is not ZombonzMapRoot;
            if (scene is ZombonzMapRoot root) button.SetPressedNoSignal(read(root));
        }
    }

    private void AddButton(string text, Action action)
    {
        var button = new Button { Text = text };
        button.Pressed += () =>
        {
            try { action(); }
            catch (Exception error) { _message.Text = error.Message; GD.PushError(error.ToString()); }
        };
        _controls.AddChild(button);
    }

    public static string SourcePath(string relativePath) => System.IO.Path.GetFullPath(
        System.IO.Path.Combine(ProjectSettings.GlobalizePath("res://"), relativePath));

    private ZombonzMapRoot OpenRoot() => EditorInterface.Singleton.GetEditedSceneRoot() as ZombonzMapRoot
        ?? throw new InvalidOperationException("Open a Zombonz map scene first.");
    private JsonObject OpenDocument() => MapDocument.Read(SourcePath(OpenRoot().SourceFile));

    private void ImportMap()
    {
        var source = _sourceInput.Text.Trim();
        var document = MapDocument.Read(SourcePath(source));
        var errors = MapDocument.Validate(document);
        if (errors.Count > 0) throw new InvalidDataException("Import failed: " + errors[0]);
        var root = MapScene.Build(document, source);
        try
        {
            var id = MapDocument.Text(document["metadata"]!["id"]);
            var scenePath = $"res://maps/{id}.tscn";
            System.IO.Directory.CreateDirectory(SourcePath("maps"));
            using var packed = new PackedScene();
            var result = packed.Pack(root);
            if (result == Error.Ok) result = ResourceSaver.Save(packed, scenePath);
            if (result != Error.Ok) throw new IOException("Could not save scene: " + result);
            if (EditorInterface.Singleton.GetCurrentPath() == scenePath) EditorInterface.Singleton.ReloadSceneFromPath(scenePath);
            else EditorInterface.Singleton.OpenSceneFromPath(scenePath);
            _message.Text = "Imported " + MapDocument.Text(document["metadata"]!["name"]) + ". Edit nodes in the 3D scene, then export.";
        }
        finally { root.Free(); }
    }

    private void AddNewItem()
    {
        var root = OpenRoot();
        var kind = _addKind.GetItemText(_addKind.Selected);
        var item = MapScene.AddNew(root, OpenDocument(), kind);
        if (kind == "Collision box") root.ShowCollision = true;
        MapPreview.Refresh(root, OpenDocument());
        SyncPreviewToggles(root);
        EditorInterface.Singleton.EditNode(item);
        EditorInterface.Singleton.MarkSceneAsUnsaved();
        _message.Text = "Added " + kind + ". Set its ID and fields in the Inspector, then export.";
    }

    private void RefreshPreview()
    {
        var warnings = MapPreview.Refresh(OpenRoot(), OpenDocument());
        EditorInterface.Singleton.MarkSceneAsUnsaved();
        _message.Text = warnings.Count == 0 ? "Models and textures refreshed. Scene edits are preserved."
            : "Preview incomplete:\n" + string.Join('\n', warnings.Take(8));
    }

    private void ValidateOpenMap()
    {
        var document = OpenDocument();
        MapDocument.WalkItems(document, OpenRoot());
        var errors = MapDocument.Validate(document);
        _message.Text = errors.Count == 0 ? "Map valid." : "Validation failed:\n" + string.Join('\n', errors.Take(8));
    }

    private bool ExportMap()
    {
        var root = OpenRoot();
        var document = OpenDocument();
        var original = document.DeepClone();
        var pending = new List<MapDocument.Addition>();
        MapDocument.WalkItems(document, root, pending);
        var errors = MapDocument.Validate(document);
        if (errors.Count > 0) { _message.Text = "Export stopped:\n" + string.Join('\n', errors.Take(8)); return false; }
        var changes = MapDocument.CollectChanges(original, document);
        if (changes.Count > 0)
        {
            var editsPath = System.IO.Path.Combine(OS.GetUserDataDir(), "zombonz-map-edits.json");
            System.IO.File.WriteAllText(editsPath, changes.ToJsonString());
            var output = new Godot.Collections.Array();
            var result = OS.Execute("node", new[] { SourcePath("../../scripts/apply-map-edits.mjs"), SourcePath(root.SourceFile), editsPath }, output, true);
            if (result != 0) { _message.Text = "Export failed. Node.js is required. " + OutputText(output); return false; }
        }
        foreach (var addition in pending) { addition.Item.DataPath = addition.Path; addition.Item.Kind = addition.Kind; }
        // Keep existing scenes in sync with references updated when a barrier ID changes.
        foreach (var item in MapPreview.ItemsIn(root).Where(item => item.GameplayType == "zombieSpawns"))
            item.BarrierId = MapDocument.Text(MapDocument.AtPath(document, item.DataPath)?["barrierId"]);
        EditorInterface.Singleton.SaveScene();
        _message.Text = $"Exported {changes.Count} change(s) to {SourcePath(root.SourceFile)}";
        return true;
    }

    private static string OutputText(Godot.Collections.Array output) => string.Join('\n', output.Select(value => value.ToString()));

    private async void ExportAndPlay()
    {
        // Signal callbacks cannot await an Action; handle asynchronous errors here as well.
        try
        {
            if (!ExportMap()) return;
            var repository = SourcePath("../..");
            var output = new Godot.Collections.Array();
            if (OS.Execute("node", new[] { System.IO.Path.Combine(repository, "scripts/generate-bootstrap-manifest.mjs") }, output, true) != 0)
                throw new InvalidOperationException("Could not refresh game assets: " + OutputText(output));
            var vite = System.IO.Path.Combine(repository, "node_modules/vite/bin/vite.js");
            if (OS.CreateProcess("node", new[] { vite, repository, "--host", "127.0.0.1", "--strictPort" }, false) < 0)
                throw new InvalidOperationException("Could not start Vite. Run npm run dev in the repository, then open the preview URL.");
            await ToSignal(GetTree().CreateTimer(2), SceneTreeTimer.SignalName.Timeout);
            var id = MapDocument.Text(OpenDocument()["metadata"]!["id"]);
            OS.ShellOpen("http://127.0.0.1:5173/?preview=start&map=" + Uri.EscapeDataString(id));
        }
        catch (Exception error) { _message.Text = error.Message; GD.PushError(error.ToString()); }
    }
}
