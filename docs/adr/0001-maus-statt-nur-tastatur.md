# 0001 — Maus zusätzlich zur Tastatur (Klick-Fokus, frei ziehbare Trennlinie)

- Status: accepted
- Date: 2026-09-23

## Context

Die ursprüngliche Design-Entscheidung vom 2026-08-03
(interne Design-Spezifikation `docs/superpowers/specs/2026-08-03-cockpit-design.md`,
nicht Teil des öffentlichen Repos; Abschnitt „Entscheidungen") legte für die
Interaktion mit dem Cockpit-Dashboard fest:
„Nur Tastatur, keine Maus" — `config/tmux-cockpit.conf` setzte entsprechend
`set -g mouse off`. Diese Entscheidung machte ⌘1-6 zusätzlich zu einer
funktionalen Notwendigkeit: da Terminal.app ⌘1-6 strukturell nicht an
Cockpit senden kann (es beansprucht ⌘1-9 selbst für die Fensterauswahl),
verlangte `mouse off` ohne Alternativweg zwingend Ghostty als laufendes
Terminal — es gab keinen Weg, ein Pane per Klick zu fokussieren oder die
Spaltenbreite zwischen den beiden Panes zu verändern.

Am 2026-09-23 meldete der Nutzer das direkt als Symptom: die rechte Spalte
war per Klick nicht anwählbar, die Trennlinie nicht verschiebbar. Gemessen
am laufenden Server: `tmux show-options -g mouse` → `off`. Der Nutzer
revidierte die Entscheidung ausdrücklich („1 mit Maus", zusätzlich „frei
verschiebbar" für die Trennlinie).

## Decision

`config/tmux-cockpit.conf` setzt `mouse on` statt `mouse off`. Damit stehen
zwei zusätzliche Interaktionswege zur Verfügung, ohne die bestehende
Tastatursteuerung (⌘1-6 + Pfeiltasten/Enter/Esc, `src/ui/paneFocus.ts`) zu
verändern:

- **Klick-Fokus:** ein Klick auf ein Pane macht es zum aktiven Pane
  (tmux-Standardbindung `MouseDown1Pane` → `select-pane`, keine eigene
  Bindung nötig).
- **Trennlinie frei ziehbar:** Klick-Halten auf der senkrechten Trennlinie
  zwischen den Panes und Ziehen verändert die Spaltenbreite (tmux-
  Standardbindung `MouseDrag1Border` → `resize-pane -M`).

Ghostty bleibt Pflicht für ⌘1-6 (unverändert von der ursprünglichen
Entscheidung) — die Maus ist der zusätzliche, terminal-unabhängige Weg,
kein Ersatz für die Ghostty-Abhängigkeit der Tastenbelegung.

Verhaltensbeweis: `tests/e2e/mouse-check.sh` — ein echter, per
Pseudo-Terminal angehängter tmux-Client sendet SGR-Mausereignisse an einen
Wegwerf-Server (`-L cockpit-mouse-proof`); geprüft wird der tatsächliche
Fokuswechsel und die tatsächliche Breitenänderung beider Panes, nicht die
Konfigurationsdeklaration. Eine Gegenprobe mit `mouse off` zeigt, dass
beide Effekte ohne die Option ausbleiben.

## Consequences

**Einfacher wird:**
- Cockpit lässt sich auch dann bedienen, wenn ⌘1-6 aus irgendeinem Grund
  nicht ankommt (z. B. Terminal.app, ein Ghostty-Konfigurationsfehler, oder
  schlicht Nutzerpräferenz für die Maus).
- Die Spaltenbreite (bisher fest über `-l 48` beim Start) lässt sich zur
  Laufzeit anpassen, ohne `bin/cockpit` neu zu starten.

**Schwerer wird / Nebenwirkungen:**
- Das Mausrad scrollt jetzt durch die tmux-Pane-Historie statt durch das
  native Terminal-Scrollback der App darunter — eine gewohnte Geste
  verhält sich anders als vorher.
- Text mit der Maus markieren (zum Kopieren) braucht in Ghostty eine
  zusätzliche Taste: gehaltene Umschalttaste (Shift) beim Klicken/Ziehen,
  weil Ghostty per Vorgabe (`mouse-shift-capture = false`, gemessen via
  `ghostty +show-config --default --docs`) Shift nicht mit dem
  Maus-Protokoll sendet und die Selektion stattdessen nativ im Terminal
  behält. Für Terminal.app ist dieses Verhalten nicht geprüft.
- Ein versehentlicher Klick (z. B. beim Scrollen mit dem Trackpad) kann den
  Fokus jetzt ungewollt verschieben — bisher strukturell ausgeschlossen.

**Nicht betroffen:** die Tastatursteuerung (⌘1-6, Pfeiltasten, Enter, Esc,
`q`) bleibt exakt wie vor dieser Entscheidung; keine der bestehenden Regressionen
(`tests/e2e/navigation-check.sh`, `tests/e2e/resize-regression.sh`,
`tests/e2e/ghostty-keybind-check.sh`) ändert ihr Ergebnis.
