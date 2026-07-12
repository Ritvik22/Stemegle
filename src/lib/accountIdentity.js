const SYNTHETIC_ACCOUNT_DOMAIN = 'players.stemegle.com';

function normalizedBattleName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function identityHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function battleNameToAccountEmail(value) {
  const name = normalizedBattleName(value);
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
  if (slug.length < 2) return '';
  return `${slug}.${identityHash(name.toLowerCase())}@${SYNTHETIC_ACCOUNT_DOMAIN}`;
}

export function loginIdentityToEmail(value) {
  const identity = String(value || '').trim().toLowerCase();
  if (!identity || identity.length > 320) return '';
  return identity.includes('@') ? identity : battleNameToAccountEmail(identity);
}

export function isSyntheticAccountEmail(value) {
  return String(value || '').toLowerCase().endsWith(`@${SYNTHETIC_ACCOUNT_DOMAIN}`);
}
