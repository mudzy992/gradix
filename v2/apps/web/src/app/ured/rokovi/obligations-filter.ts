import { targetLabel } from "./obligations-shared";
type Row = Parameters<typeof targetLabel>[0] & {state:string;daysLeft:number|null;typeId:string;typeLabel:string;number:string|null;issuer:string|null};
export function filterObligations<T extends Row>(rows:readonly T[],state:string,type:string,text:string):T[] {
  const needle=text.trim().toLowerCase();
  return rows.filter(row=>{
    if (state === "31-90") { if (row.daysLeft === null || row.daysLeft < 31 || row.daysLeft > 90) return false; }
    else if (state && row.state !== state) return false;
    if (type && row.typeId !== type) return false;
    return !needle || `${row.typeLabel} ${targetLabel(row)} ${row.number ?? ""} ${row.issuer ?? ""}`.toLowerCase().includes(needle);
  });
}
