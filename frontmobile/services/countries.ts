import countryNames from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import fr from 'i18n-iso-countries/langs/fr.json';
import { getCountries } from 'libphonenumber-js';

// Noms de pays embarques (et non `Intl.DisplayNames`) : le moteur JavaScript de l'application n'en dispose pas sur tous
// les telephones, et sans lui la liste n'affichait que des codes (« SN »), sans correspondance avec « Sénégal ».
countryNames.registerLocale(fr);
countryNames.registerLocale(en);

export interface Country {
  /** ISO 3166-1 alpha-2 code, e.g. `SN`. */
  code: string;
  /** Name in the requested locale, e.g. `Sénégal`. This is what the certificate form stores. */
  name: string;
  /** Flag emoji built from the code. */
  flag: string;
}

// Senegal is the use case of the product: it is pinned at the top of the list.
const PINNED_FIRST = 'SN';

const flagOf = (code: string): string =>
  String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));

// Same text, minus case and accents, so "senegal" finds "Sénégal".
const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const cache = new Map<string, Country[]>();

/**
 * Countries known to libphonenumber-js (the same list the phone fields use), named in `locale` (`fr` or `en`),
 * sorted alphabetically with Senegal first. A code with no name in that locale (special territory) is dropped.
 */
export const getCountryList = (locale: 'fr' | 'en' | string = 'fr'): Country[] => {
  const cached = cache.get(locale);
  if (cached) return cached;

  const list = getCountries()
    .map((code) => ({ code, name: countryNames.getName(code, locale) ?? '', flag: flagOf(code) }))
    .filter((country) => country.name !== '')
    .sort((a, b) => {
      if (a.code === PINNED_FIRST) return -1;
      if (b.code === PINNED_FIRST) return 1;
      return a.name.localeCompare(b.name, locale);
    });

  cache.set(locale, list);
  return list;
};

export const filterCountries = (list: Country[], query: string): Country[] => {
  const needle = normalize(query);
  if (!needle) return list;
  return list.filter((country) => normalize(country.name).includes(needle) || country.code.toLowerCase() === needle);
};

/**
 * A stored value is normally the country name, but older data may hold the bare code (`SN`, saved while the list was
 * named by codes): both resolve to the same country, so the flag and the full name are always shown.
 */
export const findCountryByName = (list: Country[], name: string | undefined): Country | undefined => {
  if (!name) return undefined;
  const needle = normalize(name);
  return list.find((country) => normalize(country.name) === needle) ?? list.find((country) => country.code.toLowerCase() === needle);
};
