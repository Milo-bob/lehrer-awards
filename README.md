# Lehrer Awards

Anonyme Abstimmung: Pro Kategorie wählt jedes Gerät eine Lehrkraft, die meisten Stimmen gewinnen.

- `index.html`, `lehrer.js`: statische Seite (Kategorien in `CATS`, Lehrkräfte in `lehrer.js`)
- `api/votes.js`: Vercel-Funktion, speichert die Stimmen in Upstash Redis
- `api/_data.js`: erlaubte Kategorie- und Lehrer-IDs (muss zu `CATS` und `TEACHERS` passen)

Benötigte Umgebungsvariablen (setzt Vercel beim Verbinden von Upstash Redis selbst):
`KV_REST_API_URL` und `KV_REST_API_TOKEN` (oder `UPSTASH_REDIS_REST_URL` und `UPSTASH_REDIS_REST_TOKEN`).

Ohne Datenbank oder beim Öffnen per Doppelklick läuft die Seite im Offline-Modus (Stimmen nur im Browser).