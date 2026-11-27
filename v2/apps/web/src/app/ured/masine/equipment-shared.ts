/**
 * Dijeljeni tipovi ekrana mašina (A2): klijent, dijalozi i kategorije uvoze odatle,
 * umjesto ciklusa klijent ↔ dijalozi/kategorije. Klijent re-izvozi tipove.
 */
import type { EquipmentCategory, Machine as MachineApi } from "@gradix/contracts";

export type CategoryRow = EquipmentCategory;

/**
 * Ekran koristi isti tip kao ugovor (`Machine`), samo pod kraćim imenom; `MachineRow` u servisu
 * je serverski red i nema šta da traži u klijentu.
 */
export type MachineRow = MachineApi;
