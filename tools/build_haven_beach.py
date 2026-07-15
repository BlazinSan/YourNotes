"""Build the Safe Haven beach GLBs from the user's authored Blender archive.

The source .blend stays outside the repository. This script extracts only the
beach scene to a temporary directory, runs Blender headlessly for desktop and
mobile variants, then verifies that both binary glTF files were produced.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = Path.home() / "Downloads" / "3_blender_scenes_all_assets.zip"
ENTRY = "02_moonlit_beach_hut_all_assets.blend"
EXPORTER = ROOT / "tools" / "export_haven_beach.py"
OUTPUT_DIR = ROOT / "public" / "haven-assets" / "beach_retreat"


def find_blender() -> Path:
    configured = os.environ.get("BLENDER_EXE")
    candidates = [
        Path(configured) if configured else None,
        Path(r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"),
        Path(r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"),
        Path(r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe"),
    ]
    command = shutil.which("blender")
    if command:
        candidates.append(Path(command))
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise FileNotFoundError("Blender was not found. Set BLENDER_EXE to blender.exe.")


def validate_glb(path: Path) -> None:
    if not path.is_file() or path.stat().st_size < 1024:
        raise RuntimeError(f"Missing or empty GLB: {path}")
    with path.open("rb") as handle:
        magic, version, declared_length = struct.unpack("<4sII", handle.read(12))
    if magic != b"glTF" or version != 2 or declared_length != path.stat().st_size:
        raise RuntimeError(f"Invalid GLB header: {path}")


def main() -> None:
    if not ARCHIVE.is_file():
        raise FileNotFoundError(f"Authored scene archive not found: {ARCHIVE}")
    blender = find_blender()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="yournotes-beach-") as temp_name:
        temp_dir = Path(temp_name)
        source = temp_dir / ENTRY
        with zipfile.ZipFile(ARCHIVE) as bundle:
            try:
                with bundle.open(ENTRY) as incoming, source.open("wb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
            except KeyError as error:
                raise FileNotFoundError(f"{ENTRY} is not present in {ARCHIVE}") from error

        for variant, filename in (
            ("desktop", "beach_retreat.glb"),
            ("mobile", "beach_retreat_mobile.glb"),
        ):
            output = OUTPUT_DIR / filename
            command = [
                str(blender),
                "--background",
                str(source),
                "--python",
                str(EXPORTER),
                "--",
                "--variant",
                variant,
                "--output",
                str(output),
            ]
            print("RUNNING", " ".join(command))
            subprocess.run(command, check=True, cwd=ROOT)
            validate_glb(output)
            print(f"VERIFIED {variant}: {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
