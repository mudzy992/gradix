/** Zavisnosti ne smiju proći prije uspješne potvrde roditeljskog offline reda. */
import type { R4SyncPushItem } from "@gradix/domain";

export type UnresolvedRow = { item: R4SyncPushItem; status: string };

function sameDiary(a: R4SyncPushItem, b: R4SyncPushItem): boolean {
  const key = (item: R4SyncPushItem): [string | undefined, string | undefined] => {
    if (item.entityType === "site_diary") return [item.diary.projectId, item.diary.diaryDate];
    if (item.entityType === "site_diary_item") return [item.diaryProjectId, item.diaryDate];
    return [undefined, undefined];
  };
  const [project, date] = key(a);
  const [otherProject, otherDate] = key(b);
  return Boolean(project && date && project === otherProject && date === otherDate);
}

/** Ulaz je poredan po lokalnom redoslijedu upisa, ne po nasumičnom UUID-u. */
export function readyR4Rows(rows: readonly UnresolvedRow[]): R4SyncPushItem[] {
  return rows.flatMap(({ item, status }, index) => {
    if (status !== "pending" && status !== "failed") return [];
    const blocked = rows.some(({ item: parent }, parentIndex) => {
      if (parent.localId === item.localId) return false;
      if (item.entityType === "hse_action" && item.action.incidentId &&
          parent.entityType === "hse_incident" && parent.incidentId === item.action.incidentId) return true;
      if (!sameDiary(item, parent)) return false;
      if (item.entityType === "site_diary_item") {
        return parent.entityType === "site_diary" && !parent.diary.signature;
      }
      if (item.entityType === "site_diary" && item.diary.signature) {
        return parent.entityType === "site_diary_item" ||
          (parent.entityType === "site_diary" && (!parent.diary.signature || parentIndex < index));
      }
      return item.entityType === "site_diary" && parent.entityType === "site_diary" &&
        !parent.diary.signature && parentIndex < index;
    });
    return blocked ? [] : [item];
  });
}
