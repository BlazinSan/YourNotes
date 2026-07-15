#!/usr/bin/env node

/**
 * Inspect the binary glTF assets shipped by heavyweight Safe Haven.
 *
 * This intentionally has no package dependency so it can run before packaging:
 *
 *   node tools/inspect_haven_glb.mjs
 *   node tools/inspect_haven_glb.mjs --json
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const ASSETS = [
  {
    label: 'highrise desktop',
    file: 'public/haven-assets/cozy_city_loft/cozy_city_loft.glb',
    budget: { triangles: 180_000, primitives: 180 },
    forbiddenExtensions: ['KHR_materials_transmission'],
  },
  {
    label: 'highrise mobile',
    file: 'public/haven-assets/cozy_city_loft/cozy_city_loft_mobile.glb',
    budget: { triangles: 100_000, primitives: 100 },
    forbiddenExtensions: ['KHR_materials_transmission'],
  },
  {
    label: 'beach desktop',
    file: 'public/haven-assets/beach_retreat/beach_retreat.glb',
    // Runtime adds the ocean, foam, sky and instanced shoreline details.
    // Keep the authored GLB below this ceiling so those dynamic layers retain
    // comfortable desktop GPU headroom.
    budget: { triangles: 300_000, primitives: 120 },
    forbiddenExtensions: ['KHR_materials_transmission'],
  },
  {
    label: 'beach mobile',
    file: 'public/haven-assets/beach_retreat/beach_retreat_mobile.glb',
    budget: { triangles: 140_000, primitives: 90 },
    forbiddenExtensions: ['KHR_materials_transmission'],
  },
];

function readGlbJson(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error(`${file} is not a binary glTF file`);
  }

  let offset = 12;
  let json;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = buffer.subarray(offset, offset + length);
    offset += length;
    if (type === 0x4e4f534a) {
      json = JSON.parse(chunk.toString('utf8').replace(/\0+$/u, ''));
    }
  }

  if (!json) throw new Error(`${file} has no JSON chunk`);
  return { json, bytes: buffer.length };
}

function inspectAsset(asset) {
  const absolute = path.resolve(ROOT, asset.file);
  const { json, bytes } = readGlbJson(absolute);
  let primitives = 0;
  let triangles = 0;
  let vertices = 0;

  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1;
      const position = json.accessors?.[primitive.attributes?.POSITION];
      vertices += position?.count ?? 0;

      const source = json.accessors?.[primitive.indices ?? primitive.attributes?.POSITION];
      if (!source) continue;
      const mode = primitive.mode ?? 4;
      if (mode === 4) triangles += Math.floor(source.count / 3);
      if (mode === 5 || mode === 6) triangles += Math.max(0, source.count - 2);
    }
  }

  const extensions = [...new Set([
    ...(json.extensionsUsed ?? []),
    ...(json.extensionsRequired ?? []),
  ])].sort();
  const failures = [];
  if (asset.budget?.triangles && triangles > asset.budget.triangles) {
    failures.push(`${triangles.toLocaleString()} triangles > ${asset.budget.triangles.toLocaleString()}`);
  }
  if (asset.budget?.primitives && primitives > asset.budget.primitives) {
    failures.push(`${primitives} primitives > ${asset.budget.primitives}`);
  }
  for (const extension of asset.forbiddenExtensions ?? []) {
    if (extensions.includes(extension)) failures.push(`forbidden extension: ${extension}`);
  }

  return {
    label: asset.label,
    file: asset.file,
    bytes,
    nodes: json.nodes?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    primitives,
    vertices,
    triangles,
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    images: json.images?.length ?? 0,
    animations: json.animations?.length ?? 0,
    extensions,
    budget: asset.budget ?? null,
    passed: failures.length === 0,
    failures,
  };
}

const results = ASSETS.map(inspectAsset);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const result of results) {
    const size = `${(result.bytes / 1_048_576).toFixed(2)} MiB`;
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(
      `${status.padEnd(4)}  ${result.label.padEnd(18)} `
      + `${result.triangles.toLocaleString().padStart(8)} tris  `
      + `${String(result.primitives).padStart(3)} prims  `
      + `${String(result.nodes).padStart(3)} nodes  ${size}`,
    );
    if (result.extensions.length) console.log(`      extensions: ${result.extensions.join(', ')}`);
    for (const failure of result.failures) console.error(`      ${failure}`);
  }
}

if (results.some((result) => !result.passed)) process.exitCode = 1;
