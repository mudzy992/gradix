import type { z } from "zod";
import type { SubcontractContractsResponse, SubcontractStatementsResponse, SubcontractAmendmentsResponse } from "@gradix/contracts";
export type Contract=z.infer<typeof SubcontractContractsResponse>["contracts"][number];
export type Statement=z.infer<typeof SubcontractStatementsResponse>["statements"][number];
export type Amendment=z.infer<typeof SubcontractAmendmentsResponse>["amendments"][number];
export type Partner={id:string;code:string;name:string};
export type Project={id:string;code:string;name:string};
export function money(cents:string):string {const n=BigInt(cents);return `${n/100n}.${(n%100n).toString().padStart(2,"0")}`;}
