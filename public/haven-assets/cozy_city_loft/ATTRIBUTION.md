# Cozy City Loft — provenance and modifications

## Source

- `01_cozy_city_loft_all_assets.blend` was supplied by the YourNotes project
  owner as their authored Safe Haven high-rise room.
- The source `.blend` is not distributed by this repository. The release
  contains only the optimized desktop and mobile GLB exports generated for
  YourNotes.
- No separate third-party license or attribution manifest was supplied beside
  the source file. This document therefore does not assign or invent licenses
  for any pre-existing objects inside that authored Blender file.

## YourNotes modifications

`tools/export_haven_loft.py` performs the release export without overwriting the
source file. It:

- positions the supplied leather chair at the workstation;
- builds the laptop chassis, hinge, display, keyboard and trackpad as meshes;
- adds modeled lounge books, a ceramic mug and coffee surface;
- adds a modeled woven sofa throw and a complete floor-lamp practical;
- adds modeled workstation pinboard/note cards and lounge relief artwork;
- groups repeated city, chess and book geometry; and
- produces separate desktop and mobile LOD exports.

The runtime scene additionally creates its blue-hour sky, rain-on-glass,
fireplace flame, subtle material detail maps and laptop screen artwork
procedurally in YourNotes. No Internet-downloaded high-rise asset was added by
this revamp.

## Release files

- `cozy_city_loft.glb` — desktop/heavy Haven export.
- `cozy_city_loft_mobile.glb` — mobile LOD export.
