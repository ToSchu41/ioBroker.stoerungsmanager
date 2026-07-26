# ioBroker.stoerungsmanager

Regelbasierter Störungsmanager für ioBroker mit Quittierung sowie Telegram- und E-Mail-Benachrichtigungen.

## Version 0.2.0

- Mehrere Bedingungen je Störung
- UND- oder ODER-Verknüpfung
- Vergleichsoperatoren `=`, `≠`, `>`, `>=`, `<`, `<=`
- Wertebereiche `zwischen` und `außerhalb`
- Boolean `true` / `false`
- String enthält / enthält nicht
- Reguläre Ausdrücke
- Änderung, Flanke 0→1 und Flanke 1→0
- Timeout bei ausbleibender Aktualisierung
- Optionale Einschaltverzögerung je Bedingung
- Vollständige Bedingungsinformationen in Telegram und E-Mail
- JSON-Datenpunkt `Bedingungsdetails`

## Konfiguration

### 1. Störungen

Im Reiter **Störungen** wird je Störung eine eindeutige ID angelegt. Außerdem werden UND/ODER, Meldegruppe, Melder und Meldetext festgelegt.

### 2. Bedingungen

Im Reiter **Bedingungen** wird jede Bedingung über die Spalte `Störungs-ID` zugeordnet. Die Schreibweise muss mit der ID im Reiter **Störungen** übereinstimmen.

Beispiel:

- Störungs-ID: `Heizung_Stoerung`
- Logik: `AND`
- Bedingung 1: Vorlauf > 80 °C
- Bedingung 2: Pumpe = false

Die Störung wird erst aktiv, wenn beide Bedingungen erfüllt sind.

## Datenpunkte

```text
0_userdata.0.Stoerungen.<ID>.Ausloeser
0_userdata.0.Stoerungen.<ID>.Meldegruppe
0_userdata.0.Stoerungen.<ID>.Melder
0_userdata.0.Stoerungen.<ID>.Meldetext
0_userdata.0.Stoerungen.<ID>.Meldezustand
0_userdata.0.Stoerungen.<ID>.Bedingungsdetails
```

`Meldezustand`:

- `0`: keine Störung
- `1`: Störung aktiv
- `2`: Störung quittiert

Zum Quittieren wird `Meldezustand` von außen mit `ack=false` auf `2` geschrieben.

## Hinweise zu Ereignisbedingungen

`Änderung` und Flanken sind Impulsbedingungen. Sie bleiben standardmäßig eine Sekunde aktiv. Die Impulsdauer kann je Bedingung eingestellt werden.

Beim `Timeout` wird der Timer mit jeder Zustandsaktualisierung des überwachten Objekts neu gestartet. Entscheidend ist ein neues Telegramm, nicht nur eine Wertänderung.
