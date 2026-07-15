# YourNotes Safe Haven asset-native rebuild — v0.0.11

## Selected direction

Sol's asset-native plan is the execution baseline, with Terra's measured LOD/draw-call safeguards added. The user's authored Blender room becomes the high-rise source of truth instead of being stacked over the old procedural room. Runtime code owns cameras, loading, lights, rain, fire/candle animation, water, and lifecycle only.

The edition split remains deliberate:

- Standard YourNotes desktop keeps the light cinematic 2.5D Haven.
- YourNotes Haven desktop loads the detailed 3D environments.
- Android loads mobile LODs of the same modeled environments.

The 73.9 MB source `.blend` is not committed. Reproducible Blender export scripts, optimized GLBs, runtime code, and attribution are committed.

## Team ownership

- **Terra manager:** high-rise export/integration, cross-file integration, performance review.
- **Luna executor:** beach rebuild plus Haven lofi/mobile controls within manager-approved boundaries.
- **Root:** plan selection, conflict resolution, builds, visual/device QA, installation, Git, and release.

## Phase 1 — high-rise from the authored Blender room

### Export pipeline

Improve `tools/export_haven_loft.py` and validate with `tools/inspect_blend.py`:

- Use `C:\Users\HP\Downloads\01_cozy_city_loft_all_assets.blend` read-only.
- Preserve the architecture, sofa, leather chair, desk, fireplace, skyline, shelves/books, plants, lamps, tables, camera, boombox, ukulele, chess, outdoor set, candles, and decor as actual meshes.
- Center the leather chair on the laptop workstation, rotate it toward the screen, leave believable leg clearance, and keep it outside all camera near planes.
- Keep the modeled laptop as a dimensional aluminum body, display, hinge, keyboard, and trackpad; join its keys/static pieces to reduce nodes and draw calls.
- Preserve names for runtime effects: window glass, lamp bulbs, fireplace/logs, candle flames, and skyline lights.
- Exclude Blender lights, cameras, helpers, widget rigs, hidden objects, and rain curves.
- Merge compatible static meshes without merging transparent glass or independently animated emissive parts.
- Export:
  - `public/haven-assets/cozy_city_loft/cozy_city_loft.glb`
  - `public/haven-assets/cozy_city_loft/cozy_city_loft_mobile.glb`
- Desktop target: ≤180k visible triangles / ≤180 draw calls.
- Phone target: ≤100k visible triangles / ≤100 draw calls, retaining every important object as 3D.

### Runtime high-rise

Replace `src/haven/scenes/city.js` with a GLB-driven scene:

- Select desktop/mobile asset from `quality.mobile`.
- Use Blender→Three coordinate mapping `(x, z, -y)` for cameras and lights.
- Do not retain the old procedural shell, bed, desk, laptop, furniture, shelving, or clutter behind the authored room.
- Recreate the authored warm desk, fireplace, candle, and window rim lights with at most three desktop shadow casters and none on phone.
- Animate real emissive materials/meshes for fireplace, candles, bulbs, and skyline.
- Keep rain on window glass only.
- Compose three camera families for desktop, phone landscape, and portrait fallback:
  1. workstation — leather chair, laptop, pipe lamp, rainy skyline;
  2. lounge — sofa, table, fireplace, books, and layered depth;
  3. wide room — the complete authored composition with no black frame or obstruction.
- Provide a graceful scene-load error/fallback without also rendering duplicate old geometry.

### High-rise acceptance

- Chair faces and belongs to the laptop workstation.
- Laptop is recognizable and dimensional from normal camera distance.
- All three views render nonblack on desktop and phone landscape.
- No camera intersects walls or furniture.
- The room visibly remains the user's Blender composition.

## Phase 2 — modeled tropical beach

### Asset/license gate

- Use user-provided assets and redistribution-safe free assets only.
- Record asset name, author, URL, license, and modifications before committing.
- Do not redistribute non-downloadable or incompatible-license Sketchfab models.

### Beach environment

Create/export `public/haven-assets/beach_retreat/` with reproducible Blender scripts:

- Sculpted/subdivided sand with PBR color, normal, roughness, dune variation, wet-sand transition, footprints/contact shadows.
- Detailed timber hut with roof, posts, stairs, window/trim, furniture, and warm lanterns.
- Real palm trunks/fronds; remove pine-like silhouettes and billboard foliage.
- Modeled woven mat/blanket with thickness, plus table, mug, cushions, rocks, shells, driftwood, and vegetation clusters.
- Instance repeated foliage/rocks and merge compatible static meshes.
- Export desktop and phone LOD GLBs.

Keep ocean water realtime because a displaced shader mesh is the correct 3D form:

- two/three crossing Gerstner-style wave bands;
- moving normal detail and Fresnel reflection;
- depth color and sunset reflection;
- shoreline-following foam and wet-sand transition;
- reduced segments/shader path on phone;
- no translucent horizontal wave strips.

Compose three views with foreground/midground/background:

1. sheltered seating across the shore;
2. hut/palm walkway with warm interior light;
3. low stargazing/mat view with lantern and dimensional foliage.

### Beach acceptance

- Hut, palms, mat, furniture, rocks, and shoreline objects are real meshes.
- Sand is visibly dimensional, not a flat brown plane.
- Water changes silhouette/reflection as it moves and meets the shore convincingly.
- No pine trees, floating props, billboard vegetation, or sun-blocking rectangles.
- Every camera works on desktop and phone.

## Phase 3 — shared lofi player in Haven

Edit `index.html`, `src/main.js`, and `src/style.css`:

- Add a compact music control beside the close button.
- Reuse the existing Session `#lofi-audio`, track selector, and playback functions; never create a second audio element or duplicate the track URLs.
- Popover contains play/pause, current track, next track, and music volume.
- Keep music volume separate from scene ambience.
- Session, Focus, and Haven controls update together.
- Closing Haven does not stop music unless the user pauses it.
- Replace playback `alert()` failures with an in-app state/toast.

Acceptance: one stream only across repeated Haven open/close cycles; changing/playing from any surface synchronizes the others.

## Phase 4 — phone control behavior

- Remove the rotate button and `toggleHavenOrientation` UI path.
- Keep automatic landscape lock on open and restore prior orientation on close.
- Auto-hide Haven controls only on coarse/mobile pointers after three seconds idle.
- Any touch/pointer interaction reveals controls.
- Do not hide while a slider is active, lofi popover is open, or a scene is loading.
- Hidden controls use opacity + visibility + disabled pointer interaction.
- Respect safe-area insets. Desktop controls stay visible.

## Phase 5 — performance and lifecycle

- Desktop: GTAO/bloom allowed, ≤3 shadow lights, 1024 shadow maps, target stable 55–60 FPS at 1080p.
- Phone: no postprocessing/shadow maps, ≤2 active point lights plus ambient/hemisphere, DPR ≤1.25, target stable ≥30 FPS.
- Cache parsed assets while Haven is open; do not retain duplicate scenes across theme switches.
- Dispose geometries/materials/textures/render targets/listeners/audio nodes on final close.
- Context loss shows retry and recovers without app crash.

## Phase 6 — verification

Automated/build:

- Validate GLB stats and asset paths.
- Heavy `npm run build`.
- Standard cinematic build to prove the normal edition is unchanged.
- Reject blank/black screenshots by luminance.
- Check console for GLTF, shader, WebGL, CORS, and unhandled-promise errors.
- Cycle city → beach → cabin → city repeatedly.
- Open/close Haven repeatedly while music plays.

Visual desktop:

- 1920×1080 and 1440×900.
- All three high-rise and all three beach views.
- No clipping, black views, mismatched scale, or loading overlay left behind.

Phone emulation:

- 915×412 and 844×390 landscape.
- All six views, lofi popover/sliders, idle hide, touch reveal, safe areas, no rotate button.

Physical phone when ADB reconnects:

- Install heavyweight APK.
- Verify landscape lock/restore, steady animation, audio lifecycle, touch reveal, and scene switching.
- If no device is connected, report that limitation honestly and do not claim installation.

## Phase 7 — release

- Bump v0.0.11 in package/package-lock, Android Gradle, and extension manifest.
- Build/install standard YourNotes and YourNotes Haven desktop editions.
- Build/install Android when a device is available.
- Stage only intentional files; preserve `.claude/launch.json`, old artifacts, caches, and unrelated dirty files.
- Commit, push, publish GitHub v0.0.11, and attach desktop installers/portable builds plus APK when verified.
