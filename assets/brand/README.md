# Квессер identity — RC2

Visible name: **Квессер**, without AI or a product suffix. **Kvesser** is its Latin spelling in filenames and executable metadata. These names never select a vault, registry key or account ID.

The editable authority is `kvesser-mark.svg`: a stable vertical stem and two separate arms form the Cyrillic К. The white arm and purple arm distinguish a selected profile from the next available profile. The split makes a compact mark that remains legible at 16 px; this is a graphic idea, not a status indicator.

Use `kvesser-mark-monochrome.svg` for single-color output. Outlined `kvesser-logo-horizontal.svg` and `kvesser-logo-latin.svg` preserve the wordmark without requiring an installed font. Clear space: one 9-unit stem width on the 64-unit grid. Icon minimum16px; application chrome32px; full horizontal wordmark minimum180px. Do not stretch, rotate or animate the mark continuously. Keep the black tile on pale backgrounds.

`scripts/generate-icons.mjs` renders the SVG in a headless browser at16/24/32/48/64/128/256/512px and packages native ICO entries. Its source is the vector, not a resized prior logo. E marks remain historical assets of RC1 and are not used in the new product UI.

Canvas #000000 or #050507; foreground #ffffff; graphic accent #8b5cf6, primary action #7c3aed, action hover #844ef4, focus/text #c084fc. White text on action/hover has measured contrast5.699/4.798:1; exact opaque pairs are recorded in docs/design/rc2/semantic-contrast.json. Error and critical quota #ef4444/#f87171. Ordinary successful states use purple/white.

Unbounded Variable: headings, badges, metrics, timers. Montserrat Variable: body text, labels, tables; system Segoe UI fallback. Both bundled families include Cyrillic and use the SIL Open Font License included here.

Voice: “Выбран”, “Вход сохранён”, “Нет снимка”, “Аккаунт работающей IDE не подтверждён”, “Проверить снова”. Avoid promises of provider authorization or runtime identity based only on local credentials.

The mark and composition are authored for this project. A limited web search on2026-10-06 did not establish a competing profile manager with this exact name; that search cannot establish legal uniqueness. Previous Egoist research and RC1 artifacts remain historical evidence.
