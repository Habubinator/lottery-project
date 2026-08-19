export function isDate(value: any) {
  return value instanceof Date && !isNaN(value.getTime());
}
