import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import PgBoss from "pg-boss";
import { DeleteObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { guard } from "./guard";
import { getVerifiedPool } from "./db";
import { POST } from "../app/api/report-jobs/route";
import { GET as DOWNLOAD } from "../app/api/report-jobs/[id]/download/route";
import { dispatchReportJobs } from "../../../worker/src/report-job-dispatch";
import { queueHealth } from "./queue-health";

vi.mock("./guard",()=>({guard:vi.fn()}));
vi.mock("./db",()=>({getVerifiedPool:vi.fn()}));
const adminUrl=process.env.DATABASE_ADMIN_URL, appUrl=process.env.DATABASE_URL;
const run=adminUrl && appUrl ? describe : describe.skip;
const name=`report_flow_${process.pid}_${Date.now()}`;
const rootUrl=new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname="/postgres";
const dbUrl=new URL(rootUrl); dbUrl.pathname=`/${name}`;
const runtimeUrl=new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname=`/${name}`;
const migrations=fileURLToPath(new URL("../../../../packages/db/migrations",import.meta.url));
const workerDir=fileURLToPath(new URL("../../../worker/",import.meta.url));
const workerMain=fileURLToPath(new URL("../../../worker/dist/main.js",import.meta.url));

run("report jobs: API, pg-boss worker i S3-compatible adapter",()=>{
  const root=new Client(rootUrl.toString()), admin=new Client(dbUrl.toString());
  const app=new Pool({connectionString:runtimeUrl.toString(),max:5});
  const objects=new Map<string,{body:Buffer;contentType:string}>();
  let server:Server, worker:ChildProcess, boss:PgBoss, endpoint:string, workerLog="";
  let realStorage:S3Client | undefined;
  const realEndpoint=process.env.REPORT_FLOW_MINIO_ENDPOINT;
  const bucket=realEndpoint ? process.env.REPORT_FLOW_MINIO_BUCKET : "gradix-v2";
  beforeAll(async()=>{
    await root.connect(); await root.query(`CREATE DATABASE ${name}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/roles.sql",import.meta.url)),"utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/grants.sql",import.meta.url)),"utf8"));
    await admin.query("INSERT INTO public.companies(id,name,slug) VALUES ('flow-a','A','flow-a'),('flow-b','B','flow-b')");
    await admin.query("INSERT INTO public.users(id,email,first_name,last_name,password_hash,must_change_password) VALUES ('flow-u','flow@example.test','A','B','x',false)");
    await admin.query(`INSERT INTO public.memberships(id,company_id,user_id,roles,scope) VALUES ('flow-m','flow-a','flow-u',ARRAY['OWNER']::"Role"[],'COMPANY')`);
    await admin.query("INSERT INTO public.projects(id,company_id,code,name) VALUES ('flow-p','flow-a','P','P')");
    if (realEndpoint) {
      const access=process.env.REPORT_FLOW_MINIO_ACCESS_KEY, secret=process.env.REPORT_FLOW_MINIO_SECRET_KEY;
      if (!access || !secret || !bucket) throw new Error("REPORT_FLOW_MINIO_* test configuration missing");
      endpoint=realEndpoint;
      realStorage=new S3Client({endpoint,region:"us-east-1",forcePathStyle:true,credentials:{accessKeyId:access,secretAccessKey:secret}});
      await realStorage.send(new HeadBucketCommand({Bucket:bucket}));
      for (const [key,value] of Object.entries({MINIO_ENDPOINT:endpoint,MINIO_PUBLIC_ENDPOINT:endpoint,
        MINIO_ACCESS_KEY:access,MINIO_SECRET_KEY:secret,MINIO_BUCKET:bucket})) vi.stubEnv(key,value);
    } else {
      server=createServer((req,res)=>{
        const key=(req.url ?? "").split("?")[0]!;
        if (req.method === "PUT") {
          const chunks:Buffer[]=[]; req.on("data",chunk=>chunks.push(Buffer.from(chunk)));
          req.on("end",()=>{objects.set(key,{body:Buffer.concat(chunks),contentType:String(req.headers["content-type"])});res.writeHead(200);res.end();});
        } else {
          const object=objects.get(key);
          if (!object) {res.writeHead(404);res.end();return;}
          res.writeHead(200,{"Content-Length":object.body.length,"Content-Type":object.contentType});
          res.end(req.method === "HEAD" ? undefined : object.body);
        }
      });
      await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
      const addr=server.address(); if (!addr || typeof addr === "string") throw new Error("server address");
      endpoint=`http://127.0.0.1:${addr.port}`;
      for (const [key,value] of Object.entries({MINIO_ENDPOINT:endpoint,MINIO_PUBLIC_ENDPOINT:endpoint,MINIO_ACCESS_KEY:"key",MINIO_SECRET_KEY:"secret"})) vi.stubEnv(key,value);
    }
    execFileSync(process.execPath,["build.mjs"],{cwd:workerDir});
    worker=spawn(process.execPath,[workerMain],{env:{...process.env,NODE_ENV:"test",DATABASE_URL:runtimeUrl.toString(),
      DATABASE_ADMIN_URL:dbUrl.toString(),BOSS_DATABASE_URL:dbUrl.toString(),WORKER_CONCURRENCY:"2"},stdio:["ignore","pipe","pipe"]});
    worker.stderr?.on("data",chunk=>{workerLog+=String(chunk);});
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`worker startup timeout ${workerLog}`)),30_000);
      worker.stdout?.on("data",chunk=>{workerLog+=String(chunk);if(workerLog.includes("worker pokrenut")){clearTimeout(timer);resolve();}});
      worker.once("exit",code=>{clearTimeout(timer);reject(new Error(`worker exited ${code}: ${workerLog}`));});
    });
    boss=new PgBoss({connectionString:dbUrl.toString(),schema:"pgboss"}); await boss.start();
    vi.mocked(getVerifiedPool).mockResolvedValue(app);
    vi.mocked(guard).mockResolvedValue({ok:true,ctx:{userId:"flow-u",companyId:"flow-a",roles:["OWNER"],scope:"COMPANY",projectIds:null}} as never);
  },120_000);
  afterAll(async()=>{
    if (boss) await boss.stop();
    if (worker && worker.exitCode === null) {const done=new Promise<void>(resolve=>worker.once("exit",()=>resolve()));worker.kill("SIGTERM");await done;}
    if (server) await new Promise<void>(resolve=>server.close(()=>resolve()));
    if (realStorage && bucket) {
      const keys=await admin.query<{object_key:string}>("SELECT object_key FROM public.attachments WHERE company_id='flow-a' AND entity_type='REPORT_JOB'");
      for (const row of keys.rows) await realStorage.send(new DeleteObjectCommand({Bucket:bucket,Key:row.object_key}));
      realStorage.destroy();
    }
    vi.unstubAllEnvs(); await app.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end();
  },60_000);
  it("POST → outbox → stvarni worker → S3 → inbox → autorizovan download",async()=>{
    let lastId="";
    for (const format of ["pdf","xlsx"] as const) {
      const response=await POST(new NextRequest("http://localhost/api/report-jobs",{method:"POST",body:JSON.stringify({
        key:"HSE",from:"2026-01-01",to:"2026-01-31",format})}));
      expect(response.status).toBe(200);
      const job=(await response.json()).data;
      lastId=job.id;
      expect(job.status).toBe("QUEUED");
      await dispatchReportJobs(app,(queue,data,options)=>boss.send(queue,data,options),{onlyCompanyId:"flow-a"});
      let state="";
      for (let i=0;i<80;i++) {
        state=(await admin.query("SELECT status FROM public.report_jobs WHERE id=$1",[job.id])).rows[0]?.status;
        if (state === "DONE" || state === "FAILED") break;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      expect(state,workerLog).toBe("DONE");
      const notice=await admin.query("SELECT href,user_id FROM public.notifications WHERE company_id='flow-a' AND dedupe_key=$1",[`report-job:${job.id}`]);
      expect(notice.rows).toEqual([{href:"/pregled",user_id:"flow-u"}]);
      expect((await queueHealth(app)).jobs).toContainEqual(expect.objectContaining({name:"report_jobs"}));
      const context={params:Promise.resolve({id:job.id})};
      const link=await DOWNLOAD(new NextRequest(`http://localhost/api/report-jobs/${job.id}/download`),context);
      expect(link.status).toBe(200);
      const data=(await link.json()).data;
      const bytes=Buffer.from(await (await fetch(data.url)).arrayBuffer());
      expect(bytes.subarray(0,format === "pdf" ? 5 : 2).toString()).toBe(format === "pdf" ? "%PDF-" : "PK");
    }
    if (!realEndpoint) expect(objects.size).toBe(2);
    const context={params:Promise.resolve({id:lastId})};
    vi.mocked(guard).mockResolvedValueOnce({ok:true,ctx:{userId:"flow-u",companyId:"flow-b",roles:["OWNER"],scope:"COMPANY",projectIds:null}} as never);
    expect((await DOWNLOAD(new NextRequest(`http://localhost/api/report-jobs/${lastId}/download`),context)).status).toBe(404);
    await admin.query("UPDATE public.memberships SET is_active=false WHERE id='flow-m'");
    expect((await DOWNLOAD(new NextRequest(`http://localhost/api/report-jobs/${lastId}/download`),context)).status).toBe(404);
  },60_000);
});
