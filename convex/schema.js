import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    hash: v.string(),
    salt: v.string(),
  }).index("by_email", ["email"]),

  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
  }).index("by_token", ["token"]),

  // One row per localStorage key — keeps every row far under Convex's 1MB doc cap
  kv: defineTable({
    userId: v.id("users"),
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user_key", ["userId", "key"])
    .index("by_user", ["userId"]),

  // App-managed files (college PDFs, banner, board files, profile picture),
  // keyed by their unique local filename. Bytes live in Cloudflare R2; here we
  // only track localKey → r2Key so any device can presign a URL.
  files: defineTable({
    userId: v.id("users"),
    localKey: v.string(),
    r2Key: v.string(),
    name: v.string(),
    size: v.number(),
  })
    .index("by_user_localKey", ["userId", "localKey"])
    .index("by_user", ["userId"]),
});
