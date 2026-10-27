/** A field that says something about one person, read off its name before its value. */
export const PERSONAL_FIELD = {
  EMAIL: 'email',
  PHONE: 'phone',
  ADDRESS: 'address',
  CARD: 'card',
  IBAN: 'iban',
  NATIONAL_ID: 'national-id',
  BIRTH_DATE: 'birth-date',
  NAME: 'name',
} as const;

export type PersonalField = (typeof PERSONAL_FIELD)[keyof typeof PERSONAL_FIELD];

/** Fields that on their own name somebody beyond reach of a directory. */
export const STRONG_FIELDS: ReadonlySet<PersonalField> = new Set([
  PERSONAL_FIELD.ADDRESS,
  PERSONAL_FIELD.CARD,
  PERSONAL_FIELD.IBAN,
  PERSONAL_FIELD.NATIONAL_ID,
  PERSONAL_FIELD.BIRTH_DATE,
]);

export const PERSONAL_KEYS: Readonly<Record<string, PersonalField>> = {
  email: PERSONAL_FIELD.EMAIL,
  emailaddress: PERSONAL_FIELD.EMAIL,
  mail: PERSONAL_FIELD.EMAIL,
  contactemail: PERSONAL_FIELD.EMAIL,
  customeremail: PERSONAL_FIELD.EMAIL,
  phone: PERSONAL_FIELD.PHONE,
  phonenumber: PERSONAL_FIELD.PHONE,
  mobile: PERSONAL_FIELD.PHONE,
  mobilenumber: PERSONAL_FIELD.PHONE,
  tel: PERSONAL_FIELD.PHONE,
  telephone: PERSONAL_FIELD.PHONE,
  cell: PERSONAL_FIELD.PHONE,
  address: PERSONAL_FIELD.ADDRESS,
  streetaddress: PERSONAL_FIELD.ADDRESS,
  street: PERSONAL_FIELD.ADDRESS,
  address1: PERSONAL_FIELD.ADDRESS,
  addressline1: PERSONAL_FIELD.ADDRESS,
  billingaddress: PERSONAL_FIELD.ADDRESS,
  shippingaddress: PERSONAL_FIELD.ADDRESS,
  postcode: PERSONAL_FIELD.ADDRESS,
  postalcode: PERSONAL_FIELD.ADDRESS,
  zip: PERSONAL_FIELD.ADDRESS,
  zipcode: PERSONAL_FIELD.ADDRESS,
  dob: PERSONAL_FIELD.BIRTH_DATE,
  dateofbirth: PERSONAL_FIELD.BIRTH_DATE,
  birthdate: PERSONAL_FIELD.BIRTH_DATE,
  birthday: PERSONAL_FIELD.BIRTH_DATE,
  cardnumber: PERSONAL_FIELD.CARD,
  ccnumber: PERSONAL_FIELD.CARD,
  creditcard: PERSONAL_FIELD.CARD,
  iban: PERSONAL_FIELD.IBAN,
  fullname: PERSONAL_FIELD.NAME,
  firstname: PERSONAL_FIELD.NAME,
  lastname: PERSONAL_FIELD.NAME,
  surname: PERSONAL_FIELD.NAME,
  givenname: PERSONAL_FIELD.NAME,
  familyname: PERSONAL_FIELD.NAME,
  customername: PERSONAL_FIELD.NAME,
  contactname: PERSONAL_FIELD.NAME,
};

/** Keys naming a government identifier, which is a personal field as well. */
export const GOVERNMENT_KEYS: ReadonlySet<string> = new Set([
  'ssn',
  'socialsecuritynumber',
  'nationalid',
  'nationalidnumber',
  'nin',
  'nino',
  'passport',
  'passportnumber',
  'taxid',
  'tin',
  'driverslicense',
  'driverlicense',
  'driverslicence',
  'driverlicence',
]);

/** Keys that on their own say the value is money somebody holds or is owed. */
export const FINANCIAL_KEYS: ReadonlySet<string> = new Set([
  'cardnumber',
  'ccnumber',
  'creditcard',
  'cvv',
  'cvc',
  'iban',
  'bankaccount',
  'accountnumber',
  'routingnumber',
  'sortcode',
  'salary',
  'grosspay',
  'netpay',
  'payroll',
  'payslip',
]);

/** Keys that together make an invoice: two of them, one naming the document itself. */
export const INVOICE_KEYS: ReadonlySet<string> = new Set([
  'invoice',
  'invoiceid',
  'invoicenumber',
  'invoicedate',
  'billto',
  'payee',
  'amountdue',
  'totaldue',
  'subtotal',
  'taxamount',
  'duedate',
]);
export const INVOICE_NAMING: ReadonlySet<string> = new Set([
  'invoice',
  'invoiceid',
  'invoicenumber',
  'billto',
  'payee',
]);

export const HEALTH_KEYS: ReadonlySet<string> = new Set([
  'diagnosis',
  'diagnoses',
  'icd10',
  'icdcode',
  'medication',
  'medications',
  'prescription',
  'prescriptions',
  'allergies',
  'bloodtype',
  'medicalrecordnumber',
  'mrn',
  'treatment',
  'symptoms',
  'patient',
  'patients',
]);

/** Keys that say the value under them is about a customer, whatever else it holds. */
export const RECORD_KEYS: ReadonlySet<string> = new Set([
  'customer',
  'customers',
  'client',
  'clients',
  'patient',
  'patients',
  'contact',
  'contacts',
  'accountholder',
  'cardholder',
]);

/** Keys a document states its own classification under. */
export const MARKING_KEYS: ReadonlySet<string> = new Set([
  'classification',
  'sensitivity',
  'confidentiality',
]);
export const MARKING_VALUES =
  /^(confidential|internal|internal only|restricted|secret|nda|proprietary)$/i;

/** Keys naming a file a call hands over. */
export const FILE_KEYS: ReadonlySet<string> = new Set([
  'file',
  'files',
  'path',
  'filepath',
  'filename',
  'attachment',
  'attachments',
  'upload',
]);

/** `name` is everywhere in tool arguments, so it counts only shaped like a person's. */
export const BARE_NAME_KEY = 'name';
export const PERSON_NAME = /^[A-Z][a-z'-]+(?: [A-Z][a-z'-]+){1,3}$/;

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isFilled(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
