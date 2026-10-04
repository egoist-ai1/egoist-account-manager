import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.resolve(directory, '../../..');
const notesFile = path.join(projectPath, 'docs', 'releases', '3.1.10.md');
const snapshotFile = path.join(directory, 'Реестр.json');
const sourceBytes = fs.readFileSync(notesFile);
const source = sourceBytes.toString('utf8');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sections = [
  ['codex', 'Codex: идентичность и авторизация'],
  ['antigravity', 'Antigravity: синхронизация и квоты'],
  ['processes', 'Antigravity: процессы и очистка'],
  ['tray', 'Tray и режим приватности'],
  ['delivery', 'Установщик и доставка релиза'],
  ['dependencies', 'Обновление зависимостей'],
  ['verification', 'Проверки и статус поставки']
];
const items = sections.map(([id, name], index) => {
  const marker = `<a id="${id}"></a>`;
  const start = source.indexOf(marker);
  const next = sections[index + 1] ? source.indexOf(`<a id="${sections[index + 1][0]}"></a>`) : source.length;
  if (start < 0 || next <= start) throw new Error(`Missing or unordered release-note section: ${id}`);
  const content = source.slice(start + marker.length, next).trim();
  return {
    id: `release-3.1.10-${id}`, name, version: `3.1.10:${sha256(content).slice(0, 16)}`,
    section: id, sourceFile: notesFile, sourceAnchor: id, content,
    approveAction: 'Принять описание этого результата и указанного статуса проверки. Это не запускает авторизацию, переключение аккаунтов, установку или публикацию.'
  };
});
const snapshot = {
  schemaVersion: 1, artifactId: 'account-manager-ego-release-3.1.10-review',
  projectPath, releaseVersion: '3.1.10', notesFile, notesSha256: sha256(sourceBytes), items
};
const snapshotBytes = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
fs.writeFileSync(snapshotFile, snapshotBytes);
const snapshotSha256 = sha256(snapshotBytes);
const pointer = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.codex', 'brain-pointer.json'), 'utf8'));
const helper = fs.readFileSync(path.join(pointer.root, 'extensions', 'artifact-feedback', 'review-feedback.js'), 'utf8');
if (!helper.includes('CodexReviewFeedback')) throw new Error('Shared review helper is unavailable.');
const embedded = JSON.stringify({ ...snapshot, snapshotFile, snapshotSha256 }).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'self'; connect-src 'none'; base-uri 'none'">
<title>Account Manager EGO 3.1.10 — обратная связь</title>
<style>
@font-face{font-family:Unbounded;src:url('../../../assets/Unbounded.ttf') format('truetype');font-display:swap}
*{box-sizing:border-box}body{margin:0;background:#050507;color:#fff;font:15px/1.6 'Segoe UI',sans-serif}main{max-width:1060px;margin:auto;padding:44px 24px 80px}h1,h2,.label{font-family:Unbounded,'Segoe UI',sans-serif}h1{font-size:28px;line-height:1.4;margin:8px 0 20px}h2{font-size:15px;margin:0}p{margin:12px 0}a{color:#c084fc}.muted{color:#c9c6d0}.eyebrow{color:#c084fc;font-size:12px;letter-spacing:.08em}.intro{max-width:850px}.toolbar,.actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.toolbar{margin:28px 0 18px;justify-content:space-between}article,.general{border:1px solid #34303e;border-radius:14px;padding:24px;margin:16px 0;background:#101015}article header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}article pre{font:14px/1.7 'Segoe UI',sans-serif;white-space:pre-wrap;word-break:break-word;color:#ddd9e4;margin:18px 0}.meaning{font-size:13px;color:#c9c6d0;padding-top:12px;border-top:1px solid #34303e}label.comment{display:block;margin-top:16px;font-weight:600}textarea{display:block;width:100%;min-height:84px;resize:vertical;background:#050507;border:1px solid #64586e;border-radius:8px;color:#fff;padding:12px;font:inherit;margin-top:8px}button{font:inherit;background:#17131e;border:1px solid #64586e;border-radius:8px;padding:9px 14px;color:#fff;cursor:pointer}button:hover{border-color:#c084fc;background:#241b30}button:active{background:#352544}button[aria-pressed=true]{border-color:#c084fc;background:#492469}button:disabled{opacity:.5;cursor:wait}.primary{background:#7c3aed;border-color:#8b5cf6;font-weight:600}.reset{padding:6px 4px;border:0;background:transparent;color:#c9c6d0;font-size:13px}button:focus-visible,textarea:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #fff;outline-offset:3px}.actions{margin-top:18px}#status{min-height:28px;color:#c084fc}.hidden{display:none!important}#summary{font-size:13px;color:#c9c6d0}details{margin-top:18px;color:#c9c6d0;font-size:12px;overflow-wrap:anywhere}summary{cursor:pointer}.bottom{padding-top:12px}.general h2{margin-bottom:8px}@media(max-width:620px){main{padding:24px 16px 50px}h1{font-size:22px}article,.general{padding:18px}article header{display:block}article header a{display:inline-block;margin-top:12px}.choices{gap:8px}.choices button{flex:1 1 100%}}
</style></head><body><main>
<div class="eyebrow label">ACCOUNT MANAGER EGO · 3.1.10</div>
<h1>Обратная связь по результату</h1>
<div class="intro"><p>Выберите, какие разделы принять, какие доработать и что пояснить. По умолчанию ни один ответ не выбран. Комментарии можно оставить независимо от выбора.</p>
<p class="muted">«Да / подтверждаю» принимает описание результата и показанный статус проверки. Ответы на этой странице не запускают авторизацию, переключение профилей, переустановку или публикацию. Порученная работа продолжается отдельно.</p>
<p><a href="../3.1.10.md">Открыть release notes 3.1.10</a></p></div>
<div class="toolbar"><span id="summary" aria-live="polite"></span><label><input id="only-unreviewed" type="checkbox"> Только без выбора</label></div>
<section id="items" aria-label="Разделы для обсуждения"></section>
<section class="general"><h2>Общий комментарий</h2><label class="comment" for="general-comment">Ваши замечания ко всему результату</label><textarea id="general-comment" placeholder="Что ещё нужно учесть?"></textarea></section>
<div class="actions bottom"><button class="primary" id="apply" type="button">Применить</button><button id="export" type="button">Сохранить JSON</button><button id="import" type="button">Загрузить JSON</button><input id="import-file" class="hidden" type="file" accept="application/json,.json" aria-label="Файл с ответами"></div>
<p class="muted">Standalone-режим: «Применить» готовит и скачивает JSON с выбранными ответами. Приложите этот файл в текущий чат для обсуждения и проверки. Страница не отправляет сообщения и не записывает изменения в проект.</p>
<p id="status" role="status" aria-live="polite"></p>
<details><summary>Версия снимка и источник</summary><p id="provenance"></p></details>
</main>
<script id="review-snapshot" type="application/json">${embedded}</script>
<script id="shared-review-helper">${helper}</script>
<script>
'use strict';
const snapshot = JSON.parse(document.getElementById('review-snapshot').textContent);
const itemElements = new Map();
const status = document.getElementById('status');
let review;
function redraw() {
  let unresolved = 0;
  for (const item of snapshot.items) {
    const value = review.get(item.id);
    const ui = itemElements.get(item.id);
    for (const button of ui.buttons) button.setAttribute('aria-pressed', String(button.dataset.decision === value.decision));
    if (ui.comment.value !== value.comment) ui.comment.value = value.comment;
    const neutral = value.decision === 'unreviewed';
    unresolved += Number(neutral);
    ui.card.classList.toggle('hidden', document.getElementById('only-unreviewed').checked && !neutral);
  }
  document.getElementById('general-comment').value = review.getGeneralComment();
  const counts = review.summary();
  document.getElementById('summary').textContent = 'Без выбора: ' + unresolved + ' из ' + snapshot.items.length + ' · Принято: ' + counts.approve + ' · Доработать: ' + counts.reject + ' · Вопросы: ' + counts.question;
  document.getElementById('apply').disabled = counts.applying;
  if (counts.warning) status.textContent = counts.warning;
}
review = window.CodexReviewFeedback.create({
  artifactId: snapshot.artifactId, snapshotSha256: snapshot.snapshotSha256,
  projectPath: snapshot.projectPath, snapshotFile: snapshot.snapshotFile, items: snapshot.items,
  allowHost: false, onChange: redraw, onRestore: redraw,
  applyInstructions: 'Сохрани мои ответы отдельно в указанном проекте и проверь точные snapshot, IDs и версии. Да означает принять описание результата, Нет означает доработать раздел с учётом комментария, Поясни означает ответить на вопрос. Не выполняй авторизацию, переключение аккаунтов, переустановку или публикацию по этому batch. Неотмеченные объекты остаются нейтральными.'
});
for (const item of snapshot.items) {
  const card = document.createElement('article'); card.dataset.itemId = item.id;
  const header = document.createElement('header');
  const title = document.createElement('h2'); title.textContent = item.name; header.append(title);
  const link = document.createElement('a'); link.href = '../3.1.10.md#' + item.sourceAnchor; link.textContent = 'Раздел release notes'; header.append(link); card.append(header);
  const text = document.createElement('pre'); text.textContent = item.content; card.append(text);
  const meaning = document.createElement('p'); meaning.className = 'meaning'; meaning.textContent = item.approveAction; card.append(meaning);
  const choices = document.createElement('div'); choices.className = 'actions choices'; choices.setAttribute('role','group'); choices.setAttribute('aria-label','Ваш выбор: '+item.name);
  const buttons = [];
  for (const [decision, label] of [['approve','✓ Да / подтверждаю'],['reject','✕ Нет'],['question','? Поясни']]) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.decision = decision; button.textContent = label; button.setAttribute('aria-pressed','false');
    button.addEventListener('click', () => review.setDecision(item.id, decision)); choices.append(button); buttons.push(button);
  }
  card.append(choices);
  const reset = document.createElement('button'); reset.className = 'reset'; reset.type = 'button'; reset.textContent = 'Снять выбор'; reset.addEventListener('click', () => review.setDecision(item.id,'unreviewed')); card.append(reset);
  const label = document.createElement('label'); label.className = 'comment'; label.htmlFor = item.id + '-comment'; label.textContent = 'Ваш комментарий';
  const comment = document.createElement('textarea'); comment.id = label.htmlFor; comment.placeholder = 'Что принять, доработать или пояснить?'; comment.addEventListener('input', () => review.setComment(item.id, comment.value)); label.append(comment); card.append(label);
  itemElements.set(item.id,{card,buttons,comment}); document.getElementById('items').append(card);
}
function download(envelope) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope,null,2)+'\\n'], {type:'application/json;charset=utf-8'}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'account-manager-ego-3.1.10-review-' + envelope.batchId + '.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById('general-comment').addEventListener('input', event => review.setGeneralComment(event.target.value));
document.getElementById('only-unreviewed').addEventListener('change', redraw);
document.getElementById('export').addEventListener('click', () => { download(review.envelope()); status.textContent = 'JSON подготовлен для сохранения. Передайте его в текущий чат; изменения проекта ещё не применены.'; });
document.getElementById('import').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const envelope = JSON.parse(await file.text());
    if (envelope.projectPath !== snapshot.projectPath || envelope.snapshotFile !== snapshot.snapshotFile) throw Error('Ответы относятся к другому проекту или файлу снимка.');
    review.restoreEnvelope(envelope); status.textContent = 'Ответы восстановлены для текущего снимка. Никакие изменения проекта не выполнены.';
  } catch (error) { status.textContent = 'Импорт не выполнен: ' + error.message + ' Текущие ответы сохранены.'; }
  finally { event.target.value = ''; }
});
document.getElementById('apply').addEventListener('click', async () => {
  try {
    const result = await review.apply();
    if (result.mode === 'export') { download(result.envelope); status.textContent = 'Ответы подготовлены в JSON. Приложите файл в текущий чат для обсуждения; авторизация, установка и публикация не запускались.'; }
    else if (result.mode === 'already') status.textContent = 'Этот пакет уже передан; новый пакет не создан.';
  } catch (error) { status.textContent = error.message; }
});
document.getElementById('provenance').textContent = 'Artifact: ' + snapshot.artifactId + '\\nSnapshot SHA-256: ' + snapshot.snapshotSha256 + '\\nСнимок: ' + snapshot.snapshotFile + '\\nRelease notes SHA-256: ' + snapshot.notesSha256;
redraw();
</script></body></html>`;
fs.writeFileSync(path.join(directory, 'index.html'), html, 'utf8');
console.log(JSON.stringify({ snapshotFile, snapshotSha256, notesSha256: snapshot.notesSha256, objects: items.length, board: path.join(directory, 'index.html') }, null, 2));
