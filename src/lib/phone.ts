/**
 * Normalización de teléfonos al formato de WhatsApp (wa_id: solo dígitos,
 * con código de país). Código puro.
 *
 * Argentina tiene reglas propias: los celulares en WhatsApp llevan un 9 después
 * del 54 y no llevan el 0 de larga distancia ni el 15 local. Como en la práctica
 * los clientes de WhatsApp son celulares, un número argentino cargado en formato
 * local se interpreta como celular. Si el resultado no es el deseado, se puede
 * cargar en formato internacional (+54 9 ...), que se respeta tal cual.
 */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Quita el "15" local de un número argentino de 12 dígitos (código de área + 15 + número). */
function stripArgentineFifteen(digits: string): string {
  if (digits.length !== 12) return digits;
  // El código de área tiene 2, 3 o 4 dígitos y área + número suman 10.
  for (const areaLength of [2, 3, 4]) {
    if (digits.slice(areaLength, areaLength + 2) === "15") {
      return digits.slice(0, areaLength) + digits.slice(areaLength + 2);
    }
  }
  return digits;
}

function normalizeArgentine(national: string): string | null {
  let d = national.replace(/^0+/, "");
  d = stripArgentineFifteen(d);
  if (d.startsWith("9") && d.length === 11) d = d.slice(1);
  return d.length === 10 ? `549${d}` : null;
}

/**
 * Devuelve el wa_id o null si no se puede interpretar.
 *  - "+..." o "00...": internacional, se respeta (en AR se agrega el 9 si falta).
 *  - resto: número local del país por defecto.
 */
export function toWhatsappId(input: string, defaultCountryCode = "54"): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const international = raw.startsWith("+") || raw.startsWith("00");
  let digits = digitsOnly(raw);
  if (raw.startsWith("00")) digits = digits.slice(2);

  if (international) {
    if (digits.startsWith("54")) {
      const rest = digits.slice(2);
      return rest.startsWith("9") && rest.length === 11 ? digits : normalizeArgentine(rest);
    }
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }

  if (defaultCountryCode === "54") {
    // Alguien pudo escribir el 54 sin el "+".
    if (digits.startsWith("549") && digits.length === 13) return digits;
    if (digits.startsWith("54") && digits.length === 12) return normalizeArgentine(digits.slice(2));
    return normalizeArgentine(digits);
  }

  const national = digits.replace(/^0+/, "");
  const full = `${defaultCountryCode}${national}`;
  return national.length >= 6 && full.length <= 15 ? full : null;
}

/** Formato legible para mostrar un wa_id argentino: +54 9 351 555-1234 (aprox.). */
export function formatWhatsappId(waId: string): string {
  if (waId.startsWith("549") && waId.length === 13) {
    const n = waId.slice(3);
    return `+54 9 ${n.slice(0, 3)} ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return `+${waId}`;
}
