import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function requireUser(ctx, token) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!session) throw new Error("Not signed in");
  return session.userId;
}

export const setKVBatch = mutation({
  args: {
    token: v.string(),
    entries: v.array(v.object({ key: v.string(), value: v.string(), updatedAt: v.number() })),
  },
  handler: async (ctx, { token, entries }) => {
    const userId = await requireUser(ctx, token);
    for (const e of entries) {
      const existing = await ctx.db
        .query("kv")
        .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", e.key))
        .unique();
      if (existing) await ctx.db.patch(existing._id, { value: e.value, updatedAt: e.updatedAt });
      else await ctx.db.insert("kv", { userId, key: e.key, value: e.value, updatedAt: e.updatedAt });
    }
    return entries.length;
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

export const genUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireUser(ctx, token);
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerFile = mutation({
  args: {
    token: v.string(),
    localKey: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    size: v.number(),
  },
  handler: async (ctx, { token, localKey, storageId, name, size }) => {
    const userId = await requireUser(ctx, token);
    const existing = await ctx.db
      .query("files")
      .withIndex("by_user_localKey", (q) => q.eq("userId", userId).eq("localKey", localKey))
      .unique();
    if (existing) {
      await ctx.storage.delete(existing.storageId).catch(() => {});
      await ctx.db.patch(existing._id, { storageId, name, size });
    } else {
      await ctx.db.insert("files", { userId, localKey, storageId, name, size });
    }
  },
});

// filename → https URL map, so any device can resolve app files it doesn't hold locally
export const fileUrls = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await requireUser(ctx, token);
    const rows = await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out = {};
    for (const r of rows) out[r.localKey] = await ctx.storage.getUrl(r.storageId);
    return out;
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
