/** Fixed SQL fragments, called only with trusted column/parameter expressions. */
export function sharedWorkdayAssignment(viewerWorkerId:string):string {
  return `EXISTS (
    SELECT 1 FROM public.project_assignments va
    JOIN public.project_assignments ta ON ta.company_id=va.company_id AND ta.project_id=va.project_id
    WHERE va.company_id=d.company_id AND ta.company_id=d.company_id
      AND va.worker_id=${viewerWorkerId} AND ta.worker_id=d.worker_id
      AND va.voided_at IS NULL AND ta.voided_at IS NULL
      AND va.from_date<=d.work_date AND (va.to_date IS NULL OR va.to_date>=d.work_date)
      AND ta.from_date<=d.work_date AND (ta.to_date IS NULL OR ta.to_date>=d.work_date))`;
}
