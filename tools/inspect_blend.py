import bpy
import json
from pathlib import Path

out = {
    "scene": bpy.context.scene.name,
    "objects": [],
    "collections": [],
    "materials": [],
    "images": [],
}

for collection in bpy.data.collections:
    out["collections"].append({
        "name": collection.name,
        "objects": [obj.name for obj in collection.objects],
    })

for obj in bpy.context.scene.objects:
    out["objects"].append({
        "name": obj.name,
        "type": obj.type,
        "collection": [c.name for c in obj.users_collection],
        "location": [round(v, 4) for v in obj.location],
        "rotation": [round(v, 4) for v in obj.rotation_euler],
        "scale": [round(v, 4) for v in obj.scale],
        "dimensions": [round(v, 4) for v in obj.dimensions],
        "vertices": len(obj.data.vertices) if obj.type == "MESH" else 0,
        "materials": [slot.material.name for slot in obj.material_slots if slot.material],
    })

for material in bpy.data.materials:
    out["materials"].append({"name": material.name, "use_nodes": material.use_nodes})

for image in bpy.data.images:
    out["images"].append({
        "name": image.name,
        "filepath": image.filepath,
        "packed": bool(image.packed_file),
        "size": list(image.size),
    })

output = Path(bpy.path.abspath("//")) / "blend_inventory.json"
output.write_text(json.dumps(out, indent=2), encoding="utf-8")
print(f"WROTE {output}")
