/** The list and export filter the same bounded source rows, after the list limit. */
export function filterIncidents<T extends {kind:string;status:string}>(rows:readonly T[],kind:string,status:string):T[] {
  return rows.filter(row=>(!kind || row.kind===kind) && (!status || row.status===status));
}
