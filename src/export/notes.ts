export function incompletePagesNote(counted: number, pages: number): string {
  return `Unvollständig: ${counted} von ${pages} Seiten gezählt`;
}

export function incompleteArbeitenNote(complete: number, arbeiten: number): string {
  return `Unvollständig: ${complete} von ${arbeiten} Arbeiten vollständig gezählt`;
}
