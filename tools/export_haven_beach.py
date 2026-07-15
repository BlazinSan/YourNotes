"""Build and export the original Safe Haven moonlit beach retreat.

The scene is project-authored geometry so its redistribution provenance is
unambiguous.  It deliberately spends its polygon budget on silhouettes that
matter at normal viewing distance: layered thatch, curved palms, tactile cloth,
sculpted sand, weathered timber, lanterns and lived-in shoreline details.  The
ocean, sky, stars and small practical-light effects remain realtime surfaces.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", choices=("desktop", "mobile"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(raw)


ARGS = parse_args()
MOBILE = ARGS.variant == "mobile"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def material(
    name: str,
    colour: tuple[float, float, float],
    roughness: float = 0.72,
    metallic: float = 0.0,
    emissive: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    item = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    item.use_nodes = True
    shader = item.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*colour, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    colour_input = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
    strength_input = shader.inputs.get("Emission Strength")
    if colour_input:
        colour_input.default_value = (0.0, 0.0, 0.0, 1.0)
    if strength_input:
        strength_input.default_value = 0.0
    if emissive:
        if colour_input:
            colour_input.default_value = (*emissive, 1.0)
        if strength_input:
            strength_input.default_value = emission_strength
    transmission = shader.inputs.get("Transmission Weight") or shader.inputs.get("Transmission")
    if transmission:
        transmission.default_value = 0.0
    return item


MAT = {}


def make_materials() -> None:
    MAT.update(
        sand=material("Moonlit Sand", (0.72, 0.52, 0.32), 0.96),
        wet=material("Wet Moonlit Sand", (0.21, 0.25, 0.25), 0.6),
        wood=material("Tropical Hut Wood", (0.31, 0.12, 0.045), 0.78),
        wood_light=material("Sunwashed Deck Wood", (0.49, 0.25, 0.105), 0.82),
        rattan=material("Woven Rattan", (0.43, 0.235, 0.095), 0.86),
        thatch=material("Thatched Palm Roof", (0.43, 0.24, 0.085), 0.98),
        textile=material("Beach Textile Rug", (0.24, 0.10, 0.23), 0.94),
        teal=material("Deep Teal Cushion", (0.035, 0.19, 0.19), 0.9),
        coral=material("Sunset Coral Cushion", (0.46, 0.105, 0.075), 0.88),
        cream=material("Natural Linen", (0.72, 0.61, 0.47), 0.96),
        bark=material("Palm Trunk Bark", (0.34, 0.15, 0.055), 0.96),
        leaf=material("Palm Leaves", (0.025, 0.24, 0.105), 0.88),
        ground_leaf=material("Tropical Ground Leaves", (0.03, 0.27, 0.13), 0.9),
        brass=material("Aged Brass", (0.42, 0.19, 0.055), 0.38, 0.68),
        iron=material("Dark Iron", (0.035, 0.028, 0.03), 0.5, 0.55),
        glass=material("Smoky Glass", (0.24, 0.20, 0.16), 0.18),
        bulb=material("Warm Bulb", (1.0, 0.36, 0.08), 0.26, 0.0, (1.0, 0.20, 0.025), 4.0),
        ceramic=material("Glazed Ceramic", (0.12, 0.31, 0.32), 0.28),
        stone=material("Tide-worn Stone", (0.085, 0.095, 0.105), 0.94),
        shell=material("Seashell", (0.69, 0.47, 0.35), 0.75),
        paper=material("Book Paper", (0.68, 0.57, 0.43), 0.92),
        book=material("Book Cover", (0.25, 0.055, 0.06), 0.72),
    )


def finish_mesh(obj: bpy.types.Object, mat: bpy.types.Material, bevel: float = 0.0) -> bpy.types.Object:
    obj.data.materials.append(mat)
    if bevel > 0:
        modifier = obj.modifiers.new("Hand-finished edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2 if MOBILE else 3
    return obj


def cube(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.035,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat, bevel)


def cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    vertices: int | None = None,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices or (10 if MOBILE else 16),
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, mat, bevel)


def sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=12 if MOBILE else 20,
        ring_count=8 if MOBILE else 12,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def torus(
    name: str,
    location: tuple[float, float, float],
    major_radius: float,
    minor_radius: float,
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=12 if MOBILE else 20,
        minor_segments=5 if MOBILE else 8,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def tapered_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius_bottom: float,
    radius_top: float,
    depth: float,
    mat: bpy.types.Material,
    vertices: int | None = None,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices or (10 if MOBILE else 16),
        radius1=radius_bottom,
        radius2=radius_top,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def soft_cushion(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    phase: float = 0.0,
) -> bpy.types.Object:
    """Make a rounded, subtly pinched fabric cushion without a box primitive."""
    longitude = 14 if MOBILE else 24
    latitude = 8 if MOBILE else 14
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    sx, sy, sz = scale
    for row in range(latitude + 1):
        v = -math.pi * 0.5 + math.pi * row / latitude
        cv = math.cos(v)
        sv = math.sin(v)
        for col in range(longitude):
            u = math.tau * col / longitude
            cu = math.cos(u)
            su = math.sin(u)
            # Superellipsoid profile: soft volume in the middle with a lightly
            # pinched edge seam and tiny asymmetry so it does not read as CAD.
            horizontal = math.copysign(abs(cv) ** 0.58, cv)
            x = sx * horizontal * math.copysign(abs(cu) ** 0.66, cu)
            y = sy * horizontal * math.copysign(abs(su) ** 0.66, su)
            edge = min(1.0, math.sqrt((x / max(sx, 1e-4)) ** 2 + (y / max(sy, 1e-4)) ** 2))
            puff = 1.0 - 0.10 * edge ** 3
            z = sz * math.copysign(abs(sv) ** 0.72, sv) * puff
            z += math.sin(u * 3.0 + phase) * math.sin(v * 2.0) * sz * 0.018
            vertices.append((x, y, z))
    for row in range(latitude):
        for col in range(longitude):
            nxt = (col + 1) % longitude
            a = row * longitude + col
            b = row * longitude + nxt
            c = (row + 1) * longitude + nxt
            d = (row + 1) * longitude + col
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    return obj


def create_grid_surface(
    name: str,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    cols: int,
    rows: int,
    mat: bpy.types.Material,
    wet: bool = False,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    uvs: list[tuple[float, float]] = []
    for row in range(rows + 1):
        v = row / rows
        y = y_min + (y_max - y_min) * v
        for col in range(cols + 1):
            u = col / cols
            x = x_min + (x_max - x_min) * u
            # Broad dunes plus small wind ripples.  Keeping several incommensurate
            # frequencies avoids the uniform brown sheet seen in the first pass.
            dune = math.sin(x * 0.19 + y * 0.13) * 0.13
            dune += math.sin(x * 0.43 - y * 0.31 + 1.2) * 0.045
            dune += math.sin(x * 1.32 + y * 0.42) * 0.014
            dune += math.sin(y * 2.45 + math.sin(x * 0.34) * 1.8) * 0.012
            shore_falloff = max(0.0, min(1.0, (y - 5.5) / 4.3))
            dune *= 1.0 - shore_falloff * 0.9
            dune -= max(0.0, y - 7.4) * 0.022
            if not wet:
                # A quiet line of alternating footprints guides the eye from
                # the lounge toward the pavilion.  They are true depressions in
                # the sand, not dark decals or floating meshes.
                for step, (foot_x, foot_y) in enumerate((
                    (0.15, -4.8), (-0.13, -4.1), (0.28, -3.35),
                    (-0.08, -2.62), (0.42, -1.88), (0.12, -1.16),
                )):
                    dx = (x - foot_x) / 0.23
                    dy = (y - foot_y) / 0.48
                    dune -= math.exp(-(dx * dx + dy * dy) * 2.1) * (0.038 + step * 0.001)
            if wet:
                dune += 0.006
            vertices.append((x, y, dune))
            uvs.append((u * 5.0, v * 3.0))
    stride = cols + 1
    for row in range(rows):
        for col in range(cols):
            a = row * stride + col
            faces.append((a, a + 1, a + stride + 1, a + stride))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def build_sand() -> None:
    create_grid_surface(
        "Sand_Beach_Sculpted", -23.0, 23.0, -10.0, 10.4,
        72 if MOBILE else 144, 36 if MOBILE else 72, MAT["sand"],
    )
    create_grid_surface(
        "Wet_Sand_Transition", -23.0, 23.0, 6.7, 10.4,
        56 if MOBILE else 112, 10 if MOBILE else 20, MAT["wet"], True,
    )


def build_hut() -> None:
    # Raised timber cabana: rounded posts, rope lashings, rafters and layered
    # thatch read as a believable coastal structure from all three cameras.
    for index in range(16):
        x = -9.55 + index * 0.52
        cube(f"Hut_Deck_Slat_{index:02}", (x, 1.25, 0.34), (0.235, 3.22, 0.085), MAT["wood_light"], 0.018)
    post_locations = ((-9.45, -1.65), (-1.85, -1.65), (-9.45, 4.25), (-1.85, 4.25))
    for post_index, (x, y) in enumerate(post_locations):
        tapered_cylinder(f"Hut_Post_{post_index}", (x, y, 2.24), 0.22, 0.165, 4.45, MAT["wood"], 14 if not MOBILE else 9)
        cylinder(f"Hut_Foot_{post_index}", (x, y, 0.08), 0.24, 0.8, MAT["wood"], bevel=0.018)
        for wrap in range(3):
            torus(f"Hut_Post_Rope_{post_index}_{wrap}", (x, y, 4.03 + wrap * 0.055), 0.19, 0.014, MAT["rattan"])

    for y in (-1.75, 4.35):
        cube(f"Hut_Roof_Beam_{y}", (-5.65, y, 4.34), (4.12, 0.13, 0.15), MAT["wood"], 0.025)
    for x in (-9.55, -1.75):
        cube(f"Hut_Side_Beam_{x}", (x, 1.3, 4.34), (0.13, 3.25, 0.15), MAT["wood"], 0.025)
    for rafter in range(7):
        x = -9.2 + rafter * 1.18
        cube(f"Hut_Rafter_{rafter}", (x, 1.3, 4.46), (0.075, 3.62, 0.09), MAT["wood"], 0.016)

    roof_angle = math.radians(20.9)
    cube("Thatched_Roof_Front_Base", (-5.65, -0.48, 4.90), (4.48, 1.95, 0.11), MAT["thatch"], 0.035, (roof_angle, 0.0, 0.0))
    cube("Thatched_Roof_Back_Base", (-5.65, 3.08, 4.90), (4.48, 1.95, 0.11), MAT["thatch"], 0.035, (-roof_angle, 0.0, 0.0))

    # Overlapping straw bundles break the slab silhouette and catch the warm
    # practical lighting.  Desktop gets denser rows; mobile keeps the same
    # authored form at about half the bundle count.
    row_count = 7 if MOBILE else 11
    strand_count = 18 if MOBILE else 30
    slope_length = 3.82
    strand_depth = slope_length / row_count * 1.34
    for side_name, side_sign in (("Front", -1.0), ("Back", 1.0)):
        rotation_x = math.radians(110.9) * (-side_sign)
        for row in range(row_count):
            t = (row + 0.58) / row_count
            y = 1.3 + side_sign * slope_length * t
            z = 5.58 - 1.43 * t
            for strand in range(strand_count):
                x = -10.02 + strand * (8.74 / max(1, strand_count - 1))
                jitter = math.sin(strand * 2.17 + row * 1.31 + (0.4 if side_sign > 0 else 0.0))
                tapered_cylinder(
                    f"Roof_{side_name}_Straw_{row:02}_{strand:02}",
                    (x + jitter * 0.025, y + side_sign * jitter * 0.035, z - abs(jitter) * 0.018),
                    0.047, 0.021, strand_depth * (0.96 + jitter * 0.08), MAT["thatch"], 5,
                    rotation=(rotation_x, 0.0, 0.0),
                )
    ridge_segments = 14 if MOBILE else 24
    for index in range(ridge_segments):
        x = -9.92 + index * (8.55 / max(1, ridge_segments - 1))
        tapered_cylinder(
            f"Roof_Ridge_Bundle_{index:02}", (x, 1.3, 5.61), 0.11, 0.08, 0.52,
            MAT["thatch"], 7, rotation=(0.0, math.pi * 0.5, 0.0),
        )

    # Woven reed privacy screen and two shelves make the cabana intimate while
    # retaining the open ocean view.
    for index in range(16 if MOBILE else 26):
        y = -1.15 + index * (4.75 / max(1, (16 if MOBILE else 26) - 1))
        tapered_cylinder(f"Hut_Reed_Screen_{index:02}", (-9.18, y, 2.12), 0.035, 0.029, 2.85, MAT["rattan"], 7)
    for level in range(2):
        cube(f"Hut_Shelf_{level}", (-9.0, -0.2, 1.35 + level * 0.78), (0.3, 1.08, 0.06), MAT["wood_light"], 0.025)

    # Boardwalk and steps deliberately run toward the camera-left foreground.
    for index in range(9):
        y = -1.8 - index * 0.58
        z = 0.27 - index * 0.026
        cube(f"Boardwalk_Slat_{index:02}", (-5.7, y, z), (1.7, 0.24, 0.075), MAT["wood_light"], 0.025)
    for index in range(3):
        cube(f"Hut_Step_{index}", (-5.7, -3.78 - index * 0.48, 0.21 - index * 0.075), (1.72, 0.32, 0.09), MAT["wood"], 0.028)


def build_daybed_and_lounge() -> None:
    # Woven rattan daybed with visible rails and soft, irregular linen forms.
    cube("Daybed_Rattan_Base", (-5.9, 1.65, 0.72), (2.12, 0.9, 0.18), MAT["rattan"], 0.09)
    for x in (-7.87, -3.93):
        cylinder(f"Daybed_Frame_Side_{x}", (x, 1.65, 1.08), 0.07, 1.95, MAT["rattan"], 10, rotation=(math.pi / 2, 0.0, 0.0))
    for y in (0.82, 2.48):
        cylinder(f"Daybed_Frame_Front_{y}", (-5.9, y, 0.88), 0.07, 4.0, MAT["rattan"], 10, rotation=(0.0, math.pi / 2, 0.0))
    for rail in range(5):
        cylinder(
            f"Daybed_Back_Rail_{rail}", (-7.72, 1.65, 1.05 + rail * 0.31),
            0.045, 1.82, MAT["rattan"], 9, rotation=(math.pi / 2, 0.0, 0.0),
        )
    soft_cushion("Daybed_Seat_Cushion", (-5.72, 1.65, 1.06), (1.75, 0.72, 0.19), MAT["cream"], phase=0.8)
    soft_cushion("Daybed_Back_Cushion", (-7.47, 1.65, 1.55), (0.22, 0.68, 0.58), MAT["cream"], (0.0, math.radians(-5), 0.0), 1.4)
    soft_cushion("Daybed_Coral_Pillow", (-6.67, 1.27, 1.42), (0.46, 0.19, 0.43), MAT["coral"], (math.radians(5), math.radians(-8), math.radians(-9)), 2.1)
    soft_cushion("Daybed_Linen_Pillow", (-5.70, 1.92, 1.39), (0.42, 0.19, 0.39), MAT["cream"], (math.radians(-4), math.radians(8), math.radians(5)), 3.2)

    # Sand lounge: woven mat, floor cushions, and a low rattan tea table.
    cube("Beach_Woven_Mat", (3.25, 0.15, 0.12), (3.2, 2.35, 0.045), MAT["textile"], 0.035, (0.0, 0.0, math.radians(-4)))
    for index in range(10 if MOBILE else 16):
        y = -2.03 + index * (4.3 / max(1, (10 if MOBILE else 16) - 1))
        cube(f"Mat_Fringe_Left_{index}", (0.03, y, 0.12), (0.18, 0.025, 0.018), MAT["cream"], 0.01)
        cube(f"Mat_Fringe_Right_{index}", (6.47, y, 0.12), (0.18, 0.025, 0.018), MAT["cream"], 0.01)
    soft_cushion("Floor_Cushion_Teal", (5.18, 1.2, 0.43), (0.78, 0.82, 0.28), MAT["teal"], (0.0, 0.0, math.radians(8)), 0.7)
    soft_cushion("Floor_Cushion_Coral", (1.34, 1.3, 0.41), (0.73, 0.78, 0.26), MAT["coral"], (0.0, 0.0, math.radians(-12)), 1.9)
    soft_cushion("Floor_Cushion_Linen", (4.85, -1.12, 0.37), (0.62, 0.7, 0.22), MAT["cream"], (0.0, 0.0, math.radians(-8)), 3.0)

    table_x, table_y = 3.12, 0.1
    cylinder("Low_Rattan_Table_Top", (table_x, table_y, 0.76), 1.16, 0.16, MAT["rattan"], bevel=0.035)
    torus("Low_Rattan_Table_Woven_Rim", (table_x, table_y, 0.83), 1.05, 0.045, MAT["wood_light"])
    for angle in range(0, 360, 90):
        radians = math.radians(angle)
        cylinder(
            f"Low_Rattan_Table_Leg_{angle}",
            (table_x + math.cos(radians) * 0.72, table_y + math.sin(radians) * 0.72, 0.42),
            0.065, 0.66, MAT["wood"], 9, rotation=(math.sin(radians) * 0.13, math.cos(radians) * -0.13, 0.0),
        )

    # Ceramic mug with actual hollow rim and handle, plus book/tea tray.
    cylinder("Beach_Mug_Body", (2.54, -0.13, 1.02), 0.18, 0.34, MAT["ceramic"], 16 if not MOBILE else 10)
    torus("Beach_Mug_Rim", (2.54, -0.13, 1.19), 0.155, 0.025, MAT["ceramic"])
    torus("Beach_Mug_Handle", (2.34, -0.13, 1.06), 0.115, 0.025, MAT["ceramic"], (math.pi / 2, 0.0, 0.0))
    cube("Beach_Book", (3.56, 0.14, 0.92), (0.42, 0.58, 0.055), MAT["book"], 0.025, (0.0, 0.0, math.radians(-8)))
    cube("Beach_Book_Pages", (3.56, 0.14, 0.975), (0.38, 0.54, 0.026), MAT["paper"], 0.016, (0.0, 0.0, math.radians(-8)))


def build_lantern(name: str, x: float, y: float, z: float, hanging: bool = False) -> None:
    cylinder(f"{name}_Base", (x, y, z), 0.19, 0.10, MAT["iron"], 12 if not MOBILE else 8, bevel=0.018)
    cylinder(f"{name}_Glass", (x, y, z + 0.29), 0.14, 0.43, MAT["glass"], 14 if not MOBILE else 9)
    cylinder(f"{name}_Cap", (x, y, z + 0.54), 0.13, 0.10, MAT["brass"], 12 if not MOBILE else 8, bevel=0.015)
    sphere(f"{name}_Warm_Bulb", (x, y, z + 0.29), (0.065, 0.065, 0.115), MAT["bulb"])
    for angle in range(0, 360, 90):
        radians = math.radians(angle)
        cylinder(
            f"{name}_Bar_{angle}",
            (x + math.cos(radians) * 0.135, y + math.sin(radians) * 0.135, z + 0.29),
            0.012, 0.45, MAT["iron"], 5,
        )
    torus(f"{name}_Handle", (x, y, z + 0.57), 0.16, 0.014, MAT["iron"], (math.pi / 2, 0.0, 0.0))
    if hanging:
        cylinder(f"{name}_Chain", (x, y, z + 1.1), 0.018, 1.02, MAT["iron"], 6)


def build_practicals_and_decor() -> None:
    build_lantern("Table_Lantern", 3.38, -0.2, 0.92)
    build_lantern("Hut_Hanging_Lantern", -3.05, -1.1, 3.05, True)
    build_lantern("Boardwalk_Lantern", -5.65, -5.15, 0.24)

    # Books, camera, shells, driftwood make the scene lived-in rather than staged.
    cube("Hut_Shelf_Book_A", (-8.62, -0.42, 1.46), (0.16, 0.32, 0.34), MAT["book"], 0.018, (0.0, 0.0, math.radians(4)))
    cube("Hut_Shelf_Book_B", (-8.62, 0.2, 1.41), (0.18, 0.26, 0.3), MAT["teal"], 0.018, (0.0, 0.0, math.radians(-5)))
    cylinder("Tea_Pot_Body", (3.06, 0.55, 1.05), 0.18, 0.3, MAT["ceramic"], 12)
    sphere("Tea_Pot_Lid", (3.06, 0.55, 1.22), (0.11, 0.11, 0.055), MAT["ceramic"])
    for index, (x, y, s) in enumerate(((-2.4, 6.4, 0.3), (7.2, 6.8, 0.22), (-10.7, 7.1, 0.28), (10.4, 7.45, 0.2))):
        sphere(f"Shell_{index}", (x, y, 0.11), (s, s * 0.52, s * 0.24), MAT["shell"])
    cylinder("Driftwood_Main", (8.2, 5.5, 0.22), 0.13, 3.1, MAT["wood"], 8, rotation=(0.0, math.radians(72), math.radians(9)))
    cylinder("Driftwood_Branch", (7.65, 5.35, 0.42), 0.07, 1.4, MAT["wood"], 7, rotation=(math.radians(52), math.radians(18), math.radians(-35)))


def build_palm(name: str, x: float, y: float, height: float, lean_x: float, lean_y: float, phase: float) -> None:
    rings = 12 if MOBILE else 24
    sides = 10 if MOBILE else 16
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    centres: list[Vector] = []
    for ring in range(rings + 1):
        t = ring / rings
        centre = Vector((x + lean_x * (t ** 1.35), y + lean_y * (t ** 1.35), 0.08 + height * t))
        centre.x += math.sin(t * math.pi) * 0.13 * math.sin(phase)
        centre.y += math.sin(t * math.pi) * 0.11 * math.cos(phase)
        centres.append(centre)
        radius = (0.34 - t * 0.17) * (1.0 + math.sin(t * math.pi * 11.0 + phase) * 0.055)
        for side in range(sides):
            angle = side / sides * math.tau
            vertices.append((centre.x + math.cos(angle) * radius, centre.y + math.sin(angle) * radius, centre.z))
    for ring in range(rings):
        for side in range(sides):
            a = ring * sides + side
            b = ring * sides + (side + 1) % sides
            c = (ring + 1) * sides + (side + 1) % sides
            d = (ring + 1) * sides + side
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(f"Palm_{name}_Trunk_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    trunk = bpy.data.objects.new(f"Palm_{name}_Trunk", mesh)
    bpy.context.scene.collection.objects.link(trunk)
    trunk.data.materials.append(MAT["bark"])
    for polygon in trunk.data.polygons:
        polygon.use_smooth = True

    # Raised leaf-scar rings catch grazing moonlight and keep the trunk from
    # reading as a plain tapered pole.  Rings follow the authored centreline.
    scar_count = 9 if MOBILE else 17
    for scar in range(1, scar_count + 1):
        t = scar / (scar_count + 1)
        centre = centres[min(rings, round(t * rings))]
        radius = (0.34 - t * 0.17) * 1.035
        torus(
            f"Palm_{name}_BarkScar_{scar:02}", tuple(centre), radius, 0.018 if MOBILE else 0.022,
            MAT["bark"],
        )

    crown = centres[-1]
    frond_count = 8 if MOBILE else 11
    segments = 9 if MOBILE else 15
    for frond in range(frond_count):
        angle = frond / frond_count * math.tau + phase
        length = 3.05 + 0.58 * math.sin(frond * 1.7 + phase)
        direction = Vector((math.cos(angle), math.sin(angle), 0.0))
        side_vec = Vector((-math.sin(angle), math.cos(angle), 0.0))
        verts: list[tuple[float, float, float]] = []
        frond_faces: list[tuple[int, ...]] = []
        path: list[Vector] = []
        for segment in range(segments + 1):
            t = segment / segments
            centre = crown + direction * length * t
            # Broad arch with a natural droop at the tip.  Alternating crown
            # heights layer the silhouette instead of creating a flat star.
            lift = 0.56 + 0.18 * math.sin(frond * 2.31 + phase)
            centre.z += lift * math.sin(t * math.pi) - (1.05 + 0.24 * math.cos(frond * 1.47)) * (t ** 1.68)
            centre += side_vec * math.sin(t * math.pi) * 0.10 * math.sin(frond * 1.91 + phase)
            path.append(centre)
            rachis_width = 0.055 * (1.0 - t * 0.72)
            verts.append(tuple(centre - side_vec * rachis_width))
            verts.append(tuple(centre + side_vec * rachis_width))
        for segment in range(segments):
            a = segment * 2
            frond_faces.append((a, a + 2, a + 3, a + 1))

        # Each paired leaflet is a curved six-vertex blade, not a single spike.
        # Width, overlap and droop create the layered silhouette in the user's
        # moonlit references while remaining inexpensive after joining.
        for segment in range(1, segments):
            t = segment / segments
            centre = path[segment]
            leaflet_length = (math.sin(t * math.pi) ** 0.62) * 0.88 + 0.16
            leaflet_width = 0.055 + leaflet_length * 0.075
            for sign in (-1.0, 1.0):
                outward = side_vec * sign
                base = centre + outward * 0.025
                middle = centre + outward * leaflet_length * 0.55 - direction * (0.035 + t * 0.055)
                tip = centre + outward * leaflet_length - direction * (0.10 + t * 0.16)
                middle.z -= 0.035 + t * 0.055
                tip.z -= 0.14 + t * 0.18
                tangent = direction * leaflet_width
                start = len(verts)
                verts.extend((
                    tuple(base - tangent * 0.62), tuple(base + tangent * 0.62),
                    tuple(middle - tangent), tuple(middle + tangent),
                    tuple(tip - tangent * 0.12), tuple(tip + tangent * 0.12),
                ))
                frond_faces.append((start, start + 2, start + 3, start + 1))
                frond_faces.append((start + 2, start + 4, start + 5, start + 3))
        frond_mesh = bpy.data.meshes.new(f"Palm_{name}_Leaf_{frond:02}_Mesh")
        frond_mesh.from_pydata(verts, [], frond_faces)
        frond_mesh.update()
        for polygon in frond_mesh.polygons:
            polygon.use_smooth = True
        leaf = bpy.data.objects.new(f"Palm_{name}_Leaf_{frond:02}", frond_mesh)
        bpy.context.scene.collection.objects.link(leaf)
        leaf.data.materials.append(MAT["leaf"])

    # Three upright spear leaves prevent the crown from looking hollow.
    for spear in range(2 if MOBILE else 3):
        angle = phase + spear * math.tau / 3.0
        direction = Vector((math.cos(angle), math.sin(angle), 0.0))
        points = []
        width = 0.18
        for segment in range(6):
            t = segment / 5
            centre = crown + direction * (0.45 + t * 1.25)
            centre.z += 0.25 + math.sin(t * math.pi) * 0.72 - t * 0.18
            side_vec = Vector((-direction.y, direction.x, 0.0))
            local_width = width * math.sin((t + 0.05) * math.pi) + 0.018
            points.extend((tuple(centre - side_vec * local_width), tuple(centre + side_vec * local_width)))
        spear_faces = [(i * 2, (i + 1) * 2, (i + 1) * 2 + 1, i * 2 + 1) for i in range(5)]
        spear_mesh = bpy.data.meshes.new(f"Palm_{name}_Spear_{spear}_Mesh")
        spear_mesh.from_pydata(points, [], spear_faces)
        spear_mesh.update()
        spear_obj = bpy.data.objects.new(f"Palm_{name}_Leaf_Spear_{spear}", spear_mesh)
        bpy.context.scene.collection.objects.link(spear_obj)
        spear_obj.data.materials.append(MAT["leaf"])

    # Crown coconuts provide scale and a believable palm silhouette.
    for index in range(3 if MOBILE else 5):
        angle = phase + index * math.tau / (3 if MOBILE else 5)
        sphere(
            f"Palm_{name}_Coconut_{index}",
            (crown.x + math.cos(angle) * 0.23, crown.y + math.sin(angle) * 0.23, crown.z - 0.16),
            (0.13, 0.13, 0.16), MAT["bark"],
        )


def build_ground_plant(name: str, x: float, y: float, scale: float, phase: float) -> None:
    leaf_count = 8 if MOBILE else 12
    segments = 6 if MOBILE else 10
    for leaf_index in range(leaf_count):
        angle = phase + leaf_index / leaf_count * math.tau
        direction = Vector((math.cos(angle), math.sin(angle), 0.0))
        side = Vector((-math.sin(angle), math.cos(angle), 0.0))
        length = scale * (0.72 + 0.28 * math.sin(leaf_index * 1.83 + phase))
        lift = scale * (0.44 + 0.18 * math.cos(leaf_index * 1.27 + phase))
        verts: list[tuple[float, float, float]] = []
        faces: list[tuple[int, int, int, int]] = []
        for segment in range(segments + 1):
            t = segment / segments
            centre = Vector((x, y, 0.08)) + direction * length * t
            centre.z += math.sin(t * math.pi) * lift + t * scale * 0.16
            width = (math.sin(t * math.pi) ** 0.72) * scale * 0.18 + 0.012
            verts.extend((tuple(centre - side * width), tuple(centre + side * width)))
        for segment in range(segments):
            a = segment * 2
            faces.append((a, a + 2, a + 3, a + 1))
        mesh = bpy.data.meshes.new(f"GroundPlant_{name}_{leaf_index}_Mesh")
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        leaf = bpy.data.objects.new(f"GroundPlant_{name}_{leaf_index}", mesh)
        bpy.context.scene.collection.objects.link(leaf)
        leaf.data.materials.append(MAT["ground_leaf"])
    for stem_index in range(3 if MOBILE else 5):
        angle = phase + stem_index / max(1, (3 if MOBILE else 5)) * math.tau
        cylinder(
            f"GroundPlant_{name}_Stem_{stem_index}",
            (x + math.cos(angle) * 0.07, y + math.sin(angle) * 0.07, scale * 0.24),
            0.018 * scale, scale * 0.48, MAT["ground_leaf"], 6,
            rotation=(math.sin(angle) * 0.15, -math.cos(angle) * 0.15, 0.0),
        )


def build_palms_and_shore() -> None:
    # All roots remain on dry sand (Blender y < 6.7 -> Three z > -6.7).
    build_palm("Left", -11.2, 3.8, 7.4, 1.0, 0.35, 0.35)
    build_palm("Right", 9.3, 4.8, 8.0, -1.15, 0.15, 2.25)
    build_palm("Back", 3.9, 6.1, 6.5, -0.55, -0.2, 4.2)

    # Broadleaf groupings build foreground/midground depth and keep the scene
    # unmistakably tropical without relying on billboard foliage.
    build_ground_plant("HutFront", -8.8, -2.05, 0.82, 0.35)
    build_ground_plant("HutMatBridge", -0.75, 1.25, 0.68, 1.7)
    build_ground_plant("MatRight", 7.15, 0.7, 0.78, 2.8)
    build_ground_plant("ShoreLeft", -10.2, 5.35, 0.64, 4.1)
    build_ground_plant("ShoreRight", 8.25, 4.65, 0.62, 5.2)
    build_ground_plant("ForegroundLeft", -10.4, -4.05, 0.58, 0.9)
    build_ground_plant("ForegroundRight", 7.8, -1.3, 0.55, 3.6)

    # Shore rocks are clustered, never a regular row.
    rock_data = (
        (-13.2, 7.7, 0.48, 0.9), (-11.9, 8.0, 0.31, 1.3), (-10.7, 7.75, 0.22, 0.4),
        (10.8, 7.9, 0.52, 2.1), (12.2, 8.15, 0.29, 0.8), (13.0, 7.75, 0.22, 1.6),
    )
    for index, (x, y, size, rotation) in enumerate(rock_data):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1 if MOBILE else 2,
            radius=size,
            location=(x, y, size * 0.38),
            rotation=(rotation * 0.25, rotation, rotation * 0.12),
        )
        rock = bpy.context.object
        rock.name = f"Shore_Rock_{index}"
        rock.scale = (1.4, 0.86, 0.68)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        rock.data.materials.append(MAT["stone"])


def join_objects(name: str, objects: list[bpy.types.Object]) -> bpy.types.Object | None:
    objects = [obj for obj in objects if obj and obj.name in bpy.context.scene.objects and obj.type == "MESH"]
    if not objects:
        return None
    if len(objects) == 1:
        objects[0].name = name
        return objects[0]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    return result


def optimise() -> list[bpy.types.Object]:
    # Bake bevels before joining. Blender keeps only the active object's
    # modifier stack during a join; applying first preserves the rounded,
    # tactile furniture/lantern/deck silhouettes in the exported GLB.
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or not obj.modifiers:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.object.convert(target="MESH")
        except RuntimeError:
            pass

    # Palm fronds stay in three named meshes so runtime can animate their crown
    # pivots. Everything else is static and joined to cut submissions.
    for palm in ("Left", "Right", "Back"):
        join_objects(
            f"Palm_{palm}_Leaves",
            [obj for obj in bpy.context.scene.objects if obj.name.startswith(f"Palm_{palm}_Leaf_")],
        )
    leaf_names = {f"Palm_{palm}_Leaves" for palm in ("Left", "Right", "Back")}
    static = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name not in leaf_names]
    join_objects("BeachRetreat_Static", static)
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.hide_render]


def export() -> None:
    clear_scene()
    make_materials()
    build_sand()
    build_hut()
    build_daybed_and_lounge()
    build_practicals_and_decor()
    build_palms_and_shore()
    selected = optimise()
    if not selected:
        raise RuntimeError("No beach meshes were generated")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]

    vertices = sum(len(obj.data.vertices) for obj in selected)
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in selected)
    minimum = Vector((float("inf"),) * 3)
    maximum = Vector((float("-inf"),) * 3)
    for obj in selected:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            minimum = Vector(tuple(min(a, b) for a, b in zip(minimum, point)))
            maximum = Vector(tuple(max(a, b) for a, b in zip(maximum, point)))

    ARGS.output.parent.mkdir(parents=True, exist_ok=True)
    print(
        f"EXPORTING {ARGS.variant}: meshes={len(selected)} vertices={vertices} triangles={triangles} "
        f"bounds={tuple(round(v, 3) for v in minimum)}..{tuple(round(v, 3) for v in maximum)}"
    )
    bpy.ops.export_scene.gltf(
        filepath=str(ARGS.output),
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
        export_extras=False,
    )
    print(f"WROTE {ARGS.output} ({ARGS.output.stat().st_size:,} bytes)")


export()
