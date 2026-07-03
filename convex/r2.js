"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AwsClient } from "aws4fetch";

// Cloudflare R2 is S3-compatible. We presign PUT (upload) and GET (download)
// URLs server-side so the secret key never reaches the client.
const aws = () => new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});
const objectUrl = (key, expires) => {
  const path = String(key).split("/").map(encodeURIComponent).join("/");
  const u = new URL(`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}/${path}`);
  u.searchParams.set("X-Amz-Expires", String(expires));
  return u.toString();
};

export const presignUpload = action({
  args: { token: v.string(), key: v.string() },
  handler: async (ctx, { token, key }) => {
    const uid = await ctx.runQuery(internal.sync._userIdForToken, { token });
    if (!uid) throw new Error("Not signed in");
    // Namespace objects per user so filenames can't collide/overwrite across accounts.
    const r2Key = `${uid}/${key}`;
    const req = await aws().sign(objectUrl(r2Key, 3600), { method: "PUT", aws: { signQuery: true } });
    return { url: req.url, r2Key };
  },
});

export const presignDownloads = action({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const files = await ctx.runQuery(internal.sync._filesForToken, { token });
    const out = {};
    for (const f of files) {
      const req = await aws().sign(objectUrl(f.r2Key, 604800), { method: "GET", aws: { signQuery: true } });
      out[f.localKey] = req.url;
    }
    return out;
  },
});
