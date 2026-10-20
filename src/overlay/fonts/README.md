# Schrift für die Korrekturen

Die Korrekturen werden in **Caveat** geschrieben (SIL Open Font License 1.1, Lizenztext in `OFL.txt`). Die Schrift liegt lokal im Repository, damit die App ohne Netzzugriff auskommt und die CSP unverändert bleibt.

- Quelle: `ofl/caveat/Caveat[wght].ttf` im Repository [google/fonts](https://github.com/google/fonts), Commit `47d54ca1ebb14fd864695f1d39dc734f39017c33`.
- Datei: `Caveat-latin.woff2`, ein auf Latein (Umlaute, ß, typografische Anführungszeichen, Euro) beschränkter Ausschnitt mit erhaltener Gewichtsachse (400 bis 700).
- Erzeugt mit:

```bash
pyftsubset 'Caveat[wght].ttf' \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2013,U+2018-201E,U+2026,U+20AC,U+1E9E" \
  --layout-features='*' --flavor=woff2 --output-file=Caveat-latin.woff2
```
