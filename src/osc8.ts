const ESC = '\x1b';

export function osc8(url: string, label: string): string {
  return `${ESC}]8;;${url}${ESC}\\${label}${ESC}]8;;${ESC}\\`;
}
