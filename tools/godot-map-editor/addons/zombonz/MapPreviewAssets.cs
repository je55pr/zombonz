using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Godot;
using static MapDocument;

/// <summary>Imports the browser's original assets into an ignored, rebuildable Godot cache.</summary>
public sealed class MapPreviewAssets
{
    private const string Cache = "res://preview-cache/";
    private readonly JsonObject _manifest = Read(ZombonzMapPlugin.SourcePath("../../public/assets/environment/manifest.json"));
    private readonly Dictionary<string, PackedScene> _models = new();
    private readonly Dictionary<string, Texture2D> _textures = new();
    private readonly Dictionary<string, OrmMaterial3D> _materials = new();

    public MapPreviewAssets()
    {
        System.IO.Directory.CreateDirectory(ProjectSettings.GlobalizePath(Cache));
        System.IO.File.WriteAllText(ProjectSettings.GlobalizePath(Cache + ".gdignore"), "");
    }

    private static string PublicPath(string path)
    {
        var directory = ZombonzMapPlugin.SourcePath("../../public") + System.IO.Path.DirectorySeparatorChar;
        var resolved = System.IO.Path.GetFullPath(System.IO.Path.Combine(directory, path.TrimStart('/')));
        if (!resolved.StartsWith(directory, StringComparison.OrdinalIgnoreCase)) throw new IOException("Asset path leaves public/: " + path);
        if (!System.IO.File.Exists(resolved)) throw new FileNotFoundException("Preview asset missing: " + path);
        return resolved;
    }

    private static string CachePath(string source, string extension)
    {
        var hash = Convert.ToHexString(SHA256.HashData(System.IO.File.ReadAllBytes(source))).ToLowerInvariant();
        return Cache + "v1-" + Engine.GetVersionInfo()["major"].AsInt32() + "-" + Engine.GetVersionInfo()["minor"].AsInt32()
            + "-" + Engine.GetVersionInfo()["patch"].AsInt32() + "-" + hash + extension;
    }

    private static T Save<T>(T resource, string path) where T : Resource
    {
        var result = ResourceSaver.Save(resource, path, ResourceSaver.SaverFlags.Compress);
        if (result != Error.Ok) throw new IOException("Could not cache preview: " + result);
        return ResourceLoader.Load<T>(path) ?? throw new IOException("Could not read cached preview: " + path);
    }

    public PackedScene Model(string asset)
    {
        if (_models.TryGetValue(asset, out var cached)) return cached;
        var source = PublicPath("/assets/props/" + asset + "/model.glb");
        var path = CachePath(source, ".scn");
        if (System.IO.File.Exists(ProjectSettings.GlobalizePath(path))) cached = ResourceLoader.Load<PackedScene>(path);
        else
        {
            using var importer = new GltfDocument();
            using var state = new GltfState();
            var result = importer.AppendFromFile(source, state);
            if (result != Error.Ok) throw new IOException($"Could not import {asset}: {result}");
            var scene = importer.GenerateScene(state);
            if (scene is null) throw new IOException("Empty model: " + asset);
            try
            {
                using var packed = new PackedScene();
                if (packed.Pack(scene) != Error.Ok) throw new IOException("Could not pack model: " + asset);
                cached = Save(packed, path);
            }
            finally { scene.Free(); }
        }
        return _models[asset] = cached ?? throw new IOException("Invalid model cache: " + asset);
    }

    private Texture2D Texture(string asset)
    {
        if (_textures.TryGetValue(asset, out var cached)) return cached;
        var source = PublicPath(asset);
        var path = CachePath(source, ".res");
        if (System.IO.File.Exists(ProjectSettings.GlobalizePath(path))) cached = ResourceLoader.Load<Texture2D>(path);
        else
        {
            using var image = Image.LoadFromFile(source) ?? throw new IOException("Could not decode texture: " + asset);
            image.Resize(1024, 1024, Image.Interpolation.Lanczos);
            image.GenerateMipmaps();
            cached = Save(ImageTexture.CreateFromImage(image), path);
        }
        return _textures[asset] = cached ?? throw new IOException("Invalid texture cache: " + asset);
    }

    public OrmMaterial3D Material(string look)
    {
        if (_materials.TryGetValue(look, out var cached)) return cached;
        var maps = _manifest["materials"]?[look] ?? throw new IOException("Unknown surface look: " + look);
        return _materials[look] = new OrmMaterial3D
        {
            ResourceName = look, AlbedoTexture = Texture(Text(maps["basecolor"])),
            NormalEnabled = true, NormalTexture = Texture(Text(maps["normal"])), NormalScale = 0.65f,
            OrmTexture = Texture(Text(maps["arm"])), Metallic = 1, Roughness = 1,
            AOEnabled = true, TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic
        };
    }

    public StandardMaterial3D Decal(string asset)
    {
        var maps = _manifest["decals"]?[asset]?["maps"] ?? throw new IOException("Unknown decal: " + asset);
        // The opacity map is separate in the browser pack; combine it for Godot's albedo alpha.
        var colorPath = PublicPath(Text(maps["basecolor"]));
        var alphaPath = PublicPath(Text(maps["opacity"]));
        var alphaHash = Convert.ToHexString(SHA256.HashData(System.IO.File.ReadAllBytes(alphaPath))).ToLowerInvariant();
        var path = CachePath(colorPath, "-" + alphaHash + "-decal.res");
        Texture2D texture;
        if (System.IO.File.Exists(ProjectSettings.GlobalizePath(path))) texture = ResourceLoader.Load<Texture2D>(path);
        else
        {
            using var color = Image.LoadFromFile(colorPath);
            using var alpha = Image.LoadFromFile(alphaPath);
            color.Resize(1024, 1024); alpha.Resize(1024, 1024);
            color.Convert(Image.Format.Rgba8);
            for (var y = 0; y < color.GetHeight(); y++)
                for (var x = 0; x < color.GetWidth(); x++)
                {
                    var pixel = color.GetPixel(x, y); pixel.A = alpha.GetPixel(x, y).R;
                    color.SetPixel(x, y, pixel);
                }
            color.GenerateMipmaps();
            texture = Save(ImageTexture.CreateFromImage(color), path);
        }
        return new StandardMaterial3D { AlbedoTexture = texture, AlbedoColor = new Color(1, 1, 1, 0.65f),
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha, Roughness = 1, CullMode = BaseMaterial3D.CullModeEnum.Disabled };
    }

    public static Aabb Bounds(Node3D model)
    {
        Aabb? bounds = null;
        void Visit(Node node, Transform3D transform)
        {
            if (node is Node3D spatial) transform *= spatial.Transform;
            if (node is MeshInstance3D mesh && mesh.Mesh is not null)
            {
                var box = transform * mesh.GetAabb();
                bounds = bounds is null ? box : bounds.Value.Merge(box);
            }
            foreach (var child in node.GetChildren()) Visit(child, transform);
        }
        Visit(model, Transform3D.Identity);
        return bounds ?? throw new IOException("Model has no meshes");
    }

    public Node3D Prop(string asset, Vector3 size)
    {
        var model = Model(asset).Instantiate<Node3D>();
        try
        {
            if (asset == "crowbar") model.RotateX(Mathf.Pi / 2);
            var bounds = Bounds(model);
            var fit = size / bounds.Size;
            var scale = Math.Min(fit.X, Math.Min(fit.Y, fit.Z));
            if (!float.IsFinite(scale) || scale <= 0) throw new IOException("Invalid model bounds: " + asset);
            var centered = new Node3D { Name = "CenteredModel", Position = new Vector3(-bounds.GetCenter().X, -bounds.Position.Y, -bounds.GetCenter().Z) };
            centered.AddChild(model);
            var preview = new Node3D { Name = "Art", Scale = Vector3.One * scale };
            preview.AddChild(centered);
            return preview;
        }
        catch { model.Free(); throw; }
    }

    public static string Look(JsonObject box, ZombonzMapItem item)
    {
        var explicitLook = Text(box["look"]);
        if (explicitLook.Length > 0) return explicitLook;
        if (item.Position.X < -8 && item.Material == "wall") return "cave-rock";
        if (item.Position.X < -8 && item.Material == "floor") return "dirt";
        if (item.Material != "wall") return Role(item.Material);
        var size = item.BaseSize * item.Scale.Abs();
        if (size.Y > 2 && Math.Max(size.X, size.Z) > 2.4) return "broken-plaster-brick";
        if (size.Y < 0.5) return Math.Min(size.X, size.Z) > 1.5 ? "weathered-concrete-a" : "old-planks";
        return "weathered-concrete-a";
    }

    public static string Role(string role) => role switch
    {
        "floor" or "upperFloor" => "cracked-concrete-floor", "stair" => "weathered-concrete-b",
        "barrier" => "splintered-wood", "metal" => "rusted-metal", _ => "weathered-concrete-a"
    };

    public static float LookScale(string look) => look switch
    {
        "broken-plaster-brick" => 4, "peeling-paint-wall" or "forest-floor" => 3,
        "dirty-tiles" => 1.2f, "cobblestone" or "old-linoleum" => 2.5f,
        "old-planks" or "old-wood-floor" => 1.5f, _ => 2
    };

    public static ArrayMesh ProjectUvs(Mesh mesh, Vector3 center, float scale, Vector3? sizeScale = null)
    {
        var result = new ArrayMesh();
        for (var surface = 0; surface < mesh.GetSurfaceCount(); surface++)
        {
            var arrays = mesh.SurfaceGetArrays(surface);
            var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var normals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
            var uvs = new Vector2[vertices.Length];
            for (var i = 0; i < vertices.Length; i++)
            {
                var point = vertices[i] * (sizeScale ?? Vector3.One) + center;
                // Godot's image origin is at the top; the browser flips texture images on decode.
                uvs[i] = new Vector2((Math.Abs(normals[i].X) > 0.5 ? point.Z : point.X) / scale,
                    -(Math.Abs(normals[i].Y) > 0.5 ? point.Z : point.Y) / scale);
            }
            arrays[(int)Mesh.ArrayType.TexUV] = uvs;
            // Recalculate tangents for the projected UVs rather than keeping the box's old basis.
            arrays[(int)Mesh.ArrayType.Tangent] = default(Variant);
            using var tool = new SurfaceTool();
            var temporary = new ArrayMesh();
            temporary.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            tool.CreateFrom(temporary, 0); tool.GenerateTangents(); tool.Commit(result);
        }
        return result;
    }
}
