export const MAX_FILE = 10 * 1024 * 1024;
export function cleanName(name) {
  if (typeof name !== 'string') throw new Error('Nombre inválido');
  const value = name.trim().normalize('NFC');
  if (!value || value.length > 150 || /[\x00-\x1f/\\]/u.test(value)) throw new Error('Usa un nombre de 1 a 150 caracteres sin diagonales');
  return value;
}
export function ownedKey(key, userId) {
  return typeof key === 'string' && key.startsWith(userId + '/') && !key.includes('..');
}
export function validId(id) { return typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id); }
