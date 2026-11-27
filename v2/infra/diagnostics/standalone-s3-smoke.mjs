#!/usr/bin/env node
/** Provjera AWS paketa iz Next standalone stabla, bez stvarnih S3 kredencijala ili mreže. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const serverJs = process.argv[2];
if (!serverJs) throw new Error("Usage: node standalone-s3-smoke.mjs /path/to/apps/web/server.js");
const requireFromServer = createRequire(resolve(serverJs));
const { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand } = requireFromServer("@aws-sdk/client-s3");
const { getSignedUrl } = requireFromServer("@aws-sdk/s3-request-presigner");
const methods = [];
const fixture = Buffer.from("gradix-s3-smoke");
const server = createServer((request, response) => {
  methods.push(`${request.method} ${request.url}`);
  request.resume();
  request.on("end", () => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-length": fixture.length });
      response.end(fixture);
    } else {
      response.writeHead(200, { etag: '"ci-etag"' });
      response.end();
    }
  });
});
await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const port = server.address().port;
const client = new S3Client({ endpoint: `http://127.0.0.1:${port}`, region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: "ci-access", secretAccessKey: "ci-secret" }, maxAttempts: 1 });
try {
  await client.send(new HeadBucketCommand({ Bucket: "test-bucket" }));
  await client.send(new PutObjectCommand({ Bucket: "test-bucket", Key: "object", Body: fixture }));
  const response = await client.send(new GetObjectCommand({ Bucket: "test-bucket", Key: "object" }));
  assert.equal(Buffer.from(await response.Body.transformToByteArray()).toString(), fixture.toString());
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: "test-bucket", Key: "object" }), { expiresIn: 60 });
  const signedResponse = await fetch(url);
  assert.equal(signedResponse.status, 200);
  assert.equal(await signedResponse.text(), fixture.toString());
  assert.ok(methods.some((method) => method.startsWith("HEAD /test-bucket")));
  assert.ok(methods.some((method) => method.startsWith("PUT /test-bucket/object")));
  assert.ok(methods.filter((method) => method.startsWith("GET /test-bucket/object")).length >= 2);
  console.log("Next standalone S3 smoke passed: HEAD, PUT, GET and presigned GET.");
} finally {
  client.destroy();
  await new Promise((resolveClose) => server.close(resolveClose));
}
