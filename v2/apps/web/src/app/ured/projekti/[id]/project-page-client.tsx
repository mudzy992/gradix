"use client";

/**
 * Duboki link: isti `ProjectDetail` kao iz liste, ali kao STRANICA (bez dijaloga preko liste).
 *
 * `ProjectDetail` je namjerno dijalog — iz liste se vraća fokus na red. Ovdje se dijalog koristi
 * kao okvir ekrana (naslov + tabovi + sadržaj): jedna komponenta, jedan obrazac, bez drugog
 * prikaza koji bi se s vremenom razišao sa listom.
 */
import { useRouter } from "next/navigation";
import type { Project } from "@gradix/contracts";
import { ProjectDetail } from "../project-detail";

export function ProjectPageClient({
  project,
  initialCosts = false,
  initialPending = false,
  canManage,
  canBook = canManage,
  canApproveManual = false,
  canAssign,
  canOverride,
  canSeeMoney,
}: {
  project: Project;
  initialCosts?: boolean;
  initialPending?: boolean;
  canManage: boolean;
  canBook?: boolean;
  canApproveManual?: boolean;
  canAssign: boolean;
  canOverride: boolean;
  canSeeMoney: boolean;
}) {
  const router = useRouter();
  return (
    <ProjectDetail
      project={project}
      initialCosts={initialCosts}
      initialPending={initialPending}
      canManage={canManage}
      canBook={canBook}
      canApproveManual={canApproveManual}
      canAssign={canAssign}
      canOverride={canOverride}
      canSeeMoney={canSeeMoney}
      onClose={() => router.push("/ured/projekti")}
      onChanged={async () => {
        router.refresh();
      }}
      onEdit={() => router.push("/ured/projekti")}
    />
  );
}
