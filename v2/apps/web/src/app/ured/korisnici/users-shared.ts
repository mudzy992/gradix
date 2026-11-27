/**
 * Dijeljeni tipovi ekrana korisnika (A2): klijent i dijalozi uvoze odatle direktno,
 * umjesto dijalog → klijent → dijalog (ciklus). Klijent i dalje re-izvozi isti tip,
 * pa postojeći uvozi (`./users-client`) rade nepromijenjeno.
 */
export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  scope: string;
  createdAt: string;
};

export type IssuedLink = { link: string; email: string; expiresAt: string } | null;
