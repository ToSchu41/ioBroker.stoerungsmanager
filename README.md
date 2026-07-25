# ioBroker.stoerungsmanager

Ein ioBroker-Adapter zur zentralen Erfassung, Verwaltung, Quittierung und Benachrichtigung von Störungen.

## Funktionen

- Konfiguration aller überwachten Datenpunkte über die Admin-Weboberfläche
- Bedingungen: wahr/falsch, gleich/ungleich, größer/kleiner und enthält
- Automatische Datenpunkte unter `0_userdata.0.Stoerungen`
- Zustände: `0 = keine Störung`, `1 = aktiv`, `2 = quittiert`
- Telegram- und E-Mail-Benachrichtigungen
- Alle Störungsinformationen werden in der Nachricht mitgesendet
- Quittierung durch Schreiben von `2` auf `Meldezustand`

## Installation aus lokaler Datei

1. ZIP-Datei entpacken oder in ein Git-Repository hochladen.
2. Im ioBroker-Admin unter **Adapter → Adapter aus eigener URL installieren** die Repository-URL eintragen.
3. Alternativ im ioBroker-Verzeichnis installieren:

```bash
npm install /pfad/zu/iobroker.stoerungsmanager
```

Danach den Adapter im Admin hinzufügen und konfigurieren.

## Objektstruktur

```text
0_userdata.0.Stoerungen.<ID>.Ausloeser
0_userdata.0.Stoerungen.<ID>.Meldegruppe
0_userdata.0.Stoerungen.<ID>.Melder
0_userdata.0.Stoerungen.<ID>.Meldetext
0_userdata.0.Stoerungen.<ID>.Meldezustand
```

## Hinweis

Dies ist eine erste vollständige Entwicklungsfassung (`0.1.0`). Vor produktivem Einsatz sollte sie in einer Testinstanz geprüft werden.
