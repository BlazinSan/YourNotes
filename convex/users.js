import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
  },
});

export const create = internalMutation({
  args: { email: v.string(), hash: v.string(), salt: v.string(), token: v.string() },
  handler: async (ctx, { email, hash, salt, token }) => {
    const userId = await ctx.db.insert("users", { email, hash, salt });
    await ctx.db.insert("sessions", { userId, token });
    return userId;
  },
});

export const createSession = internalMutation({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    await ctx.db.insert("sessions", { userId, token });
  },
});
