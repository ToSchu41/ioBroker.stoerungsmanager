# ioBroker.stoerungsmanager

Ein regelbasierter Störungsmanager für ioBroker zur zentralen Erfassung, Auswertung, Quittierung und Weiterleitung von Störungen im Haus und in technischen Anlagen.

Der Adapter überwacht beliebige ioBroker-Zustände, verknüpft mehrere Bedingungen zu Störungsregeln und legt die zugehörigen Meldedaten unter einem frei definierbaren Objektpfad ab. Benachrichtigungen können über den Telegram- und den E-Mail-Adapter versendet werden.

> Entwicklungsstand: Version 0.3.0. Der Adapter wird aktuell außerhalb des offiziellen ioBroker-Repositorys über GitHub installiert.

## Funktionen

- Beliebig viele Störungen über die ioBroker-Admin-Oberfläche konfigurieren
- Mehrere Bedingungen je Störung
- UND- oder ODER-Verknüpfung der Bedingungen
- Auswahl der überwachten Datenpunkte über den ioBroker-Objektbrowser
- Vergleich von Zahlen, Boolean-Werten und Zeichenketten
- Reguläre Ausdrücke
- Erkennung von Wertänderungen und Signalflanken
- Optionale Einschaltverzögerung je Bedingung
- Optionale Kommunikationsüberwachung je Bedingung
- Automatische Quittierungslogik
- Automatische Rücksetzung behobener Störungen
- Telegram- und E-Mail-Benachrichtigungen
- Vollständige Informationen zu allen Bedingungen in jeder Benachrichtigung
- JSON-Datenpunkt mit den aktuellen Bedingungsdetails
- Übernahme bestehender Konfigurationen aus Version 0.1.x und 0.2.x
- Keine VIS-Abhängigkeit

## Voraussetzungen

- ioBroker mit JavaScript-/Node.js-Unterstützung
- Node.js 20 oder neuer
- js-controller 6 oder neuer
- ioBroker Admin 6 oder neuer
- Für Telegram-Nachrichten: installierter und eingerichteter Telegram-Adapter
- Für E-Mail-Nachrichten: installierter und eingerichteter E-Mail-Adapter

## Installation über GitHub

Der Adapter kann über das GitHub-Repository installiert werden:

```bash
iobroker url https://github.com/ToSchu41/ioBroker.stoerungsmanager --host <IOBROKER-HOST> --debug
```

Beispiel:

```bash
iobroker url https://github.com/ToSchu41/ioBroker.stoerungsmanager --host iob30-2 --debug
```

Alternativ kann die ZIP-Adresse des Hauptbranches verwendet werden:

```bash
iobroker url https://github.com/ToSchu41/ioBroker.stoerungsmanager/archive/refs/heads/main.zip --host iob30-2 --debug
```

Nach einer Aktualisierung empfiehlt sich:

```bash
iobroker upload stoerungsmanager

iobroker restart stoerungsmanager
```

## Aktualisierung über die GitHub-Weboberfläche

Wenn das Repository bereits Version 0.1.0 oder 0.2.0 enthält:

1. Neue Adapter-ZIP herunterladen und auf dem Computer entpacken.
2. Das GitHub-Repository im Browser öffnen.
3. **Add file → Upload files** auswählen.
4. Den Inhalt des entpackten Adapterordners hochladen. `package.json` muss anschließend direkt im Hauptverzeichnis des Repositorys liegen.
5. Als Commit-Nachricht beispielsweise `Update auf Version 0.3.0` eintragen.
6. Direkt in den Branch `main` committen.
7. Prüfen, ob `package.json` und `io-package.json` jeweils die Version `0.3.0` enthalten.
8. Adapter in ioBroker erneut über die GitHub-URL installieren und danach hochladen beziehungsweise neu starten.

Die vorhandene Instanz muss normalerweise nicht gelöscht werden. Dadurch bleibt die bisherige Adapterkonfiguration erhalten.

## Grundkonzept

Eine **Störung** besteht aus:

- einer eindeutigen Störungs-ID,
- einer Meldegruppe,
- einem Melder,
- einem Meldetext,
- einer logischen Verknüpfung,
- einer oder mehreren Bedingungen.

Bei einer UND-Verknüpfung müssen alle aktiven Bedingungen erfüllt sein. Bei einer ODER-Verknüpfung genügt eine erfüllte Bedingung.

### Beispiel: UND-Regel

Die Störung `Heizung_Uebertemperatur` soll aktiv werden, wenn:

1. die Vorlauftemperatur größer als 80 °C ist und
2. die Umwälzpumpe ausgeschaltet ist.

Störung:

```text
Störungs-ID: Heizung_Uebertemperatur
Verknüpfung: UND
Meldegruppe: Heizung
Melder: Wärmepumpe
Meldetext: Vorlauftemperatur zu hoch und Pumpe ausgeschaltet
```

Bedingung 1:

```text
Störungs-ID: Heizung_Uebertemperatur
Bedingungs-ID: Temperatur_hoch
Objekt: modbus.0.heizung.vorlauftemperatur
Bedingung: größer
Vergleichswert: 80
```

Bedingung 2:

```text
Störungs-ID: Heizung_Uebertemperatur
Bedingungs-ID: Pumpe_aus
Objekt: modbus.0.heizung.pumpe
Bedingung: bool false
```

## Unterstützte Bedingungen

### Wertevergleiche

| Bedingung | Beschreibung | Benötigte Eingaben |
|---|---|---|
| Wert = | Aktueller Wert entspricht dem Vergleichswert | Vergleichswert |
| Wert ≠ | Aktueller Wert entspricht nicht dem Vergleichswert | Vergleichswert |
| größer | Aktueller Zahlenwert ist größer | Vergleichswert |
| größer oder gleich | Aktueller Zahlenwert ist größer oder gleich | Vergleichswert |
| kleiner | Aktueller Zahlenwert ist kleiner | Vergleichswert |
| kleiner oder gleich | Aktueller Zahlenwert ist kleiner oder gleich | Vergleichswert |
| zwischen | Wert liegt einschließlich der Grenzen im Bereich | Wert 1 und Wert 2 |
| außerhalb | Wert liegt außerhalb des Bereichs | Wert 1 und Wert 2 |

Zahlen können in der Admin-Oberfläche als normaler Text eingetragen werden, beispielsweise `80`, `-15` oder `2.5`.

### Boolean-Bedingungen

| Bedingung | Wird erfüllt bei |
|---|---|
| bool true | `true`, `1`, `"true"` oder `"1"` |
| bool false | `false`, `0`, `"false"` oder `"0"` |

### Zeichenketten

| Bedingung | Beschreibung |
|---|---|
| String enthält | Der aktuelle Wert enthält den angegebenen Text |
| String enthält nicht | Der aktuelle Wert enthält den angegebenen Text nicht |
| Regex | Der aktuelle Wert erfüllt den regulären Ausdruck |

Beispiel für einen regulären Ausdruck:

```text
^ERR_[0-9]+$
```

Optional können Regex-Flags angegeben werden. Mit `i` erfolgt die Prüfung ohne Beachtung der Groß- und Kleinschreibung.

### Ereignisbedingungen

| Bedingung | Beschreibung |
|---|---|
| Änderung | Reagiert auf jede tatsächliche Wertänderung |
| Flanke 0 → 1 | Reagiert auf den Wechsel von aus nach ein |
| Flanke 1 → 0 | Reagiert auf den Wechsel von ein nach aus |

Ereignisbedingungen erzeugen einen zeitlich begrenzten Impuls. Die Impulsdauer wird in Sekunden eingestellt. Standardwert ist eine Sekunde.

## Optionale Einschaltverzögerung

Die Einschaltverzögerung legt fest, wie lange eine Wertebedingung ununterbrochen erfüllt sein muss, bevor sie als aktive Bedingung gewertet wird.

```text
Temperatur > 80 °C
Verzögerung: 300 Sekunden
```

Die Bedingung wird in diesem Beispiel erst nach fünf Minuten aktiv. Fällt die Temperatur vorher wieder auf 80 °C oder darunter, wird der Timer verworfen.

`0` bedeutet: keine Verzögerung.

## Optionale Kommunikationsüberwachung

Die Kommunikationsüberwachung ist von der eigentlichen Wertebedingung getrennt und standardmäßig deaktiviert.

Sie kann für jede Bedingung zusätzlich aktiviert werden:

```text
Kommunikation überwachen: aktiviert
Kein Update nach: 600 Sekunden
```

Der Timer wird bei jeder Zustandsaktualisierung des überwachten ioBroker-Datenpunkts neu gestartet. Der Wert muss sich dabei nicht ändern. Entscheidend ist, dass ioBroker ein neues State-Update erhält.

Wird innerhalb der eingestellten Zeit kein Update empfangen, gilt die betreffende Bedingung als erfüllt und die zugehörige Störung kann aktiv werden. Sobald wieder ein Update eingeht, wird der Kommunikations-Timeout aufgehoben und der normale Wertevergleich erneut ausgewertet.

### Kein Kommunikations-Timeout benötigt

Die Option **Kommunikation überwachen** bleibt deaktiviert. Das Feld **Kein Update nach** ist dann ausgeblendet und wird nicht ausgewertet.

### Beispiel: Temperatur und Kommunikation überwachen

```text
Objekt: mqtt.0.garten.temperature
Bedingung: größer
Vergleichswert: 35
Kommunikation überwachen: aktiviert
Kein Update nach: 900 Sekunden
```

Die Bedingung wird erfüllt, wenn entweder die Temperatur über 35 °C steigt oder der Sensor länger als 15 Minuten kein Update liefert.

## Dynamische Konfigurationsoberfläche

Die Admin-Oberfläche zeigt nur die zur jeweiligen Bedingung passenden Felder:

- Bei `größer`, `kleiner`, `gleich` usw. erscheint ein Vergleichswert.
- Bei `zwischen` und `außerhalb` erscheinen zwei Vergleichswerte.
- Bei `Regex` erscheinen Regex und Regex-Flags.
- Bei Ereignisbedingungen erscheint die Impulsdauer.
- Das Kommunikations-Timeout erscheint nur bei aktivierter Kommunikationsüberwachung.

Pflichtfelder werden vor dem Speichern geprüft. Ein Kommunikations-Timeout ist nur dann Pflicht, wenn die Kommunikationsüberwachung aktiviert wurde.

## Objektstruktur

Der Standardpfad lautet:

```text
0_userdata.0.Stoerungen
```

Für jede Störung werden folgende Datenpunkte angelegt:

```text
0_userdata.0.Stoerungen.<ID>.Ausloeser
0_userdata.0.Stoerungen.<ID>.Meldegruppe
0_userdata.0.Stoerungen.<ID>.Melder
0_userdata.0.Stoerungen.<ID>.Meldetext
0_userdata.0.Stoerungen.<ID>.Meldezustand
0_userdata.0.Stoerungen.<ID>.Bedingungsdetails
```

Der Basispfad kann in der Adapterkonfiguration geändert werden.

### Meldezustand

| Wert | Bedeutung |
|---:|---|
| 0 | Keine Störung beziehungsweise Störung behoben |
| 1 | Störung aktiv und noch nicht quittiert |
| 2 | Störung aktiv und quittiert |

## Quittierung

Eine aktive Störung wird quittiert, indem der zugehörige Datenpunkt `Meldezustand` mit `ack=false` auf `2` geschrieben wird.

Beispiel:

```text
0_userdata.0.Stoerungen.Heizung_Uebertemperatur.Meldezustand = 2
```

Die Quittierung ist nur wirksam, solange die Störung tatsächlich aktiv ist. Sobald alle auslösenden Bedingungen wieder normal sind, setzt der Adapter den Zustand automatisch auf `0` zurück.

Tritt die Störung später erneut auf, wechselt der Zustand wieder auf `1`.

## Bedingungsdetails

Der Datenpunkt `Bedingungsdetails` enthält ein JSON-Array mit den aktuellen Informationen aller Bedingungen.

Beispiel:

```json
[
  {
    "id": "Temperatur_hoch",
    "ausloeser": "modbus.0.heizung.vorlauftemperatur",
    "bedingung": "gt",
    "vergleichswert": "80",
    "vergleichswert2": "",
    "wert": 84.3,
    "erfuellt": true,
    "rohErfuellt": true,
    "kommunikationsueberwachung": true,
    "kommunikationsTimeoutSekunden": 600,
    "kommunikationsTimeoutAktiv": false,
    "verzoegerungSekunden": 0
  }
]
```

## Telegram-Benachrichtigungen

Voraussetzung ist ein eingerichteter ioBroker-Telegram-Adapter.

In der Konfiguration:

1. Telegram aktivieren.
2. Telegram-Instanz auswählen.
3. Optional einen bestimmten Telegram-Benutzer eintragen.

Bleibt der Benutzer leer, erfolgt der Versand entsprechend der Konfiguration des Telegram-Adapters.

## E-Mail-Benachrichtigungen

Voraussetzung ist ein eingerichteter ioBroker-E-Mail-Adapter.

In der Konfiguration:

1. E-Mail aktivieren.
2. E-Mail-Instanz auswählen.
3. Empfängeradresse eintragen.
4. Optional ein Betreff-Präfix festlegen.

## Inhalt einer Benachrichtigung

Eine Meldung enthält:

- Meldetext
- Meldegruppe
- Melder
- aktuellen Meldezustand
- vorherigen Meldezustand
- UND-/ODER-Verknüpfung
- alle Bedingungs-IDs
- alle überwachten Objekt-IDs
- Operator und Vergleichswerte
- aktuellen Wert jedes Objekts
- Erfüllungszustand jeder Bedingung
- Status der Kommunikationsüberwachung
- Störungs-ID
- Zeitpunkt

Beispiel:

```text
🚨 Störmeldung im Haus

Meldetext: Vorlauftemperatur zu hoch
Meldegruppe: Heizung
Melder: Wärmepumpe

Zustand: Störung aktiv
Vorheriger Zustand: Störung behoben
Regelverknüpfung: AND

Bedingungen:
- Temperatur_hoch: modbus.0.heizung.vorlauftemperatur
  Bedingung: > 80
  Aktueller Wert: 84.3
  Erfüllt: Ja
  Kommunikationsüberwachung: 600 s
  Kommunikations-Timeout: Nein

Störungs-ID: Heizung_Uebertemperatur
Zeitpunkt: 26.07.2026, 08:30:00
```

## Benachrichtigungsereignisse

Für folgende Zustandswechsel kann der Versand getrennt aktiviert oder deaktiviert werden:

- neue Störung
- Quittierung
- Behebung

Über die Schaltfläche **Testnachricht senden** kann die Benachrichtigungskonfiguration geprüft werden.

## Migration älterer Versionen

### Von Version 0.1.x

Bestehende Störungen mit einer direkt in der Störung hinterlegten Einzelbedingung werden beim Start intern als `Bedingung_1` übernommen.

### Von Version 0.2.x

Bestehende Störungen und Bedingungen bleiben erhalten. Der frühere Operator `Timeout` wird aus Kompatibilitätsgründen weiterhin intern unterstützt. Für neue Konfigurationen wird stattdessen die optionale Kommunikationsüberwachung verwendet.

Neue Felder haben folgende Standardwerte:

```text
Kommunikation überwachen: deaktiviert
Kein Update nach: 600 Sekunden
```

Damit wird nach einem Update nicht unbeabsichtigt eine neue Timeout-Überwachung aktiviert.

## Fehlersuche

### Adapter lässt sich über GitHub nicht installieren

Prüfen, ob das Repository öffentlich und im Browser ohne Anmeldung erreichbar ist. Außerdem muss `package.json` direkt im Hauptverzeichnis liegen.

### Keine Telegram-Nachricht

- Läuft die ausgewählte Telegram-Instanz?
- Funktioniert der Nachrichtenversand direkt über den Telegram-Adapter?
- Ist gegebenenfalls der Benutzername korrekt?
- Ist die Meldung für Aktivierung, Quittierung oder Behebung freigegeben?

### Keine E-Mail

- Läuft die ausgewählte E-Mail-Instanz?
- Sind SMTP-Zugangsdaten im E-Mail-Adapter korrekt?
- Ist eine gültige Empfängeradresse eingetragen?

### Störung wird nicht aktiv

- Stimmen die Störungs-IDs in den Reitern **Störungen** und **Bedingungen** exakt überein?
- Ist die Störung aktiviert?
- Ist die Bedingung aktiviert?
- Existiert der ausgewählte ioBroker-Datenpunkt?
- Ist die UND-/ODER-Verknüpfung passend gewählt?
- Läuft gegebenenfalls noch eine Einschaltverzögerung?

### Kommunikationsüberwachung löst nicht aus

- Ist **Kommunikation überwachen** aktiviert?
- Ist der Timeout größer als null?
- Sendet der überwachte Adapter eventuell regelmäßig denselben Wert? Auch dies zählt als Update und startet den Timer neu.

## Versionsverlauf

### 0.3.0

- Kommunikations-Timeout ist kein allgemeines Pflichtfeld mehr
- Separate optionale Kommunikationsüberwachung je Bedingung
- Dynamisch ein- und ausgeblendete Eingabefelder
- Pflichtfeldprüfung abhängig vom Operator
- Kommunikationsstatus in `Bedingungsdetails`
- Kommunikationsstatus in Telegram- und E-Mail-Nachrichten
- Kompatibilität mit bestehenden 0.2-Timeout-Bedingungen
- Bereinigung doppelter Codezeilen in der Regel- und Nachrichtenlogik
- Umfangreichere Dokumentation

### 0.2.0

- Mehrere Bedingungen je Störung
- UND-/ODER-Verknüpfung
- Wertevergleiche und Bereiche
- Boolean- und String-Bedingungen
- Regex
- Änderung und Flankenerkennung
- Timeout-Operator
- Einschaltverzögerung
- Bedingungsdetails als JSON

### 0.1.0

- Erste Version
- Einzelne Bedingung je Störung
- Quittierung
- Telegram und E-Mail

## Lizenz

MIT License

## Autor

Tobias Schu / SystemSmart
