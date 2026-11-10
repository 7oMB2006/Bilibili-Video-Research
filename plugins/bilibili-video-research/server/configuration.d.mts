export interface Configuration {
  values: Record<string, string | number | boolean>;
  secrets: Record<string, string>;
  revision: string;
}
export class ConfigurationReader {
  constructor(packageUrl: URL);
  current(): Promise<Configuration>;
}
export function clearInheritedCredentials(): void;
