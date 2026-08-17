# Changelog

## 0.4.0

- Optionale Hysterese für numerische Bedingungen (`>`, `>=`, `<`, `<=`, `zwischen`, `außerhalb`)
- Zustandsbehaftete Hystereselogik: Einschaltgrenze bleibt unverändert, Rückschaltschwelle wird verschoben
- Hysterese in `Bedingungsdetails` und Benachrichtigungen aufgenommen
- Frei konfigurierbare Telegram-Vorlagen für Aktiv, Quittiert und Behoben
- Frei konfigurierbare E-Mail-Vorlagen für Aktiv, Quittiert und Behoben
- Separate E-Mail-Betreffvorlagen je Meldezustand
- Platzhalter: `{Meldetext}`, `{Melder}`, `{Meldegruppe}`, `{Bedingungen}`, `{Zustand}`, `{VorherigerZustand}`, `{StoerungsID}`, `{Zeitpunkt}`, `{Ausloeser}`, `{Ausloeserwert}`, `{Logik}`
- Mehrzeilige Texteingabe für Nachrichtenvorlagen in der Admin-Oberfläche
- Standardvorlagen für bestehende Installationen
- README umfassend um Hysterese und Nachrichtenvorlagen erweitert

## 0.3.0

- Kommunikationsüberwachung als optionale Zusatzfunktion je Bedingung
- Dynamische Felder in der Admin-Oberfläche
- Operatorabhängige Validierung
- Kommunikations-Timeout in Bedingungsdetails und Benachrichtigungen
- Migration und Kompatibilität für Konfigurationen aus 0.1.x und 0.2.x
- Bereinigung doppelter Codezeilen
- Erweiterte README

## 0.2.0

- Mehrere Bedingungen pro Störung
- UND-/ODER-Verknüpfung
- Erweiterte Operatoren, Flanken, Regex und Timeout

## 0.1.0

- Erste lauffähige Entwicklungsfassung
