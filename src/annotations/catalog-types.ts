export interface ErrorExample {
  before: string;
  original: string;
  correction: string;
  after: string;
}

export interface ErrorKind {
  code: string;
  name: string;
  description: string;
  example: ErrorExample;
}

export interface LanguageCatalog {
  name: string;
  kinds: readonly ErrorKind[];
}
