"""Export the authored Safe Haven high-rise as web-ready desktop/mobile GLBs.

The source .blend is treated as immutable: this script re-opens it for each
variant, performs all layout/LOD work in memory, and never saves the Blender
file. Run with Blender, not the system Python:

  blender --background --python tools/export_haven_loft.py
"""

from __future__ import annotations

import os
import math
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


SOURCE = Path(
    os.environ.get(
        "YOURNOTES_LOFT_BLEND",
        r"C:\Users\HP\Downloads\01_cozy_city_loft_all_assets.blend",
    )
)
OUTPUT_DIR = Path(
    os.environ.get(
        "YOURNOTES_LOFT_OUTPUT",
        r"C:\Users\HP\Documents\YourNotes\public\haven-assets\cozy_city_loft",
    )
)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def ensure_object_mode() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def make_material(
    name: str,
    color: tuple[float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.5,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 1.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if emission:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def apply_modifiers(obj: bpy.types.Object, *, subdivision_level: int | None = None) -> None:
    """Bake modifiers before joining so non-active objects keep their detail."""
    ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        if modifier.type == "SUBSURF" and subdivision_level is not None:
            modifier.levels = subdivision_level
            modifier.render_levels = subdivision_level
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except RuntimeError:
            # Armatures and a few library-authored helper modifiers are not
            # applicable in a background context. glTF will evaluate them.
            pass
    obj.select_set(False)


def join_objects(objects: list[bpy.types.Object], name: str) -> bpy.types.Object | None:
    objects = [obj for obj in objects if obj and obj.name in bpy.context.scene.objects]
    if not objects:
        return None
    if len(objects) == 1:
        objects[0].name = name
        objects[0].data.name = f"{name}_Mesh"
        return objects[0]
    ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = f"{name}_Mesh"
    return joined


def decimate(obj: bpy.types.Object | None, ratio: float) -> None:
    if not obj or ratio >= 0.999:
        return
    modifier = obj.modifiers.new("Safe Haven LOD", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    apply_modifiers(obj)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    mins = Vector((float("inf"),) * 3)
    maxs = Vector((float("-inf"),) * 3)
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            mins = Vector(tuple(min(a, b) for a, b in zip(mins, point)))
            maxs = Vector(tuple(max(a, b) for a, b in zip(maxs, point)))
    return mins, maxs


def place_workstation_chair() -> None:
    root = bpy.data.objects.get("ROOT_LOUNGE_CHAIR")
    if not root:
        raise RuntimeError("ROOT_LOUNGE_CHAIR was not found in the authored loft")
    meshes = [obj for obj in root.children_recursive if obj.type == "MESH"]
    mins, maxs = world_bounds(meshes)
    center = (mins + maxs) * 0.5

    # The source chair is already rotated toward the desk, but sits to its
    # right. Translate its measured world bounds so the chair is centered on
    # the laptop, with its back safely in front of the desk edge.
    target = Vector((-5.25, -0.20, center.z))
    root.location.x += target.x - center.x
    root.location.y += target.y - center.y
    bpy.context.view_layer.update()

    mins, maxs = world_bounds(meshes)
    print(
        "CHAIR",
        f"root={tuple(round(v, 4) for v in root.location)}",
        f"bounds={tuple(round(v, 4) for v in mins)}..{tuple(round(v, 4) for v in maxs)}",
    )


def add_box(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    size: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    bevel: float = 0.02,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for old_collection in list(obj.users_collection):
        old_collection.objects.unlink(obj)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    if bevel:
        modifier = obj.modifiers.new("Machined edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def build_laptop(mobile: bool) -> None:
    aluminum = make_material(
        "Laptop Aluminum", (0.065, 0.071, 0.082), metallic=0.84, roughness=0.24
    )
    keys_material = make_material(
        "Laptop Keys", (0.012, 0.014, 0.019), metallic=0.08, roughness=0.38
    )
    trackpad_material = make_material(
        "Laptop Trackpad", (0.12, 0.13, 0.15), metallic=0.68, roughness=0.28
    )
    screen_material = make_material(
        "Laptop Screen",
        (0.012, 0.025, 0.06),
        metallic=0.1,
        roughness=0.14,
        emission=(0.025, 0.12, 0.25),
        emission_strength=1.35,
    )

    collection = bpy.data.collections.get("ASSET_LAPTOP")
    if not collection:
        collection = bpy.data.collections.new("ASSET_LAPTOP")
        bpy.context.scene.collection.children.link(collection)

    x, y, z = -5.25, 0.82, 1.18
    chassis = [
        add_box(collection, "Laptop_Base", (x, y, z), (0.88, 0.58, 0.055), aluminum, bevel=0.03),
        add_box(collection, "Laptop_Hinge", (x, y + 0.29, z + 0.065), (0.66, 0.035, 0.06), aluminum, bevel=0.014),
        add_box(collection, "Laptop_Display_Lid", (x, y + 0.31, z + 0.34), (0.88, 0.045, 0.56), aluminum, bevel=0.03),
    ]
    trackpad = add_box(
        collection,
        "Laptop_Trackpad",
        (x, y - 0.12, z + 0.031),
        (0.32, 0.20, 0.009),
        trackpad_material,
        bevel=0.009,
    )
    # A dedicated full-UV screen plane lets the runtime lofi workstation
    # texture map 1:1. A beveled cube atlas only exposed a tiny fragment of
    # the texture on its front face, reading as a blank blue rectangle.
    bpy.ops.mesh.primitive_plane_add(
        size=2,
        location=(x, y + 0.282, z + 0.34),
        rotation=(math.pi / 2, 0, 0),
    )
    display = bpy.context.object
    display.name = "Laptop_Display"
    display.scale = (0.395, 0.225, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for old_collection in list(display.users_collection):
        old_collection.objects.unlink(display)
    collection.objects.link(display)
    display.data.materials.append(screen_material)

    keys: list[bpy.types.Object] = []
    rows, columns = (5, 11) if mobile else (5, 12)
    spacing_x = 0.068 if mobile else 0.062
    start_x = x - spacing_x * (columns - 1) / 2
    for row in range(rows):
        for column in range(columns):
            keys.append(
                add_box(
                    collection,
                    f"Laptop_Key_{row:02d}_{column:02d}",
                    (start_x + column * spacing_x, y + 0.012 + row * 0.058, z + 0.035),
                    (0.050, 0.041, 0.012),
                    keys_material,
                    # A crisp keycap is still dimensional at Haven camera
                    # distance. Beveling every key multiplies the keyboard to
                    # ~13k vertices for no visible benefit.
                    bevel=0.0,
                )
            )

    for obj in chassis + [trackpad, display] + keys:
        apply_modifiers(obj)
    join_objects(chassis, "Laptop_Chassis")
    join_objects(keys, "Laptop_Keyboard")


def build_lounge_styling(mobile: bool) -> None:
    """Add small authored-scale props to the otherwise empty round table.

    These are real mesh objects in the exported GLB (not screen-space cards):
    a ceramic tea mug with a separate coffee surface and two stacked books.
    They give both lounge cameras a close foreground story while adding only a
    few hundred vertices to the phone scene.
    """
    collection = bpy.data.collections.get("SAFE_HAVEN_LOUNGE_DETAILS")
    if not collection:
        collection = bpy.data.collections.new("SAFE_HAVEN_LOUNGE_DETAILS")
        bpy.context.scene.collection.children.link(collection)

    ceramic = make_material(
        "Lounge Speckled Ceramic", (0.44, 0.20, 0.12), metallic=0.0, roughness=0.62
    )
    coffee = make_material(
        "Coffee Surface", (0.035, 0.012, 0.006), metallic=0.0, roughness=0.3
    )
    book_cloth = make_material(
        "Lounge Book Cloth", (0.18, 0.09, 0.16), metallic=0.0, roughness=0.86
    )
    book_paper = make_material(
        "Lounge Book Paper", (0.68, 0.54, 0.39), metallic=0.0, roughness=0.94
    )

    # Round table top is at z ~= 1.11 in Blender coordinates.
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=16 if mobile else 24,
        radius=0.105,
        depth=0.21,
        location=(0.17, 4.18, 1.225),
    )
    mug_body = bpy.context.object
    mug_body.name = "Lounge_Tea_Mug_Body"
    for old_collection in list(mug_body.users_collection):
        old_collection.objects.unlink(mug_body)
    collection.objects.link(mug_body)
    mug_body.data.materials.append(ceramic)
    bevel = mug_body.modifiers.new("Ceramic rim", "BEVEL")
    bevel.width = 0.018
    bevel.segments = 2

    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.072,
        minor_radius=0.017,
        major_segments=12 if mobile else 18,
        minor_segments=6 if mobile else 8,
        location=(0.275, 4.18, 1.225),
        rotation=(math.pi / 2, 0, 0),
    )
    mug_handle = bpy.context.object
    mug_handle.name = "Lounge_Tea_Mug_Handle"
    for old_collection in list(mug_handle.users_collection):
        old_collection.objects.unlink(mug_handle)
    collection.objects.link(mug_handle)
    mug_handle.data.materials.append(ceramic)

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=16 if mobile else 24,
        radius=0.084,
        depth=0.008,
        location=(0.17, 4.18, 1.334),
    )
    coffee_surface = bpy.context.object
    coffee_surface.name = "Lounge_Tea_Surface"
    for old_collection in list(coffee_surface.users_collection):
        old_collection.objects.unlink(coffee_surface)
    collection.objects.link(coffee_surface)
    coffee_surface.data.materials.append(coffee)

    lower_book = add_box(
        collection,
        "Lounge_Book_Lower",
        (0.65, 4.18, 1.145),
        (0.46, 0.32, 0.055),
        book_cloth,
        bevel=0.018,
    )
    lower_book.rotation_euler.z = math.radians(-7)
    upper_book = add_box(
        collection,
        "Lounge_Book_Upper",
        (0.62, 4.18, 1.205),
        (0.39, 0.27, 0.048),
        book_paper,
        bevel=0.015,
    )
    upper_book.rotation_euler.z = math.radians(5)

    for obj in (mug_body, mug_handle, coffee_surface, lower_book, upper_book):
        apply_modifiers(obj)
    join_objects([mug_body, mug_handle], "Lounge_Tea_Mug")


def build_soft_furnishings(mobile: bool) -> None:
    """Add a low-cost woven throw and a real floor practical to the lounge.

    Both are exported geometry. The throw breaks up the supplied sofa's broad
    silhouette, while the lamp supplies a vertical warm focal point between
    the sofa and hearth without resorting to a screen-space overlay.
    """
    collection = bpy.data.collections.get("SAFE_HAVEN_SOFT_DETAILS")
    if not collection:
        collection = bpy.data.collections.new("SAFE_HAVEN_SOFT_DETAILS")
        bpy.context.scene.collection.children.link(collection)

    throw_material = make_material(
        "Rust Woven Throw", (0.42, 0.105, 0.055), metallic=0.0, roughness=0.94
    )
    dark_brass = make_material(
        "Floor Lamp Dark Brass", (0.095, 0.055, 0.035), metallic=0.72, roughness=0.32
    )
    shade_material = make_material(
        "Floor Lamp Linen Shade", (0.47, 0.20, 0.105), metallic=0.0, roughness=0.84
    )
    bulb_material = make_material(
        "Floor Lamp Warm Bulb",
        (1.0, 0.47, 0.16),
        metallic=0.0,
        roughness=0.2,
        emission=(1.0, 0.24, 0.045),
        emission_strength=4.0,
    )

    columns = 8 if mobile else 12
    rows = 7 if mobile else 10
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for row in range(rows + 1):
        v = row / rows
        for column in range(columns + 1):
            u = column / columns
            # Keep the throw intentionally narrower than a sofa blanket and
            # taper it as it falls. Wavy side and bottom edges stop the mesh
            # reading like a rigid board from the wide cameras.
            width = 0.84 - v * 0.07
            side_wave = math.sin(v * math.pi * 3.0) * 0.018
            edge_weight = abs(u - 0.5) * 2.0
            x = 0.15 + (u - 0.5) * width + side_wave * edge_weight
            # Sofa back is nearest the open room at y ~= 1.87. A shallow,
            # deterministic wave gives the textile a soft broken silhouette.
            y = 1.825 - 0.034 * math.sin(u * math.pi * 4.0 + v * 2.2)
            bottom_ripple = (v ** 5) * 0.026 * math.sin(u * math.pi * 7.0)
            z = 1.43 - v * 0.74 + 0.022 * math.sin(u * math.pi * 5.0) + bottom_ripple
            vertices.append((x, y, z))
    stride = columns + 1
    for row in range(rows):
        for column in range(columns):
            index = row * stride + column
            faces.append((index, index + 1, index + stride + 1, index + stride))
    mesh = bpy.data.meshes.new("Lounge_Throw_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    throw = bpy.data.objects.new("Lounge_Rust_Woven_Throw", mesh)
    collection.objects.link(throw)
    throw.data.materials.append(throw_material)
    solidify = throw.modifiers.new("Textile thickness", "SOLIDIFY")
    solidify.thickness = 0.018
    bevel = throw.modifiers.new("Soft textile edge", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 1 if mobile else 2
    apply_modifiers(throw)

    # Modeled floor practical beside the sofa. The visible bulb has a named
    # emissive material that city.js flickers with the other warm bulbs.
    lamp_x, lamp_y = 2.45, 2.35
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=16 if mobile else 24,
        radius=0.24,
        depth=0.12,
        location=(lamp_x, lamp_y, 0.08),
    )
    base = bpy.context.object
    base.name = "Lounge_Floor_Lamp_Base"
    for old_collection in list(base.users_collection):
        old_collection.objects.unlink(base)
    collection.objects.link(base)
    base.data.materials.append(dark_brass)

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=12 if mobile else 18,
        radius=0.032,
        depth=1.43,
        location=(lamp_x, lamp_y, 0.82),
    )
    stem = bpy.context.object
    stem.name = "Lounge_Floor_Lamp_Stem"
    for old_collection in list(stem.users_collection):
        old_collection.objects.unlink(stem)
    collection.objects.link(stem)
    stem.data.materials.append(dark_brass)

    bpy.ops.mesh.primitive_cone_add(
        vertices=16 if mobile else 24,
        radius1=0.34,
        radius2=0.19,
        depth=0.40,
        location=(lamp_x, lamp_y, 1.58),
    )
    shade = bpy.context.object
    shade.name = "Lounge_Floor_Lamp_Linen_Shade"
    for old_collection in list(shade.users_collection):
        old_collection.objects.unlink(shade)
    collection.objects.link(shade)
    shade.data.materials.append(shade_material)

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=12 if mobile else 18,
        ring_count=6 if mobile else 9,
        radius=0.095,
        location=(lamp_x, lamp_y, 1.50),
    )
    bulb = bpy.context.object
    bulb.name = "Lounge_Floor_Lamp_Warm_Bulb"
    for old_collection in list(bulb.users_collection):
        old_collection.objects.unlink(bulb)
    collection.objects.link(bulb)
    bulb.data.materials.append(bulb_material)

    for obj in (base, stem, shade, bulb):
        apply_modifiers(obj)
    join_objects([base, stem], "Lounge_Floor_Lamp_Metal")


def build_wall_styling(mobile: bool) -> None:
    """Fill the two authored blank walls with modeled, lofi-scale decor."""
    collection = bpy.data.collections.get("SAFE_HAVEN_WALL_DETAILS")
    if not collection:
        collection = bpy.data.collections.new("SAFE_HAVEN_WALL_DETAILS")
        bpy.context.scene.collection.children.link(collection)

    walnut = make_material(
        "Wall Decor Walnut", (0.12, 0.055, 0.038), metallic=0.0, roughness=0.68
    )
    cork = make_material(
        "Workstation Cork", (0.43, 0.23, 0.12), metallic=0.0, roughness=0.93
    )
    cream = make_material(
        "Pinned Note Cream", (0.72, 0.58, 0.39), metallic=0.0, roughness=0.95
    )
    coral = make_material(
        "Pinned Note Coral", (0.58, 0.20, 0.16), metallic=0.0, roughness=0.92
    )
    sage = make_material(
        "Pinned Note Sage", (0.20, 0.38, 0.31), metallic=0.0, roughness=0.92
    )
    canvas = make_material(
        "Blue Hour Wall Art", (0.065, 0.08, 0.18), metallic=0.0, roughness=0.87
    )
    muted_gold = make_material(
        "Wall Art Muted Gold", (0.63, 0.36, 0.16), metallic=0.16, roughness=0.56
    )
    dusk_coral = make_material(
        "Wall Art Dusk Coral", (0.48, 0.16, 0.20), metallic=0.0, roughness=0.78
    )

    # Workstation pinboard: real frame, inset cork and dimensional note cards.
    # Left wall is x=-7.679; positive x offsets bring the decor into the room.
    add_box(
        collection,
        "Workstation_Pinboard_Frame",
        (-7.57, 0.83, 2.55),
        (0.12, 2.05, 1.28),
        walnut,
        bevel=0.035,
    )
    add_box(
        collection,
        "Workstation_Pinboard_Cork",
        (-7.48, 0.83, 2.55),
        (0.08, 1.84, 1.07),
        cork,
        bevel=0.018,
    )
    note_specs = (
        (0.22, 2.76, 0.30, 0.20, cream, -5),
        (0.73, 2.49, 0.36, 0.23, coral, 4),
        (1.17, 2.77, 0.29, 0.19, sage, -3),
        (1.43, 2.36, 0.25, 0.17, cream, 7),
        (0.47, 2.22, 0.27, 0.18, sage, 2),
    )
    for index, (y, z, width, height, material, degrees) in enumerate(note_specs):
        note = add_box(
            collection,
            f"Workstation_Pinned_Note_{index + 1}",
            (-7.425, y, z),
            (0.035, width, height),
            material,
            bevel=0.008,
        )
        note.rotation_euler.x = math.radians(degrees)

    # A relief triptych on the opposite wall catches the blue-hour and fire
    # light. The pieces are geometry, not a flat screen-space illustration.
    add_box(
        collection,
        "Lounge_Wall_Art_Frame",
        (7.57, 2.05, 2.66),
        (0.12, 2.2, 1.42),
        walnut,
        bevel=0.04,
    )
    add_box(
        collection,
        "Lounge_Wall_Art_Canvas",
        (7.48, 2.05, 2.66),
        (0.08, 1.98, 1.20),
        canvas,
        bevel=0.02,
    )
    relief_specs = (
        (1.38, 2.86, 0.82, 0.12, muted_gold, -24),
        (1.78, 2.51, 0.98, 0.14, dusk_coral, 18),
        (2.33, 2.86, 0.72, 0.11, muted_gold, 30),
        (2.72, 2.43, 0.76, 0.13, dusk_coral, -15),
    )
    for index, (y, z, width, height, material, degrees) in enumerate(relief_specs):
        relief = add_box(
            collection,
            f"Lounge_Wall_Art_Relief_{index + 1}",
            (7.425, y, z),
            (0.035, width, height),
            material,
            bevel=0.012,
        )
        relief.rotation_euler.x = math.radians(degrees)

    # Apply inexpensive bevels before selection/export. These details remain
    # low-poly on both variants; their silhouette is the same on phone.
    for obj in list(collection.objects):
        if obj.type == "MESH":
            apply_modifiers(obj)


def group_authored_assets(mobile: bool) -> None:
    # Books retain six authored colour families. Baking before joining keeps
    # their gentle cover/page deformation, while six meshes replace 87 nodes.
    book_objects = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and any(c.name == "ASSET_BOOKS" for c in obj.users_collection)
    ]
    book_groups: dict[str, list[bpy.types.Object]] = defaultdict(list)
    for obj in book_objects:
        apply_modifiers(obj, subdivision_level=0)
        material_name = obj.material_slots[0].material.name if obj.material_slots and obj.material_slots[0].material else "Default"
        book_groups[material_name].append(obj)
    for index, objects in enumerate(book_groups.values()):
        joined = join_objects(objects, f"Loft_Books_{index + 1:02d}")
        decimate(joined, 0.15 if mobile else 0.42)

    # Chess pieces are detailed source meshes but never fill the screen.
    chess_objects = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and any(c.name == "ASSET_CHESS" for c in obj.users_collection)
    ]
    white = [obj for obj in chess_objects if "white" in obj.name.lower()]
    black = [obj for obj in chess_objects if "black" in obj.name.lower()]
    board = [obj for obj in chess_objects if obj not in white and obj not in black]
    for objects, name in ((white, "Chess_White_Pieces"), (black, "Chess_Black_Pieces"), (board, "Chess_Board")):
        for obj in objects:
            apply_modifiers(obj)
        joined = join_objects(objects, name)
        if name != "Chess_Board":
            decimate(joined, 0.15 if mobile else 0.32)

    # City geometry is already low-poly. Joining by semantic/material family
    # collapses roughly ninety draw nodes to two without reducing silhouettes.
    buildings = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.startswith("City_Building_")]
    windows = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.startswith("City_Window_")]
    join_objects(buildings, "City_Buildings")
    join_objects(windows, "City_Windows")

    # Target only expensive supplied props for mobile LOD. Every object stays
    # dimensional; the reductions remove detail below a phone pixel.
    prop_lods = (
        (
            ("Camera_01", 0.25),
            ("Camera_01_strap", 0.25),
            ("boombox", 0.35),
            ("sofa_03", 0.48),
            ("mid_century_lounge_chair", 0.48),
            ("Ukulele_01", 0.42),
        )
        if mobile
        else (
            ("Camera_01", 0.50),
            ("Camera_01_strap", 0.50),
            ("boombox", 0.72),
            ("sofa_03", 0.82),
            ("mid_century_lounge_chair", 0.86),
            ("Ukulele_01", 0.72),
        )
    )
    for name, ratio in prop_lods:
        obj = bpy.data.objects.get(name)
        if obj:
            apply_modifiers(obj, subdivision_level=0)
            decimate(obj, ratio)


def select_export_meshes() -> list[bpy.types.Object]:
    ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    selected: list[bpy.types.Object] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        if obj.name.startswith(("wdg_", "WGT-", "Rain_")):
            continue
        obj.select_set(True)
        selected.append(obj)
    if not selected:
        raise RuntimeError("No visible loft meshes were found")
    bpy.context.view_layer.objects.active = selected[0]
    return selected


def sanitize_materials_for_web() -> None:
    """Remove unused expensive material features before glTF serialization."""
    for material in bpy.data.materials:
        if not material.use_nodes or not material.node_tree:
            continue
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        if not bsdf:
            continue
        transmission = bsdf.inputs.get("Transmission Weight") or bsdf.inputs.get("Transmission")
        if transmission:
            transmission.default_value = 0.0


def export_variant(*, mobile: bool) -> Path:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    place_workstation_chair()
    build_laptop(mobile)
    build_lounge_styling(mobile)
    build_soft_furnishings(mobile)
    build_wall_styling(mobile)
    group_authored_assets(mobile)
    sanitize_materials_for_web()
    selected = select_export_meshes()
    mins, maxs = world_bounds(selected)
    vertex_count = sum(len(obj.data.vertices) for obj in selected)
    variant = "mobile" if mobile else "desktop"
    filename = "cozy_city_loft_mobile.glb" if mobile else "cozy_city_loft.glb"
    output = OUTPUT_DIR / filename
    print(
        f"EXPORTING {variant}: meshes={len(selected)} base_vertices={vertex_count} "
        f"bounds={tuple(round(v, 3) for v in mins)}..{tuple(round(v, 3) for v in maxs)}"
    )
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_animations=False,
        export_extras=True,
    )
    print(f"WROTE {output} ({output.stat().st_size} bytes)")
    return output


if __name__ == "__main__":
    export_variant(mobile=False)
    export_variant(mobile=True)
