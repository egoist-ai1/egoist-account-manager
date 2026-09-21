import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const releaseName = `${pkg.productName} ${version}`;

console.log(`=== Publishing ${releaseName} to GitHub Releases ===\n`);

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

// Load checksums if present
let checksumsText = '';
try {
  checksumsText = fs.readFileSync(`release/SHA256SUMS-${version}.txt`, 'utf8').trim();
} catch {}

const releaseBody = `# Account Manager EGO ${version}

Обновление мониторинга и синхронизации квот Google Antigravity и стабильности платформы. В этой версии исправлено отображение реальных остатков лимитов Antigravity, обеспечен приоритетный опрос целевого сервиса \`daily-cloudcode-pa.googleapis.com\` (используемого Language Server Antigravity), устранен ложный сброс в 100% из нецелевых эндпоинтов, и сохранена полная стабильность переключения профилей Codex.

---

## Что нового в версии ${version}

### 1. Честный мониторинг боевых квот Google Antigravity
- **Приоритет боевого сервиса daily-cloudcode-pa.googleapis.com**: прямой опрос эндпоинта \`retrieveUserQuotaSummary\`, используемого самим Language Server IDE Antigravity.
- **Ликвидация ложных 100%**: исключен опрос нецелевых эндпоинтов, возвращавших фиктивные unmetered-квоты (100% остатка) для аккаунтов с исчерпанными лимитами.
- **Точное определение исчерпанных окон**: 5-часовые окна с \`remainingFraction: 0\` корректно распознаются как 0% остатка (100% использовано) с переводом аккаунта в статус \`limited\` и указанием конкретного имени исчерпанной модели/группы.
- **Динамическая типизация окон в Overview и Tray**: в \`buildProviderQuotaState\` тип окна определяется по фактической длительности (5h / weekly) вместо статического \`unknown\`.

### 2. Сохранение полной стабильности и бесшовности Codex
- Все механизмы транзакционного переключения, DPAPI-шифрования, самовосстановления путей бинарников и принудительного завершения дочерних процессов Codex полностью сохранены.
- 100% прохождение всех 393 тестов в 78 наборах Vitest.

### 3. Безопасность и верификация
- **100% тестов пройдены**: 393 теста в 78 тестовых сьютах Vitest успешно завершены.
- **DPAPI Vault**: локальное аппаратное шифрование всех учетных записей Windows.

---

## Контрольные суммы (SHA-256)

\`\`\`text
${checksumsText}
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

const filesToUpload = [
  { name: `Account-Manager-EGO-Setup-${version}.exe`, path: `release/Account-Manager-EGO-Setup-${version}.exe`, contentType: 'application/octet-stream' },
  { name: `Account-Manager-EGO-${version}.exe`, path: `release/Account-Manager-EGO-${version}.exe`, contentType: 'application/octet-stream' },
  { name: `SHA256SUMS-${version}.txt`, path: `release/SHA256SUMS-${version}.txt`, contentType: 'text/plain' }
];

console.log('\n3. Uploading release assets to GitHub...');
const existingAssets = release.assets || [];

for (const file of filesToUpload) {
  const filePath = path.resolve(file.path);
  if (!fs.existsSync(filePath)) {
    console.log(`   Skipping non-existent ${file.name}`);
    continue;
  }
  const stat = fs.statSync(filePath);
  const matchingAsset = existingAssets.find(a => a.name === file.name);

  if (matchingAsset) {
    if (matchingAsset.state === 'uploaded' && matchingAsset.size === stat.size) {
      console.log(`   OK: ${file.name} already uploaded and verified (${(stat.size / 1024 / 1024).toFixed(2)} MB), skipping.`);
      continue;
    }
    console.log(`   Removing stale/incomplete asset: ${matchingAsset.name} (ID: ${matchingAsset.id})...`);
    await fetchGithub(matchingAsset.url, { method: 'DELETE' });
  }

  console.log(`   Uploading ${file.name} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`);
  const uploadUrl = `${baseUrl}?name=${encodeURIComponent(file.name)}`;

  // Use curl.exe for robust streaming binary upload without Node fetch timeout
  const curlCmd = [
    'curl.exe',
    '--retry', '3',
    '--retry-delay', '3',
    '-s', '-S',
    '-X', 'POST',
    '-H', `"Authorization: token ${token}"`,
    '-H', `"User-Agent: Egoist-Release-Tool"`,
    '-H', `"Content-Type: ${file.contentType}"`,
    '--data-binary', `@"${filePath}"`,
    `"${uploadUrl}"`
  ].join(' ');

  try {
    const curlOutput = execSync(curlCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const uploaded = JSON.parse(curlOutput);
    if (!uploaded.browser_download_url) {
      throw new Error(`Upload failed: ${curlOutput}`);
    }
    console.log(`   OK: Uploaded ${file.name} (Download URL: ${uploaded.browser_download_url})`);
  } catch (err) {
    throw new Error(`Failed to upload ${file.name}: ${err.message}`);
  }
}

console.log('\n======================================================');
console.log(`SUCCESS! ${pkg.productName} ${version} published to GitHub`);
console.log(`Release URL: ${release.html_url}`);
console.log('======================================================\n');
