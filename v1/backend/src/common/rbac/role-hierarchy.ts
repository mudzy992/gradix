import { AppRole } from './roles';

/**
 * BE-03 — ko smije mijenjati koga.
 *
 * Pravilo je namjerno minimalno: **ne možeš dirati korisnika koji ima rolu koju ni sam ne možeš
 * dodijeliti**. Bez toga ADMIN (koji ima `users.write`) može resetovati lozinku SUPER_ADMIN-u i
 * preuzeti njegov nalog — to je eskalacija privilegija, ne administracija.
 */

/** Role koje niko ne smije dodijeliti kroz tenant rute. */
const NON_ASSIGNABLE: readonly AppRole[] = ['PLATFORM_ADMIN'];

/** Role koje smije dodijeliti/ukloniti samo ``SUPER_ADMIN`` ili ``PLATFORM_ADMIN``. */
const SUPER_ONLY: readonly AppRole[] = ['SUPER_ADMIN'];

export function canManageRoles(
  actorRoles: readonly AppRole[],
  targetRoles: readonly AppRole[],
): boolean {
  const actorIsPlatform = actorRoles.includes('PLATFORM_ADMIN');
  const actorIsSuper = actorIsPlatform || actorRoles.includes('SUPER_ADMIN');
  for (const role of targetRoles) {
    if (NON_ASSIGNABLE.includes(role) && !actorIsPlatform) return false;
    if (SUPER_ONLY.includes(role) && !actorIsSuper) return false;
  }
  return true;
}

export function canAssignRoles(
  actorRoles: readonly AppRole[],
  nextRoles: readonly AppRole[],
): boolean {
  // Dodjela je stroža od upravljanja: niko ne dodjeljuje PLATFORM_ADMIN kroz tenant rute.
  if (nextRoles.some((role) => NON_ASSIGNABLE.includes(role))) return false;
  const actorIsSuper =
    actorRoles.includes('PLATFORM_ADMIN') || actorRoles.includes('SUPER_ADMIN');
  if (nextRoles.includes('SUPER_ADMIN') && !actorIsSuper) return false;
  return true;
}
