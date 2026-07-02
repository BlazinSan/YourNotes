"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import crypto from "node:crypto";

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");

export const signUp = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please enter a valid email address");
    if (args.password.length < 8) throw new Error("Password must be at least 8 characters");
    const existing = await ctx.runQuery(internal.users.byEmail, { email });
    if (existing) throw new Error("An account with this email already exists — sign in instead");
    const salt = crypto.randomBytes(16).toString("hex");
    const token = newToken();
    await ctx.runMutation(internal.users.create, { email, hash: hashPw(args.password, salt), salt, token });
    return { token, email };
  },
});

export const signIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.runQuery(internal.users.byEmail, { email });
    if (!user) throw new Error("No account found with this email");
    // timing-safe compare of scrypt hashes
    const attempt = Buffer.from(hashPw(args.password, user.salt), "hex");
    const actual = Buffer.from(user.hash, "hex");
    if (attempt.length !== actual.length || !crypto.timingSafeEqual(attempt, actual)) {
      throw new Error("Incorrect password");
    }
    const token = newToken();
    await ctx.runMutation(internal.users.createSession, { userId: user._id, token });
    return { token, email };
  },
});
