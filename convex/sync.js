import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";

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
    return rows.map((r) => ({ localKey: r.localKey, r2Key: r.r2Key }));
  },
});

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

// Record a file that was just uploaded to R2 (bytes live in R2, not Convex).
export const registerFile = mutation({
  args: {
    token: v.string(),
    localKey: v.string(),
    r2Key: v.string(),
    name: v.string(),
    size: v.number(),
  },
  handler: async (ctx, { token, localKey, r2Key, name, size }) => {
    const userId = await requireUser(ctx, token);
    const existing = await ctx.db
      .query("files")
      .withIndex("by_user_localKey", (q) => q.eq("userId", userId).eq("localKey", localKey))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { r2Key, name, size });
    else await ctx.db.insert("files", { userId, localKey, r2Key, name, size });
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
