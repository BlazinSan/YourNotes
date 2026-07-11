import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { canonicalLocalKey, r2KeyForUser } from "./r2Keys";

const KV_CHUNK_SEP = "\u0001c\u0001";
const KV_CHUNK_MARK = "\u0001YNCHUNKS\u0001";

async function sessionUserId(ctx, token) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  return session ? session.userId : null;
}
async function requireUser(ctx, token) {
  const userId = await sessionUserId(ctx, token);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

async function nextSyncCursor(ctx, userId) {
  const state = await ctx.db
    .query("syncState")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  // Legacy rows used device clocks and may even be future-skewed. The first
  // new-style mutation must start above their maximum, not merely Date.now(),
  // or an incremental client could skip that write behind its legacy cursor.
  let floor = state ? state.cursor : 0;
  if (!state) {
    const newestLegacyRow = await ctx.db
      .query("kv")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    floor = Math.max(floor, newestLegacyRow ? newestLegacyRow.updatedAt : 0);
  }
  const cursor = Math.max(Date.now(), floor + 1);
  if (state) await ctx.db.patch(state._id, { cursor });
  else await ctx.db.insert("syncState", { userId, cursor });
  return cursor;
}

// Used by the R2 node action (which can't touch the db directly).
export const _userIdForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => sessionUserId(ctx, token),
});
export const _filesForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await sessionUserId(ctx, token);
    if (!userId) return [];
    const rows = await ctx.db.query("files").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const safe = [];
    for (const row of rows) {
      try {
        const localKey = canonicalLocalKey(row.localKey);
        // Derive from the authenticated owner. Never trust a previously
        // client-supplied r2Key, including legacy/poisoned metadata rows.
        safe.push({ localKey, r2Key: r2KeyForUser(userId, localKey) });
      } catch (_) {
        // Invalid legacy metadata is ignored rather than signed.
      }
    }
    return safe;
  },
});

export const setKVBatch = mutation({
  args: {
    token: v.string(),
    entries: v.array(v.object({ key: v.string(), value: v.string(), updatedAt: v.number() })),
  },
  handler: async (ctx, { token, entries }) => {
    const userId = await requireUser(ctx, token);
    if (!entries.length) return { count: 0, updatedAt: Date.now() };
    const updatedAt = await nextSyncCursor(ctx, userId);

    // Read only the logical keys being replaced. A whole-user collection made
    // a multi-key push re-read every note and could recreate the exact Convex
    // Database I/O pressure this migration is meant to remove. One point read
    // plus one narrow chunk range per distinct root keeps bytes proportional
    // to the changed data (and still avoids one lookup per chunk).
    const existingRows = [];
    const entryRoots = new Set(entries.map((entry) => {
      const splitAt = entry.key.indexOf(KV_CHUNK_SEP);
      return splitAt === -1 ? entry.key : entry.key.slice(0, splitAt);
    }));
    for (const root of entryRoots) {
      const main = await ctx.db
        .query("kv")
        .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", root))
        .unique();
      if (main) existingRows.push(main);
      const lower = root + KV_CHUNK_SEP;
      existingRows.push(...await ctx.db
        .query("kv")
        .withIndex("by_user_key", (q) => q.eq("userId", userId).gte("key", lower).lt("key", lower + "\uffff"))
        .collect());
    }
    const existingByKey = new Map(existingRows.map((row) => [row.key, row]));
    const incomingKeys = new Set(entries.map((entry) => entry.key));
    const replacedRoots = new Set(entries.filter((entry) => !entry.key.includes(KV_CHUNK_SEP)).map((entry) => entry.key));
    // When a formerly large value becomes smaller (notably after inline file
    // bytes move to R2), delete obsolete chunk rows instead of reading them on
    // every future pull forever.
    for (const row of existingRows) {
      const splitAt = row.key.indexOf(KV_CHUNK_SEP);
      if (splitAt !== -1 && replacedRoots.has(row.key.slice(0, splitAt)) && !incomingKeys.has(row.key)) {
        await ctx.db.delete(row._id);
      }
    }

    for (const entry of entries) {
      const existing = existingByKey.get(entry.key);
      const value = entry.value;
      if (existing) {
        // Always touch the logical root. A chunked value can keep the same
        // sentinel (same chunk count) while its chunk bodies change; the root
        // timestamp is what makes that logical key visible to getChanges.
        if (!entry.key.includes(KV_CHUNK_SEP) || existing.value !== value) {
          await ctx.db.patch(existing._id, { value, updatedAt });
        }
      } else {
        await ctx.db.insert("kv", { userId, key: entry.key, value, updatedAt });
      }
    }
    return { count: entries.length, updatedAt };
  },
});

export const getAll = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await requireUser(ctx, token);
    const rows = await ctx.db
      .query("kv")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt }));
  },
});

// Incremental replacement for getAll. getAll remains available for older app
// builds and as a rollout fallback while the new index is being deployed.
export const getChanges = query({
  args: { token: v.string(), since: v.number() },
  handler: async (ctx, { token, since }) => {
    const userId = await requireUser(ctx, token);
    const safeSince = Number.isFinite(since) && since > 0 ? since : 0;
    const state = await ctx.db
      .query("syncState")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const changedRows = await ctx.db
      .query("kv")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId).gt("updatedAt", safeSince))
      .collect();
    const changedByKey = new Map(changedRows.map((row) => [row.key, row]));
    const roots = new Set(changedRows.map((row) => {
      const splitAt = row.key.indexOf(KV_CHUNK_SEP);
      return splitAt === -1 ? row.key : row.key.slice(0, splitAt);
    }));
    const rows = [];
    const seen = new Set();
    for (const root of roots) {
      let main = changedByKey.get(root);
      if (!main) {
        main = await ctx.db
          .query("kv")
          .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", root))
          .unique();
      }
      if (main) {
        rows.push(main);
        seen.add(main.key);
      }
      const changedChunk = changedRows.some((row) => row.key.startsWith(root + KV_CHUNK_SEP));
      if ((main && main.value.startsWith(KV_CHUNK_MARK)) || changedChunk) {
        const lower = root + KV_CHUNK_SEP;
        const chunks = await ctx.db
          .query("kv")
          .withIndex("by_user_key", (q) => q.eq("userId", userId).gte("key", lower).lt("key", lower + "\uffff"))
          .collect();
        for (const chunk of chunks) {
          if (!seen.has(chunk.key)) rows.push(chunk);
          seen.add(chunk.key);
        }
      }
    }
    // A user with legacy rows but no syncState still needs a positive durable
    // client cursor after this first full read. A later mutation initializes
    // syncState strictly above this maximum (see nextSyncCursor), preserving
    // snapshot safety even for future-skewed legacy timestamps.
    const responseCursor = state
      ? state.cursor
      : changedRows.reduce((max, row) => Math.max(max, row.updatedAt), safeSince);
    return {
      cursor: responseCursor,
      // Kept during rollout for clients built against the first incremental
      // response shape.
      serverTime: responseCursor,
      rows: rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt })),
    };
  },
});

// Record a file that was just uploaded to R2 (bytes live in R2, not Convex).
export const registerFile = mutation({
  args: {
    token: v.string(),
    localKey: v.string(),
    r2Key: v.string(),
    name: v.string(),
    size: v.number(),
  },
  handler: async (ctx, { token, localKey, r2Key: _ignoredClientR2Key, name, size }) => {
    const userId = await requireUser(ctx, token);
    const safeLocalKey = canonicalLocalKey(localKey);
    const safeR2Key = r2KeyForUser(userId, safeLocalKey);
    const existing = await ctx.db
      .query("files")
      .withIndex("by_user_localKey", (q) => q.eq("userId", userId).eq("localKey", safeLocalKey))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { r2Key: safeR2Key, name, size });
    else await ctx.db.insert("files", { userId, localKey: safeLocalKey, r2Key: safeR2Key, name, size });
  },
});

// Batch metadata registration keeps the actual bytes in R2 while reducing a
// folder/import from N client function calls to one. Lookups remain narrowly
// indexed by each incoming key so database bytes stay proportional to changes.
// The single-file mutation above stays for older released clients.
export const registerFiles = mutation({
  args: {
    token: v.string(),
    files: v.array(v.object({
      localKey: v.string(),
      r2Key: v.string(),
      name: v.string(),
      size: v.number(),
    })),
  },
  handler: async (ctx, { token, files }) => {
    const userId = await requireUser(ctx, token);
    if (!files.length) return 0;
    const normalizedFiles = [];
    const seen = new Set();
    for (const file of files) {
      const localKey = canonicalLocalKey(file.localKey);
      if (seen.has(localKey)) continue;
      seen.add(localKey);
      normalizedFiles.push({ ...file, localKey });
    }
    const rows = [];
    for (const file of normalizedFiles) {
      const row = await ctx.db
        .query("files")
        .withIndex("by_user_localKey", (q) => q.eq("userId", userId).eq("localKey", file.localKey))
        .unique();
      if (row) rows.push({ ...row, localKey: file.localKey });
    }
    const byLocalKey = new Map(rows.map((row) => [row.localKey, row]));
    for (const file of normalizedFiles) {
      const localKey = file.localKey;
      const existing = byLocalKey.get(localKey);
      const fields = { r2Key: r2KeyForUser(userId, localKey), name: file.name, size: file.size };
      if (existing) {
        if (existing.r2Key !== fields.r2Key || existing.name !== fields.name || existing.size !== fields.size) {
          await ctx.db.patch(existing._id, fields);
        }
      } else {
        await ctx.db.insert("files", { userId, localKey, ...fields });
      }
    }
    return normalizedFiles.length;
  },
});

export const listFiles = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await requireUser(ctx, token);
    const rows = await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => ({ localKey: r.localKey, name: r.name, size: r.size }));
  },
});

export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});
