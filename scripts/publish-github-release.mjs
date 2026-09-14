import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);

console.log('=== Publishing Account Manager EGO v3.1.7 to GitHub Releases ===\n');

// 1. Obtain token via git credential
function getGitToken() {
  const output = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n',
    encoding: 'utf8'
  });
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('password=')) {
      return line.slice('password='.length);
    }
  }
  throw new Error('Failed to find GitHub token in git credential helper');
}

const token = getGitToken();
console.log('1. GitHub token retrieved successfully (length: ' + token.length + ')');

const repo = 'egoist-ai1/egoist-account-manager';
const tag = 'v3.1.7';
const releaseName = 'Account Manager EGO 3.1.7';

const releaseBody = `# Account Manager EGO 3.1.7

Крупное обновление локального Windows-менеджера и центра балансировки квот. В этой версии полностью активирована и интегрирована поддержка **Google Antigravity IDE** в дополнение к **OpenAI Codex**, внедрён нативный инсталлятор на C# WPF со стилем **Lagom** и реализована чистая установка на любое устройство с нуля (**Zero Dependencies**).

---

## Что нового в версии 3.1.7

### 1. Полноценная интеграция с Google Antigravity IDE
- **Вход через доверенный системный браузер (OAuth 2.0 PKCE)**: авторизация выполняется в основном браузере системы без попадания под SMS-челленджи и антифрод-фильтры Google (\`VALIDATION_REQUIRED\`).
- **Атомарная инжекция авторизации**: токены и профиль автоматически записываются в \`state.vscdb\` (Protobuf \`antigravityUnifiedStateSync.oauthToken\` + JSON) и в Windows Credential Manager (\`gemini:antigravity\`).
- **Двухфазный безопасный перезапуск IDE (\`quiesceAntigravity\`)**: корректное закрытие дерева процессов Antigravity перед сменой аккаунта с выгрузкой старых токенов из оперативной памяти.
- **Очистка сессионных замков**: автоматическое удаление зависших файлов блокировок (\`SingletonLock\`, \`lockfile\`, \`DevToolsActivePort\`), предотвращающее зависания мастера «Setting Up Your Account».
- **Мониторинг квот Gemini**: поддержка скользящих 5-часовых и недельных окон квот моделей Gemini 3.8 Pro и Flash.

### 2. Фирменный автономный установщик (Zero Dependencies)
- **Нативный интерфейс C# WPF**: современный интерфейс установщика со скандинавской темной темой **Lagom** и переменной типографикой **Unbounded**.
- **Чистая установка с нуля**: приложение полностью упаковано с нативными бинарниками SQLite (\`better-sqlite3\`), средой Electron и ресурсами — на целевом компьютере **не требуются** Node.js, Git, Python или пакетные менеджеры.
- **Интеграция с Windows**: создание ярлыков на Рабочем столе и в меню «Пуск», регистрация официального деинсталлятора в «Установка и удаление программ» Windows.
- **Портативная редакция (Portable)**: доступен однофайловый дистрибутив для работы без установки с любого внешнего накопителя.

### 3. Пользовательский интерфейс и UX (Overview & Standby Pool)
- **Standby Pool**: резервный пул профилей на главном экране Overview для переключения в 1 клик при исчерпании лимитов.
- **Прямой вход**: кнопка «Войти через Google» вынесена непосредственно на главный командный пульт.
- **Live Tray**: отображение критического остатка квоты и таймеров сброса прямо в системном трее Windows с полупрозрачной HUD-панелью при наведении.
- **Устранение ложных предупреждений**: удалены устаревшие предупреждения о тестовом режиме коннектора.

### 4. Надёжность и безопасность
- **Windows DPAPI Vault**: 100% локальное шифрование авторизационных данных аппаратными средствами Windows.
- **Safe Rollback**: транзакционный откат на предыдущую сессию в случае ошибки запуска.
- **380 тестов**: 100% успешное прохождение полного набора из 74 тестовых сьютов Vitest.

---

## Контрольные суммы (SHA-256)

\`\`\`text
41b8d69f80afdf14a73859d7c023b07555bf1734a26091eb30d6ba8dd4866bea  Account-Manager-EGO-Setup-3.1.7.exe
74960b79d7907eeb5ad80dea801da6b1628de3552747089837c922c7e068a76f  Account-Manager-EGO-3.1.7.exe
\`\`\`
`;

async function fetchGithub(url, options = {}) {
  const headers = {
    'Authorization': `token ${token}`,
    'User-Agent': 'Egoist-Release-Tool',
    'Accept': 'application/vnd.github.v3+json',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  return res;
}

// 2. Check if release exists
console.log(`2. Checking release ${tag}...`);
let release = null;
const getRes = await fetchGithub(`https://api.github.com/repos/${repo}/releases/tags/${tag}`);
if (getRes.ok) {
  release = await getRes.json();
  console.log(`   Found existing release ID: ${release.id}`);
  // Update name and body
  const patchRes = await fetchGithub(`https://api.github.com/repos/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: releaseName, body: releaseBody })
  });
  if (!patchRes.ok) {
    throw new Error('Failed to update release: ' + (await patchRes.text()));
  }
  release = await patchRes.json();
  console.log('   Updated release details.');
} else {
  console.log(`   Release ${tag} does not exist yet. Creating...`);
  const postRes = await fetchGithub(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name: releaseName,
      body: releaseBody,
      draft: false,
      prerelease: false
    })
  });
  if (!postRes.ok) {
    throw new Error('Failed to create release: ' + (await postRes.text()));
  }
  release = await postRes.json();
  console.log(`   Created release ID: ${release.id}, URL: ${release.html_url}`);
}

// 3. Upload assets
const uploadUrlTemplate = release.upload_url; // e.g. "https://uploads.github.com/repos/.../releases/12345/assets{?name,label}"
const baseUrl = uploadUrlTemplate.replace(/\{\?name,label\}$/, '');

// Delete existing assets if they match
if (release.assets && release.assets.length > 0) {
  for (const asset of release.assets) {
    console.log(`   Removing stale asset: ${asset.name} (ID: ${asset.id})...`);
    await fetchGithub(asset.url, { method: 'DELETE' });
  }
}

const filesToUpload = [
  { name: 'Account-Manager-EGO-Setup-3.1.7.exe', path: 'release/Account-Manager-EGO-Setup-3.1.7.exe', contentType: 'application/octet-stream' },
  { name: 'Account-Manager-EGO-3.1.7.exe', path: 'release/Account-Manager-EGO-3.1.7.exe', contentType: 'application/octet-stream' },
  { name: 'SHA256SUMS-3.1.7.txt', path: 'release/SHA256SUMS-3.1.7.txt', contentType: 'text/plain' }
];

console.log('\n3. Uploading release assets to GitHub...');
for (const file of filesToUpload) {
  const filePath = path.resolve(file.path);
  const stat = fs.statSync(filePath);
  console.log(`   Uploading ${file.name} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`);

  const fileBuffer = fs.readFileSync(filePath);
  const uploadUrl = `${baseUrl}?name=${encodeURIComponent(file.name)}`;

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'Egoist-Release-Tool',
      'Content-Type': file.contentType,
      'Content-Length': stat.size.toString()
    },
    body: fileBuffer,
    duplex: 'half'
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload ${file.name}: ${uploadRes.status} ${uploadRes.statusText}\n${await uploadRes.text()}`);
  }
  const uploaded = await uploadRes.json();
  console.log(`   OK: Uploaded ${file.name} (Download URL: ${uploaded.browser_download_url})`);
}

console.log('\n======================================================');
console.log('SUCCESS! Account Manager EGO 3.1.7 published to GitHub');
console.log(`Release URL: ${release.html_url}`);
console.log('======================================================\n');
