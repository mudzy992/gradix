export function filterEquipment<T extends {isActive:boolean;categoryId:string;code:string;name:string;plate:string|null;make:string|null;model:string|null}>(
  machines:readonly T[],text:string,category:string,showInactive:boolean,
):T[] {
  const needle=text.trim().toLowerCase();
  return machines.filter(machine=>{
    if (!showInactive && !machine.isActive) return false;
    if (category && machine.categoryId !== category) return false;
    return !needle || `${machine.code} ${machine.name} ${machine.plate ?? ""} ${machine.make ?? ""} ${machine.model ?? ""}`.toLowerCase().includes(needle);
  });
}
