export function hasPerm(permissions: string[] | undefined, ...needed: string[]): boolean {
  if (!permissions) {
    return false;
  }
  return needed.some((item) => permissions.includes(item));
}

export function tabFlags(permissions: string[] | undefined) {
  return {
    tasks: hasPerm(permissions, 'tasks.timer', 'tasks.read'),
    trips: hasPerm(permissions, 'trips.write', 'trips.read'),
    diary: hasPerm(permissions, 'diary.write'),
    fuel: hasPerm(permissions, 'fuel.write'),
    hse: hasPerm(permissions, 'hse.write'),
    complete: hasPerm(permissions, 'tasks.write'),
  };
}
