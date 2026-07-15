# Safe Haven beach asset provenance

The rebuild was informed by the user's authored
`02_moonlit_beach_hut_all_assets.blend`, supplied inside
`3_blender_scenes_all_assets.zip`. That source remains read-only and is not
redistributed with the application.

The shipping desktop and mobile GLBs are original YourNotes assets generated
by `tools/export_haven_beach.py`. The exporter clears the source scene and
constructs the retreat from project-authored geometry and materials: sculpted
sand, wet shoreline, a raised cabana and deck, thatch, boardwalk and steps,
rattan furniture, cushions, a tea setting, books, lanterns, tropical palms,
ground plants, rocks, shells, and driftwood.

No third-party downloaded mesh is included in these exported GLBs. The animated
ocean, foam, woven surfaces, lighting, and palm movement are project-authored at
runtime in `src/haven/scenes/beach.js`.

## CC0 PBR surfaces

The heavyweight scene bundles these 1K PBR maps from Poly Haven under the
[CC0 license](https://polyhaven.com/license):

- [Sand 01](https://polyhaven.com/a/sand_01) — diffuse, OpenGL normal, and
  roughness maps by Rob Tuytel.
- [Wood Floor Deck](https://polyhaven.com/a/wood_floor_deck) — diffuse, OpenGL
  normal, and roughness maps by Dimitrios Savva.

The maps are used only by the heavyweight beach scene and are loaded with a
generated-texture fallback so a missing file cannot prevent Safe Haven from
opening.
