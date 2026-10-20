# Installer signieren

Der Release-Workflow (`.github/workflows/release.yml`) signiert die Installer, sobald die unten genannten GitHub-Secrets gesetzt sind. Ohne Secrets baut er unsigniert wie bisher. Beide Plattformen sind unabhängig voneinander schaltbar.

## Empfehlung und Kosten

| Plattform | Weg                                                          | Kosten pro Jahr (ungefähr)           |
| --------- | ------------------------------------------------------------ | ------------------------------------ |
| macOS     | Apple Developer Program, Developer ID plus Notarisierung     | 99 USD                               |
| Windows   | Azure Artifact Signing (früher Trusted Signing), Basic-Tarif | rund 120 USD (etwa 10 USD pro Monat) |
| Linux     | nichts                                                       | 0                                    |

Preise und Verfügbarkeit vor dem Kauf prüfen, sie ändern sich.

**Linux:** `.deb`, `.rpm` und AppImage kennen keine verpflichtende Signatur und kein Gatekeeper-Äquivalent. Eine Signatur brächte ohne eigene Paketquelle keinen Nutzen für die Anwender.

**Windows:** Ein klassisches OV-Zertifikat kostet ähnlich viel oder mehr (rund 200–400 USD pro Jahr), der private Schlüssel muss seit 2023 auf einem Hardware-Token oder in einer Cloud-HSM liegen, und SmartScreen vertraut ihm erst nach genug Downloads. Artifact Signing ist günstiger, läuft rein in der Cloud (kein Token), und die Zertifikate sind kurzlebig und werden automatisch erneuert. Voraussetzung ist die Identitätsprüfung durch Microsoft. Ob Microsoft sie für Privatpersonen oder Organisationen in Deutschland anbietet, steht in der [Microsoft-Dokumentation](https://learn.microsoft.com/en-us/azure/artifact-signing/) und muss vor dem Kauf geklärt werden. Ist es nicht möglich, bleibt nur ein OV-Zertifikat mit Cloud-Signierung eines Anbieters. Dann muss `signCommand` im Workflow angepasst werden.

## macOS einrichten

1. Apple Developer Program beitreten (developer.apple.com, 99 USD pro Jahr).
2. Unter Zertifikate ein „Developer ID Application“-Zertifikat erzeugen, in der Schlüsselbundverwaltung als `.p12` mit Passwort exportieren.
3. Unter appleid.apple.com ein app-spezifisches Passwort erzeugen (für die Notarisierung).
4. Das `.p12` als Base64 ausgeben: `base64 -i zertifikat.p12 | pbcopy`.

| Secret                       | Inhalt                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64 des `.p12`                                                                                     |
| `APPLE_CERTIFICATE_PASSWORD` | Passwort des `.p12`                                                                                   |
| `APPLE_SIGNING_IDENTITY`     | z. B. `Developer ID Application: Simon Gehring (TEAMID)` (`security find-identity -v -p codesigning`) |
| `APPLE_ID`                   | Apple-ID-E-Mail                                                                                       |
| `APPLE_PASSWORD`             | app-spezifisches Passwort                                                                             |
| `APPLE_TEAM_ID`              | Team-ID, 10 Zeichen                                                                                   |

Es müssen alle sechs gesetzt sein, sonst wird nicht signiert.

Was der Workflow tut:

- Das Zertifikat kommt in einen temporären Schlüsselbund des Runners.
- Die llama.cpp-Bibliotheken unter `src-tauri/binaries/llama/*.dylib` werden mit Hardened Runtime und Zeitstempel signiert. Tauri signiert App und Sidecar (`rotstift-llama-server`) selbst, die mitgelieferten Ressourcen aber nicht, und die Notarisierung lehnt unsignierte Mach-O-Dateien ab.
- Tauri signiert und notarisiert und heftet das Ticket an.
- Zum Schluss prüfen `codesign --verify`, `stapler validate` und `spctl` das Ergebnis, der Lauf schlägt sonst fehl.

Entitlements: Es ist bewusst keine `Entitlements.plist` hinterlegt. Alle Binärdateien tragen dieselbe Signatur, daher greift die Library Validation der Hardened Runtime nicht. llama-server braucht weder JIT noch ausführbaren Speicher, Metal und `mmap` benötigen keine Ausnahme. Stürzt der Sidecar in einem notarisierten Build doch beim Laden einer Bibliothek ab, `com.apple.security.cs.disable-library-validation` als Entitlement ergänzen (`bundle.macOS.entitlements` in `tauri.conf.json`).

## Windows einrichten

1. Azure-Konto anlegen, Ressourcengruppe und einen Artifact-Signing-Account erstellen (Region merken, daraus ergibt sich der Endpunkt, z. B. `https://weu.codesigning.azure.net`).
2. Identitätsprüfung abschließen und ein Zertifikatsprofil vom Typ „Public Trust“ anlegen.
3. In Entra ID eine App-Registrierung mit Client-Secret erstellen und ihr die Rolle „Artifact Signing Certificate Profile Signer“ auf dem Account geben.

| Secret                                       | Inhalt                      |
| -------------------------------------------- | --------------------------- |
| `AZURE_TENANT_ID`                            | Verzeichnis-(Mandanten-)ID  |
| `AZURE_CLIENT_ID`                            | Anwendungs-(Client-)ID      |
| `AZURE_CLIENT_SECRET`                        | Wert des Client-Secrets     |
| `AZURE_ARTIFACT_SIGNING_ENDPOINT`            | Endpunkt-URL des Accounts   |
| `AZURE_ARTIFACT_SIGNING_ACCOUNT`             | Name des Accounts           |
| `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` | Name des Zertifikatsprofils |

Es müssen alle sechs gesetzt sein, sonst wird nicht signiert. Der Workflow installiert dann `artifact-signing-cli` und übergibt Tauri per `--config` ein `signCommand`. Tauri signiert damit die Anwendung und den MSI-/NSIS-Installer.

## Testen

Der Workflow ist nicht in CI ausführbar, ohne einen Release-Entwurf zu erzeugen. Empfohlener Test, ohne Tag:

1. Secrets unter Settings, Secrets and variables, Actions anlegen.
2. Actions, „Release“, „Run workflow“ auf einem Branch. Es entsteht ein Release-Entwurf (nicht veröffentlichen, danach löschen).
3. macOS: Im Log erscheint der Schritt „macOS-Signatur und Notarisierung prüfen“ grün. Das `.dmg` herunterladen und öffnen, es darf kein Gatekeeper-Hinweis kommen. Dann die App starten und ein Modell laden, damit der Sidecar mit Hardened Runtime nachweislich läuft.
4. Windows: Installer herunterladen, Rechtsklick, Eigenschaften, Digitale Signaturen. Alternativ in PowerShell `Get-AuthenticodeSignature .\Rotstift_*.msi`.
5. Ohne gesetzte Secrets gegenprobieren: Die Schritte „Signierung vorbereiten“ melden „nicht signiert“ und der Build läuft wie bisher.

Der Workflow wurde mit actionlint geprüft, die Signaturschritte selbst aber noch nie mit echten Zertifikaten ausgeführt. Der erste echte Lauf kann Nacharbeit brauchen.
