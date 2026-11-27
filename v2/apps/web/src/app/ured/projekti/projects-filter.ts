/** Shared list/export filter; financial risk comes from the existing server summary. */
export function filterProjects<T extends {id:string;status:string}>(rows:readonly T[],status:string,risky:boolean,financials:Record<string,{risky:boolean}>):T[] {
  return rows.filter(row=>(!status || row.status===status) && (!risky || financials[row.id]?.risky === true));
}
