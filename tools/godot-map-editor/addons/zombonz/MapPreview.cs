using System.Text.Json.Nodes;
using Godot;
using static MapDocument;

/// <summary>Presentation children are previews only: authoring handles remain the JSON source.</summary>
public static class MapPreview
{
    public static List<string> Refresh(ZombonzMapRoot root, JsonObject document)
    {
        var assets = new MapPreviewAssets();
        var warnings = new List<string>();
        foreach (var item in ItemsIn(root).ToArray())
        {
            var isProp = item.Kind == "prop" || item.DataPath == "new/presentation/props";
            var isBox = item.DataPath.StartsWith("presentation/greybox/") || item.DataPath.StartsWith("presentation/scenery/")
                || item.DataPath == "new/presentation/greybox";
            if (!isProp && !isBox) continue;
            // Keep the old view until a complete replacement is ready (missing assets stay editable).
            Node3D? art = null;
            try
            {
                if (isProp)
                {
                    art = assets.Prop(item.Asset, item.BaseSize * item.Scale.Abs());
                    // The JSON stores a target size; the browser fits uniformly instead of stretching.
                    // Compensate the authoring handle's scale without changing the handle itself.
                    art.Scale /= item.Scale;
                }
                else
                {
                    var box = AtPath(document, item.DataPath) as JsonObject ?? new JsonObject();
                    art = Box(assets, item, box);
                }
                foreach (var child in item.GetChildren())
                    if (child is MeshInstance3D || child.Name == "Art") { item.RemoveChild(child); child.Free(); }
                item.AddChild(art); Own(root, art);
            }
            catch (Exception error) { art?.Free(); warnings.Add(item.Name + ": " + error.Message); }
        }
        var previous = root.GetNodeOrNull("Preview");
        if (previous is not null) { root.RemoveChild(previous); previous.Free(); }
        var extras = new Node3D { Name = "Preview" };
        root.AddChild(extras); extras.Owner = root;
        // Neutral authoring light keeps surfaces readable; the browser remains the game-lighting preview.
        extras.AddChild(new WorldEnvironment { Name = "AuthoringEnvironment", Environment = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Color, BackgroundColor = new Color(0.13f, 0.15f, 0.18f),
            AmbientLightSource = Godot.Environment.AmbientSource.Color, AmbientLightColor = Colors.White, AmbientLightEnergy = 0.8f
        } });
        extras.AddChild(new DirectionalLight3D { Name = "AuthoringLight", RotationDegrees = new Vector3(-55, -25, 0), LightEnergy = 1 });
        var presentation = (JsonObject)document["presentation"]!;
        foreach (var node in Items(presentation, "decals"))
        {
            if (node is not JsonObject decal) continue;
            try
            {
                extras.AddChild(new MeshInstance3D { Name = "Decal" + extras.GetChildCount(), Position = Vector(decal),
                    Rotation = new Vector3(0, (float)Number(decal["yaw"]), 0),
                    Mesh = new QuadMesh { Size = new Vector2((float)Number(decal["width"]), (float)Number(decal["height"])) },
                    MaterialOverride = assets.Decal(Text(decal["asset"])) });
            }
            catch (Exception error) { warnings.Add("Decal: " + error.Message); }
        }
        foreach (var node in Items(presentation, "prisms"))
        {
            if (node is not JsonObject prism) continue;
            try
            {
                var look = MapPreviewAssets.Role(Text(prism["material"], "wall"));
                extras.AddChild(new MeshInstance3D { Name = "Prism" + extras.GetChildCount(), Mesh = MapPreviewAssets.ProjectUvs(Prism(prism), Vector3.Zero,
                    MapPreviewAssets.LookScale(look)), MaterialOverride = assets.Material(look) });
            }
            catch (Exception error) { warnings.Add("Prism: " + error.Message); }
        }
        Own(root, extras);
        return warnings.Distinct().ToList();
    }

    private static ArrayMesh Prism(JsonObject prism)
    {
        var points = ((JsonArray)prism["points"]!).Select(point => new Vector2((float)Number(point![0]), (float)Number(point[1]))).ToArray();
        var indices = Geometry2D.TriangulatePolygon(points);
        if (indices.Length == 0) throw new IOException("Invalid prism polygon");
        var bottom = (float)Number(prism["bottom"]); var top = (float)Number(prism["top"]);
        using var surface = new SurfaceTool(); surface.Begin(Mesh.PrimitiveType.Triangles);
        void Face(Vector3 a, Vector3 b, Vector3 c, Vector3 normal)
        {
            // Godot front faces wind clockwise when viewed from outside.
            if ((b - a).Cross(c - a).Dot(normal) > 0) (b, c) = (c, b);
            surface.SetNormal(normal); surface.SetUV(Vector2.Zero);
            surface.AddVertex(a); surface.AddVertex(b); surface.AddVertex(c);
        }
        Vector3 PointAt(int index, float height) => new(points[index].X, height, points[index].Y);
        for (var i = 0; i < indices.Length; i += 3)
        {
            Face(PointAt(indices[i], top), PointAt(indices[i + 1], top), PointAt(indices[i + 2], top), Vector3.Up);
            Face(PointAt(indices[i], bottom), PointAt(indices[i + 1], bottom), PointAt(indices[i + 2], bottom), Vector3.Down);
        }
        var clockwise = Geometry2D.IsPolygonClockwise(points);
        for (var i = 0; i < points.Length; i++)
        {
            var next = (i + 1) % points.Length; var edge = points[next] - points[i];
            var normal = new Vector3(edge.Y, 0, -edge.X).Normalized() * (clockwise ? -1 : 1);
            Face(PointAt(i, bottom), PointAt(next, bottom), PointAt(next, top), normal);
            Face(PointAt(i, bottom), PointAt(next, top), PointAt(i, top), normal);
        }
        return surface.Commit();
    }

    private static Node3D Box(MapPreviewAssets assets, ZombonzMapItem item, JsonObject box)
    {
        var art = new Node3D { Name = "Art", Visible = box["visible"] is null || Boolean(box["visible"]) };
        try
        {
            var look = MapPreviewAssets.Look(box, item);
            var slabLook = Text(box["underside"], look);
            var shape = Text(box["shape"]);
            Mesh mesh = shape.Length > 0
                ? new PrismMesh { Size = shape == "gableX" ? new Vector3(item.BaseSize.Z, item.BaseSize.Y, item.BaseSize.X) : item.BaseSize, LeftToRight = 0.5f }
                : new BoxMesh { Size = item.BaseSize };
            // PrismMesh's ridge runs along Z. Bake the rotation before UV projection for gableX.
            if (shape == "gableX") mesh = RotateMesh(mesh, new Basis(Vector3.Up, Mathf.Pi / 2));
            art.AddChild(new MeshInstance3D { Name = "Surface", Mesh = MapPreviewAssets.ProjectUvs(mesh, item.Position, MapPreviewAssets.LookScale(slabLook), item.Scale.Abs()),
                MaterialOverride = assets.Material(slabLook) });
            if (slabLook != look)
            {
                var offset = new Vector3(0, item.BaseSize.Y / 2 + 0.002f, 0);
                art.AddChild(new MeshInstance3D { Name = "WalkedOnSurface", Position = offset,
                    Mesh = MapPreviewAssets.ProjectUvs(new PlaneMesh { Size = new Vector2(item.BaseSize.X, item.BaseSize.Z) }, item.Position + offset * item.Scale.Abs(), MapPreviewAssets.LookScale(look), item.Scale.Abs()),
                    MaterialOverride = assets.Material(look) });
            }
            return art;
        }
        catch { art.Free(); throw; }
    }

    private static ArrayMesh RotateMesh(Mesh mesh, Basis basis)
    {
        var arrays = mesh.SurfaceGetArrays(0);
        arrays[(int)Mesh.ArrayType.Vertex] = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array().Select(point => basis * point).ToArray();
        arrays[(int)Mesh.ArrayType.Normal] = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array().Select(normal => basis * normal).ToArray();
        arrays[(int)Mesh.ArrayType.Tangent] = default(Variant);
        var result = new ArrayMesh(); result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays); return result;
    }

    public static IEnumerable<ZombonzMapItem> ItemsIn(Node node)
    {
        if (node is ZombonzMapItem item) yield return item;
        foreach (var child in node.GetChildren()) foreach (var descendant in ItemsIn(child)) yield return descendant;
    }

    private static void Own(ZombonzMapRoot root, Node node)
    {
        if (node != root) node.Owner = root;
        // Cached GLBs are scene instances; their internal ownership must remain intact.
        if (!string.IsNullOrEmpty(node.SceneFilePath)) return;
        foreach (var child in node.GetChildren()) Own(root, child);
    }
}
