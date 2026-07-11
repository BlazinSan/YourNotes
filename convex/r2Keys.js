// Canonical object-key policy shared by the Convex metadata mutations and the
// Node action that signs Cloudflare R2 requests. Never construct an object path
// from a client-controlled string without passing through this module.
const FILE_FOLDERS = new Set(["college_pdfs", "banner_files", "board_files"]);
const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/u;
const INLINE_HASH = /^[a-f0-9]{64}$/u;

function validSegment(segment) {
  return segment.length > 0
    && segment.length <= 512
    && segment !== "."
    && segment !== ".."
    && !CONTROL_OR_BACKSLASH.test(segment);
}

export function canonicalLocalKey(value) {
  if (typeof value !== "string") throw new Error("Invalid R2 file key");
  const key = value.normalize("NFC");
  if (!key || key.length > 1024 || key.startsWith("/") || key.endsWith("/")) {
    throw new Error("Invalid R2 file key");
  }
  const segments = key.split("/");
  if (!segments.every(validSegment)) throw new Error("Invalid R2 file key");

  if (segments.length === 1) {
    // Legacy released clients used a basename (and board blobs use blob_*).
    // A single safe segment remains namespaced under the authenticated user.
    return key;
  }
  if (segments.length === 2 && FILE_FOLDERS.has(segments[0])) return key;
  if (segments.length === 2 && segments[0] === "inline" && INLINE_HASH.test(segments[1])) return key;
  throw new Error("Invalid R2 file key");
}

export function r2KeyForUser(userId, localKey) {
  const user = String(userId || "");
  if (!user || CONTROL_OR_BACKSLASH.test(user) || user.includes("/") || user === "." || user === "..") {
    throw new Error("Invalid R2 user namespace");
  }
  return `${user}/${canonicalLocalKey(localKey)}`;
}
