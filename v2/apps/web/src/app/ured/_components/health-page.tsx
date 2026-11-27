import { redirect } from "next/navigation";
import type { Pool } from "pg";
import type { DashboardActor } from "@/server/dashboard-aggregates";
import type { HealthKey } from "@/server/data-health-queries";
import { listDataHealth } from "@/server/data-health";
import { HealthList } from "./health-list";

export async function healthPage(pool:Pool, actor:DashboardActor, key:Exclude<HealthKey,"unconfirmed_days">, page:unknown) {
  const result=await listDataHealth(pool,actor,key,typeof page === "string" ? Number(page) : 1);
  if (!result) redirect("/nemate-pristup");
  return <HealthList healthKey={key} {...result} />;
}
