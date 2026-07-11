"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AwsClient } from "aws4fetch";
import { canonicalLocalKey, r2KeyForUser } from "./r2Keys";

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

async function signUpload(r2Key) {
  const req = await aws().sign(objectUrl(r2Key, 3600), { method: "PUT", aws: { signQuery: true } });
  return req.url;
}

export const presignUpload = action({
  args: { token: v.string(), key: v.string() },
  handler: async (ctx, { token, key }) => {
    const uid = await ctx.runQuery(internal.sync._userIdForToken, { token });
    if (!uid) throw new Error("Not signed in");
    // Namespace objects per user so filenames can't collide/overwrite across accounts.
    const localKey = canonicalLocalKey(key);
    const r2Key = r2KeyForUser(uid, localKey);
    return { url: await signUpload(r2Key), r2Key };
  },
});

// Batch presigning avoids one Convex action (and one session lookup) for every
// file in a multi-file import. The browser still PUTs bytes straight to R2;
// neither the request body nor the response body passes through Convex.
export const presignUploads = action({
  args: { token: v.string(), keys: v.array(v.string()) },
  handler: async (ctx, { token, keys }) => {
    const uid = await ctx.runQuery(internal.sync._userIdForToken, { token });
    if (!uid) throw new Error("Not signed in");
    const uploads = [];
    const seen = new Set();
    for (const key of keys) {
      const localKey = canonicalLocalKey(key);
      if (seen.has(localKey)) continue;
      seen.add(localKey);
      const r2Key = r2KeyForUser(uid, localKey);
      uploads.push({ key, r2Key, url: await signUpload(r2Key) });
    }
    return uploads;
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
