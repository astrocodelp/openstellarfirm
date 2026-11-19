// Types for scripts/licences.mjs, so the test in src/ can import it.
export interface LicenceEntry {
  title: string;
  licence: string;
  source: string;
  file?: string;
  text?: string;
}
export function licenceEntries(): LicenceEntry[];
export function licencesText(): string;
export function writeLicences(out?: string): Promise<string>;
