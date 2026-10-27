/** Shapes in text that say what it carries: a card, a credential, a program, a dump. */
import { BULK_ROWS } from './data-classification';
const EMAIL =
  /[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.([A-Za-z]{2,24})\b/g;
/** Not a person: a file named like an address, a documentation domain, a machine. */
const NOT_A_PERSON_TLD: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'js',
  'ts',
  'tsx',
  'jsx',
  'css',
  'json',
  'md',
  'txt',
  'map',
  'lock',
  'test',
  'invalid',
  'local',
  'localhost',
  'example',
]);
const NOT_A_PERSON_LOCAL = /^(git|noreply|no-reply|donotreply|do-not-reply)$/i;
const DOCUMENTATION_DOMAIN = /(^|\.)example$/i;

const INTERNATIONAL_PHONE =
  /(?<![\w+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}\b/g;
const NATIONAL_PHONE = /(?<![\w-])(?:\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\d{3}-\d{3}-\d{4})\b/;
const CARD_CANDIDATE = /(?<![\w-])[3-6]\d{3}(?:[ -]?\d){9,15}\b/g;
const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
export const SSN = /(?<![\w-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\w-])/;
export const NINO =
  /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/;
export const PASSPORT_IN_TEXT = /\bpassport (?:no\.?|number|#)\s*:?\s*[A-Z0-9]{6,9}\b/i;
export const BIRTH_DATE =
  /\b(?:dob|date of birth|born(?: on)?)\s*[:=-]?\s*(?:\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d{1,2} [A-Z][a-z]+ \d{4}|[A-Z][a-z]+ \d{1,2},? \d{4})/i;
export const STREET_ADDRESS =
  /\b\d{1,5} (?:[A-Z][a-zA-Z]+ ){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Close|Crescent)\b/;

export const MONEY =
  /(?:[$€£¥]\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*\.\d{2}\s?(?:USD|EUR|GBP|CHF|JPY|CAD|AUD)\b)/;
export const MONEY_DOCUMENT =
  /\b(?:invoice|payroll|payslip|pay stub|remittance|salary)\b/i;

/** Terms only a medical record uses; two distinct ones make one, so a stray word does not. */
export const HEALTH_TERMS: readonly RegExp[] = [
  /\bdiagnos(?:is|ed|es)\b/i,
  /\bprescri(?:bed|ption)\b/i,
  /\bmedical record\b/i,
  /\bMRN\b/,
  /\bICD-?10\b/i,
  /\bblood type\b/i,
  /\ballerg(?:y|ic|ies) to\b/i,
  /\b(?:HIV|hepatitis|diabetes|cancer|chemotherapy|pregnan(?:t|cy)|depression|schizophrenia)\b/i,
  /\b\d+\s?mg\b/i,
  /\bpatient\b/i,
];

/** Markings a document carries about itself. Upper case alone, since the word is common. */
export const CONFIDENTIAL_MARKINGS: readonly RegExp[] = [
  /(?:^|[\s[(*#])(?:CONFIDENTIAL|INTERNAL ONLY|RESTRICTED|PROPRIETARY)(?=[\s\])*.,]|$)/m,
  /\b(?:strictly|highly|company|business|commercially) confidential\b/i,
  /\bconfidential (?:and|&) proprietary\b/i,
  /\binternal (?:use )?only\b/i,
  /\bdo not (?:distribute|forward|share externally)\b/i,
  /\bnot for (?:distribution|external (?:use|distribution))\b/i,
  /\b(?:under|covered by) (?:an? |the )?NDA\b/i,
];

/** Lines that open the way a program's lines do, in the languages agents mostly write. */
const CODE_LINE =
  /^\s*(?:import\s|export\s|from\s+\S+\s+import\s|package\s|#include\b|using\s|def\s|class\s|function\b|async\s|const\s|let\s|var\s|public\s|private\s|protected\s|fn\s|func\s|pub\s|impl\s|return\b|if\s*\(|for\s*\(|while\s*\(|}\s*(?:else\b.*)?$|[)\]};]+;?$|@\w+|\/\/|#!)/;
const LINE_ENDS_LIKE_CODE = /[;{}]\s*$/;
const CODE_LINES_NEEDED = 10;

/** A file under the repository is sent whole when a call names it, whatever it holds. */
export const SOURCE_FILE =
  /(?:^@?|\/)[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|c|cc|cpp|h|hpp|cs|scala|sql|sh|vue|svelte)$/i;

export const UPLOADED_FILE = /(?:^|=)@([^\s;]+)/;
const FORM_ENCODED = /^[\w.%[\]-]+=[^&\s]*(?:&[\w.%[\]-]+=[^&\s]*)+$/;
const SQL_INSERT = /^\s*INSERT\s+INTO\b/gim;
const SQL_COPY = /^\s*COPY\s+\S+.*\bFROM\s+stdin\b/im;
const SQL_TUPLE = /^\s*\(.*\),?\s*;?\s*$/gm;

/** A named value that is a reference to a secret rather than the secret itself. */
const SECRET_REFERENCE =
  /^(?:process\.env|os\.environ|env\.|import\.meta|\$\{|\$[A-Z_]|<|\[|\*+$|x{3,}$|changeme|your[-_ ]|example|placeholder|string|number|boolean|undefined|null|true|false|none|required|optional|redacted)/i;
const IDENTIFIER_PATH = /^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$|\(/;

/** Ten lines or more that open or end the way a program's do, and most of them. */
export function looksLikeCode(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < CODE_LINES_NEEDED) return false;
  const coded = lines.filter(
    (line) => CODE_LINE.test(line) || LINE_ENDS_LIKE_CODE.test(line),
  ).length;
  return coded >= CODE_LINES_NEEDED && coded * 2 >= lines.length;
}

export function looksLikeDump(text: string): boolean {
  if (SQL_COPY.test(text)) return true;
  const inserts = text.match(SQL_INSERT)?.length ?? 0;
  const tuples = text.match(SQL_TUPLE)?.length ?? 0;
  return inserts >= BULK_ROWS || tuples >= BULK_ROWS;
}

/** A value that is the credential, not a name for where one is kept. */
export function isLiteralSecret(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8) return false;
  if (SECRET_REFERENCE.test(trimmed) || IDENTIFIER_PATH.test(trimmed)) return false;
  return true;
}

/** JSON or a form body, read as the object it is, since flattened arguments arrive as text. */
export function structuredIn(text: string): unknown {
  const first = text[0];
  if (first === '{' || first === '[') {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Text that only opens like JSON is read as text.
      return null;
    }
  }
  if (FORM_ENCODED.test(text)) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return null;
}

export function hasPersonEmail(text: string): boolean {
  if (!text.includes('@')) return false;
  for (const match of text.matchAll(EMAIL)) {
    const [whole, domain = '', tld = ''] = match;
    const local = whole.slice(0, whole.indexOf('@'));
    if (NOT_A_PERSON_LOCAL.test(local)) continue;
    if (NOT_A_PERSON_TLD.has(tld.toLowerCase())) continue;
    if (DOCUMENTATION_DOMAIN.test(domain) || /^example$/i.test(domain)) continue;
    return true;
  }
  return false;
}

export function hasPhone(text: string): boolean {
  if (NATIONAL_PHONE.test(text)) return true;
  for (const [whole] of text.matchAll(INTERNATIONAL_PHONE)) {
    const digits = whole.replace(/\D/g, '').length;
    if (digits >= 8 && digits <= 15) return true;
  }
  return false;
}

export function hasCard(text: string): boolean {
  for (const [whole] of text.matchAll(CARD_CANDIDATE)) {
    const digits = whole.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    if (/^(\d)\1+$/.test(digits)) continue;
    if (luhn(digits)) return true;
  }
  return false;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function hasIban(text: string): boolean {
  for (const [whole] of text.matchAll(IBAN_CANDIDATE)) {
    const compact = whole.replace(/ /g, '');
    if (compact.length >= 15 && compact.length <= 34 && ibanChecks(compact)) return true;
  }
  return false;
}

/** ISO 13616: the country and check digits moved to the end, read as a number mod 97. */
function ibanChecks(iban: string): boolean {
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of moved) {
    const code = char.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
