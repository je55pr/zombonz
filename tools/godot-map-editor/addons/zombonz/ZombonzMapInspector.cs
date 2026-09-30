using Godot;

[Tool]
public partial class ZombonzMapInspector : EditorInspectorPlugin
{
    public override bool _CanHandle(GodotObject @object) => @object is ZombonzMapItem;

    public override void _ParseBegin(GodotObject @object)
    {
        if (@object is not ZombonzMapItem item) return;
        var hint = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        hint.Text = item.Kind switch
        {
            "new" => "New map object. Set a unique ID and relevant fields, then export.",
            "box" => "Move or scale this box in the 3D view. The source path is " + item.DataPath,
            "prop" => "Move, rotate, or scale this prop. Asset and ID are exported.",
            _ => "Move this marker in the 3D view. Related fields below are exported where applicable."
        };
        AddCustomControl(hint);
    }
}
