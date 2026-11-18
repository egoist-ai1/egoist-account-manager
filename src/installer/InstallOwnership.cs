using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;

namespace AccountManagerEGO.Installer
{
    public sealed class OwnedFile
    {
        public string relativePath { get; set; }
        public string sha256 { get; set; }
    }

    public sealed class OwnershipManifest
    {
        public int schemaVersion { get; set; }
        public string appId { get; set; }
        public string version { get; set; }
        public string installRoot { get; set; }
        public bool testMode { get; set; }
        public List<OwnedFile> files { get; set; }
    }

    public sealed class LegacyOwnershipReference
    {
        public int schemaVersion { get; set; }
        public string appId { get; set; }
        public string version { get; set; }
        public string sourceAsarSha256 { get; set; }
        public List<OwnedFile> files { get; set; }
    }

    public sealed class InstallFailure : IOException
    {
        public string Code { get; private set; }
        public string RelativePath { get; private set; }
        public InstallFailure(string code, string message, string relativePath = null, Exception inner = null) : base(message, inner)
        { Code = code; RelativePath = relativePath; }
    }

    public static class InstallOwnership
    {
        public const string AppId = "one.egoist.codex-account-manager";
        public const string ManifestName = ".egoist-install.json";
        public const string ExecutableName = "Kvesser.exe";
        public const string UninstallerName = "Uninstall Kvesser.exe";
        private const string PreviousExecutable = "Egoist.exe";
        private const string PreviousUninstaller = "Uninstall Egoist.exe";
        internal static Action<string> BeforeMutation = delegate { };
        internal static Action<string> BeforeNativeIntegration = delegate { };
        internal static Func<Environment.SpecialFolder, string> ReadSpecialFolder = Environment.GetFolderPath;
        private const string LegacyExecutable = "Account Manager EGO.exe";
        private const string RegistryPath = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AccountManagerEGO";
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
        private static readonly StringComparer PathComparer = StringComparer.OrdinalIgnoreCase;
        private static readonly string[] LegacyTopFiles = {
            LegacyExecutable, "Uninstall Account Manager EGO.exe", "chrome_100_percent.pak", "chrome_200_percent.pak",
            "d3dcompiler_47.dll", "dxcompiler.dll", "dxil.dll", "ffmpeg.dll", "icudtl.dat", "libEGL.dll", "libGLESv2.dll",
            "LICENSE.electron.txt", "LICENSES.chromium.html", "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin",
            "version", "vk_swiftshader_icd.json", "vk_swiftshader.dll", "vulkan-1.dll", "resources/app.asar", "resources/icon.png",
            "resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
        };
        private static readonly HashSet<string> LegacyLocales = new HashSet<string>((
            "af am ar bg bn ca cs da de el en-GB en-US es es-419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nb nl pl pt-BR pt-PT ro ru sk sl sr sv sw ta te th tr uk ur vi zh-CN zh-TW"
        ).Split(' '), PathComparer);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);
        [StructLayout(LayoutKind.Sequential)]
        private struct FileInformation
        {
            public uint attributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME creationTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME lastAccessTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME lastWriteTime;
            public uint volumeSerial, sizeHigh, sizeLow, links, indexHigh, indexLow;
        }

        private sealed class DirectoryLocks : IDisposable
        {
            private readonly Dictionary<string, SafeFileHandle> handles = new Dictionary<string, SafeFileHandle>(PathComparer);
            public void Hold(string directory)
            {
                if (handles.ContainsKey(directory)) return;
                SafeFileHandle handle = CreateFile(directory, 0, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                FileInformation info;
                if (handle.IsInvalid || !GetFileInformationByHandle(handle, out info) || (info.attributes & 0x400) != 0 || (info.attributes & 0x10) == 0)
                {
                    handle.Dispose();
                    throw new IOException("Папка недоступна либо является ссылкой: " + directory);
                }
                handles.Add(directory, handle);
            }
            public void Release(string directory)
            {
                SafeFileHandle handle;
                if (handles.TryGetValue(directory, out handle)) { handle.Dispose(); handles.Remove(directory); }
            }
            public void Dispose() { foreach (SafeFileHandle handle in handles.Values) handle.Dispose(); handles.Clear(); }
        }

        public static string CanonicalRoot(string input)
        {
            if (String.IsNullOrWhiteSpace(input) || !Regex.IsMatch(input, @"^[A-Za-z]:[\\/]"))
                throw new IOException("Укажите абсолютный путь на локальном диске.");
            string normalized = input.Replace('/', '\\').TrimEnd('\\');
            foreach (string component in normalized.Substring(3).Split('\\'))
            {
                if (component == "." || component == ".." || component.EndsWith(".") || component.EndsWith(" ") || component.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Regex.IsMatch(component, @"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)", RegexOptions.IgnoreCase))
                    throw new IOException("Путь содержит недопустимый компонент.");
            }
            string root = Path.GetFullPath(normalized);
            if (root.Length <= 3 || PathComparer.Equals(root.TrimEnd('\\'), Path.GetPathRoot(root).TrimEnd('\\')))
                throw new IOException("Корень диска не может быть папкой приложения.");
            DriveType driveType = new DriveInfo(Path.GetPathRoot(root)).DriveType;
            if (driveType != DriveType.Fixed && driveType != DriveType.Removable && driveType != DriveType.Ram)
                throw new IOException("Установка поддерживается только на локальном диске.");
            string user = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var protectedRoots = new List<string> {
                user, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
                Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Path.Combine(user, "Downloads"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs")
            };
            foreach (string protectedRoot in protectedRoots.Where(p => !String.IsNullOrWhiteSpace(p)))
                if (PathComparer.Equals(root, protectedRoot.TrimEnd('\\')) || protectedRoot.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase))
                    throw new IOException("Выберите отдельную папку приложения, а не системную или пользовательскую папку.");
            foreach (string protectedTree in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
                if (!String.IsNullOrWhiteSpace(protectedTree) && (PathComparer.Equals(root, protectedTree.TrimEnd('\\')) || root.StartsWith(protectedTree.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)))
                    throw new IOException("Для установки без прав администратора выберите пользовательскую папку.");
            CheckComponents(root, null);
            return root;
        }

        private static void CheckComponents(string fullPath, DirectoryLocks locks)
        {
            string drive = Path.GetPathRoot(fullPath);
            string current = drive;
            if (locks != null) locks.Hold(current);
            foreach (string component in fullPath.Substring(drive.Length).Split('\\'))
            {
                if (component.Length == 0) continue;
                current = Path.Combine(current, component);
                FileAttributes attributes;
                try { attributes = File.GetAttributes(current); }
                catch (FileNotFoundException) { break; }
                catch (DirectoryNotFoundException) { break; }
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Ссылки и junction не допускаются в пути установки.");
                if ((attributes & FileAttributes.Directory) != 0) { if (locks != null) locks.Hold(current); }
                else if (!PathComparer.Equals(current, fullPath)) throw new IOException("Компонент пути не является папкой.");
            }
        }

        public static string RelativeTarget(string root, string relative)
        {
            if (String.IsNullOrWhiteSpace(relative) || relative.Length > 220 || relative.Contains("\\") || relative.StartsWith("/") || relative.EndsWith("/"))
                throw new IOException("Недопустимый относительный путь в manifest.");
            foreach (string part in relative.Split('/'))
            {
                if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)", RegexOptions.IgnoreCase))
                    throw new IOException("Недопустимый относительный путь в manifest.");
            }
            string full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', '\\')));
            if (!full.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) throw new IOException("Файл находится за пределами папки установки.");
            CheckComponents(full, null);
            return full;
        }

        private static string HashFile(string file)
        {
            using (FileStream stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                FileInformation info;
                if (!GetFileInformationByHandle(stream.SafeFileHandle, out info) || info.links != 1 || (info.attributes & 0x400) != 0)
                    throw new IOException("Файл является ссылкой либо не может быть безопасно проверен.");
                using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
        }

        private static OwnershipManifest ReadManifest(string file, string root, bool installed)
        {
            OwnershipManifest manifest;
            if (new FileInfo(file).Length > 8 * 1024 * 1024) throw new IOException("Manifest слишком велик.");
            try { manifest = Json.Deserialize<OwnershipManifest>(File.ReadAllText(file, Encoding.UTF8)); }
            catch (Exception ex) { throw new IOException("Manifest повреждён.", ex); }
            if (manifest == null || manifest.schemaVersion != 1 || manifest.appId != AppId || String.IsNullOrWhiteSpace(manifest.version) || manifest.files == null || manifest.files.Count == 0 || manifest.files.Count > 15000)
                throw new IOException("Папка не принадлежит этому приложению.");
            if (installed && !PathComparer.Equals(root, manifest.installRoot)) throw new IOException("Manifest принадлежит другой папке.");
            var names = new HashSet<string>(PathComparer);
            foreach (OwnedFile fileEntry in manifest.files)
            {
                if (fileEntry == null || !Regex.IsMatch(fileEntry.sha256 ?? "", "^[0-9a-f]{64}$") || !names.Add(fileEntry.relativePath ?? "") || fileEntry.relativePath == ManifestName)
                    throw new IOException("Manifest содержит недопустимые или повторяющиеся файлы.");
                RelativeTarget(root, fileEntry.relativePath);
            }
            bool currentPair = names.Contains(ExecutableName) && names.Contains(UninstallerName);
            bool previousPair = names.Contains(PreviousExecutable) && names.Contains(PreviousUninstaller);
            if (installed && (!names.Contains("resources/app.asar") || currentPair == previousPair))
                throw new IOException("Manifest не содержит обязательные файлы приложения.");
            return manifest;
        }

        internal static Func<string> ReadRegisteredInstallLocation = delegate
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RegistryPath))
                return key == null ? null : key.GetValue("InstallLocation") as string;
        };

        private static OwnershipManifest ReadLegacy(string root)
        {
            string registered = ReadRegisteredInstallLocation();
            return ReadLegacyForRegisteredRoot(root, registered);
        }

        internal static OwnershipManifest ReadLegacyForRegisteredRoot(string root, string registered)
        {
            if (String.IsNullOrWhiteSpace(registered) || !PathComparer.Equals(Path.GetFullPath(registered).TrimEnd('\\'), root)) return null;
            string executable = RelativeTarget(root, LegacyExecutable);
            if (!File.Exists(executable) || !File.Exists(RelativeTarget(root, "resources/app.asar"))) return null;
            var metadata = System.Diagnostics.FileVersionInfo.GetVersionInfo(executable);
            if (metadata.ProductName != "Account Manager EGO" || metadata.ProductVersion != "3.1.10.0") return null;
            var files = new List<OwnedFile>();
            var paths = new List<string>(LegacyTopFiles);
            paths.AddRange(LegacyLocales.Select(locale => "locales/" + locale + ".pak"));
            foreach (string relative in paths)
            {
                string target = RelativeTarget(root, relative);
                if (File.Exists(target)) files.Add(new OwnedFile { relativePath = relative, sha256 = HashFile(target) });
            }
            foreach (OwnedFile expected in TrustedLegacyExtras())
            {
                string target = RelativeTarget(root, expected.relativePath);
                if (File.Exists(target) && HashFile(target) == expected.sha256)
                    files.Add(new OwnedFile { relativePath = expected.relativePath, sha256 = expected.sha256 });
            }
            return new OwnershipManifest { schemaVersion = 1, appId = AppId, version = "3.1.10", installRoot = root, files = files };
        }

        private static List<OwnedFile> TrustedLegacyExtras()
        {
            using (var stream = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("Legacy311Payload.json"))
            {
                if (stream == null) throw new IOException("В сборке отсутствует проверенный список файлов прежней установки.");
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    var reference = Json.Deserialize<LegacyOwnershipReference>(reader.ReadToEnd());
                    if (reference == null || reference.schemaVersion != 1 || reference.appId != AppId || reference.version != "3.1.10"
                        || !Regex.IsMatch(reference.sourceAsarSha256 ?? "", "^[0-9a-f]{64}$") || reference.files == null || reference.files.Count > 15000)
                        throw new IOException("Проверенный список файлов прежней установки повреждён.");
                    var paths = new HashSet<string>(PathComparer);
                    foreach (OwnedFile file in reference.files)
                        if (file == null || !paths.Add(file.relativePath ?? "") || !Regex.IsMatch(file.sha256 ?? "", "^[0-9a-f]{64}$"))
                            throw new IOException("Список прежних файлов содержит недопустимые записи.");
                    if (!reference.files.Any(file => file.relativePath == "resources/app.asar" && file.sha256 == reference.sourceAsarSha256))
                        throw new IOException("Список прежних файлов не связан с проверенным исходным ASAR.");
                    return reference.files.Where(file => !LegacyTopFiles.Contains(file.relativePath, PathComparer)
                        && !(file.relativePath.StartsWith("locales/", StringComparison.Ordinal) && file.relativePath.EndsWith(".pak", StringComparison.Ordinal)
                            && LegacyLocales.Contains(file.relativePath.Substring(8, file.relativePath.Length - 12)))).ToList();
                }
            }
        }

        public static string DefaultDirectory()
        {
            try
            {
                string registered = ReadRegisteredInstallLocation();
                if (!String.IsNullOrWhiteSpace(registered))
                { string root = CanonicalRoot(registered); ValidateDirectory(root, false); return root; }
            }
            catch (Exception) { }
            return Path.Combine(ReadSpecialFolder(Environment.SpecialFolder.LocalApplicationData), "Programs", "Kvesser");
        }

        public static OwnershipManifest ValidateDirectory(string input, bool testMode)
        {
            string root = CanonicalRoot(input);
            if (File.Exists(root)) throw new IOException("Вместо папки указан файл.");
            string manifestPath = RelativeTarget(root, ManifestName);
            OwnershipManifest existing = File.Exists(manifestPath) ? ReadManifest(manifestPath, root, true) : null;
            if (existing == null && Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any())
            {
                existing = ReadLegacy(root);
                if (existing == null) throw new IOException("Папка не пуста и не принадлежит Квессер. Выберите новую отдельную папку.");
            }
            if (testMode && existing != null && !existing.testMode) throw new IOException("Тестовая установка запрещена в обычную папку приложения.");
            if (!testMode)
            {
                string registered = ReadRegisteredInstallLocation();
                if (!String.IsNullOrWhiteSpace(registered) && Directory.Exists(registered) && !PathComparer.Equals(Path.GetFullPath(registered).TrimEnd('\\'), root))
                    throw new IOException("Уже есть установка в другой папке. Обновите её либо сначала удалите приложение.");
            }
            return existing;
        }

        private static void EnsureDirectory(string directory, DirectoryLocks locks, List<string> created = null)
        {
            if (!Directory.Exists(directory))
            {
                string parent = Path.GetDirectoryName(directory);
                if (!Directory.Exists(parent)) EnsureDirectory(parent, locks, created);
                else CheckComponents(parent, locks);
                Directory.CreateDirectory(directory);
                if (created != null) created.Add(directory);
            }
            CheckComponents(directory, locks);
        }

        private static void WriteManifest(string root, OwnershipManifest manifest)
        {
            string temp = RelativeTarget(root, ".egoist-manifest-" + Guid.NewGuid().ToString("N") + ".tmp");
            File.WriteAllText(temp, Json.Serialize(manifest), new UTF8Encoding(false));
            string destination = RelativeTarget(root, ManifestName);
            if (File.Exists(destination)) File.Replace(temp, destination, null);
            else File.Move(temp, destination);
        }

        public static void Install(string source, string packageManifest, string input, string uninstaller, bool testMode)
        {
            string root = CanonicalRoot(input);
            BeforeMutation(root);
            OwnershipManifest previous = ValidateDirectory(root, testMode);
            OwnershipManifest payload = ReadManifest(packageManifest, source.TrimEnd('\\'), false);
            if (!payload.files.Any(f => f.relativePath == ExecutableName) || !payload.files.Any(f => f.relativePath == "resources/app.asar"))
                throw new IOException("В payload отсутствуют обязательные файлы.");
            var entries = new List<OwnedFile>(payload.files);
            if (entries.Any(f => PathComparer.Equals(f.relativePath, UninstallerName) || PathComparer.Equals(f.relativePath, PreviousUninstaller) || PathComparer.Equals(f.relativePath, "installer-test.flag")))
                throw new IOException("Payload содержит служебный файл установщика.");
            entries.Add(new OwnedFile { relativePath = UninstallerName, sha256 = HashFile(uninstaller) });
            var previousFiles = previous == null ? new Dictionary<string, OwnedFile>(PathComparer) : previous.files.ToDictionary(f => f.relativePath, PathComparer);
            string rollback = RelativeTarget(root, ".egoist-recovery-" + Guid.NewGuid().ToString("N"));
            var originalFiles = new Dictionary<string, string>(PathComparer);
            var changed = new List<string>();
            var applied = new HashSet<string>(PathComparer);
            var stagingPaths = new Dictionary<string, string>(PathComparer);
            var created = new List<string>();
            byte[] oldManifest = File.Exists(Path.Combine(root, ManifestName)) ? File.ReadAllBytes(Path.Combine(root, ManifestName)) : null;
            using (var locks = new DirectoryLocks())
            {
                CheckComponents(root, locks);
                foreach (OwnedFile entry in entries)
                {
                    string original = entry.relativePath == UninstallerName ? uninstaller : RelativeTarget(source, entry.relativePath);
                    if (original.Length >= 260) throw new InstallFailure("temporary-path-too-long", "Временная папка установщика слишком длинная. Используйте более короткую папку TEMP и повторите запуск.", entry.relativePath);
                    if (!File.Exists(original) || HashFile(original) != entry.sha256) throw new InstallFailure("payload-invalid", "Файл в установщике не прошёл проверку. Скачайте сборку заново.", entry.relativePath);
                    string destination = RelativeTarget(root, entry.relativePath);
                    string parent = Path.GetDirectoryName(destination);
                    string staging = Path.Combine(parent, ".eg-" + Guid.NewGuid().ToString("N") + ".tmp");
                    // .NET Framework APIs retain MAX_PATH limits. Reject before creating the root.
                    if (destination.Length >= 260 || staging.Length >= 260 || parent.Length >= 248)
                        throw new InstallFailure("path-too-long", "Путь слишком длинный. Выберите более короткую папку установки.", entry.relativePath);
                    CheckComponents(staging, locks);
                    if (File.Exists(staging) || Directory.Exists(staging)) throw new IOException("Конфликт временного файла установки.");
                    stagingPaths.Add(entry.relativePath, staging);
                    if (Directory.Exists(destination)) throw new InstallFailure("file-conflict", "Файл приложения конфликтует с существующей папкой. Посторонние данные сохранены.", entry.relativePath);
                    if (File.Exists(destination))
                    {
                        OwnedFile owned;
                        if (!previousFiles.TryGetValue(entry.relativePath, out owned) || HashFile(destination) != owned.sha256)
                            throw new InstallFailure("file-conflict", "Файл не принадлежит установке или был изменён. Посторонние данные сохранены.", entry.relativePath);
                    }
                    CheckComponents(Path.GetDirectoryName(destination), locks);
                }
                foreach (OwnedFile obsolete in previousFiles.Values.Where(f => !entries.Any(n => PathComparer.Equals(n.relativePath, f.relativePath))))
                {
                    string target = RelativeTarget(root, obsolete.relativePath);
                    if (File.Exists(target) && HashFile(target) != obsolete.sha256) throw new InstallFailure("modified-owned-file", "Файл прежней установки изменён и будет сохранён. Закройте приложение и проверьте этот файл.", obsolete.relativePath);
                    CheckComponents(Path.GetDirectoryName(target), locks);
                }
                EnsureDirectory(root, locks, created);
                EnsureDirectory(rollback, locks);
                WriteRecoveryJournal(rollback, root, payload.version, oldManifest, previousFiles, entries, originalFiles, changed);
                try
                {
                    foreach (OwnedFile entry in entries)
                    {
                        string destination = RelativeTarget(root, entry.relativePath);
                        string parent = Path.GetDirectoryName(destination);
                        EnsureDirectory(parent, locks, created);
                        if (File.Exists(destination))
                        {
                            OwnedFile owned = previousFiles[entry.relativePath];
                            if (HashFile(destination) != owned.sha256) throw new IOException("Файл изменился во время установки.");
                            string saved = Path.Combine(rollback, originalFiles.Count.ToString());
                            File.Copy(destination, saved, false);
                            originalFiles.Add(entry.relativePath, saved);
                            if (HashFile(saved) != owned.sha256) throw new IOException("Резервная копия старого файла повреждена.");
                        }
                        string staging = stagingPaths[entry.relativePath];
                        string original = entry.relativePath == UninstallerName ? uninstaller : RelativeTarget(source, entry.relativePath);
                        bool ownsStage = false;
                        try
                        {
                            using (var output = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                            {
                                ownsStage = true;
                                using (var inputFile = new FileStream(original, FileMode.Open, FileAccess.Read, FileShare.Read)) inputFile.CopyTo(output);
                                output.Flush(true);
                            }
                            if (HashFile(staging) != entry.sha256) throw new IOException("Копия payload повреждена.");
                            changed.Add(entry.relativePath);
                            WriteRecoveryJournal(rollback, root, payload.version, oldManifest, previousFiles, entries, originalFiles, changed);
                            InstallPhase("before-file-apply");
                            if (File.Exists(destination))
                            {
                                OwnedFile owned;
                                if (!previousFiles.TryGetValue(entry.relativePath, out owned) || HashFile(destination) != owned.sha256)
                                    throw new InstallFailure("file-conflict", "Файл изменился во время установки и будет сохранён.", entry.relativePath);
                                File.Replace(staging, destination, null);
                            }
                            else File.Move(staging, destination);
                            applied.Add(entry.relativePath);
                            InstallPhase("file-applied");
                        }
                        finally { if (ownsStage && File.Exists(staging)) File.Delete(staging); }
                    }
                    foreach (OwnedFile obsolete in previousFiles.Values.Where(f => !entries.Any(n => PathComparer.Equals(n.relativePath, f.relativePath))))
                    {
                        string target = RelativeTarget(root, obsolete.relativePath);
                        if (!File.Exists(target)) continue;
                        if (HashFile(target) != obsolete.sha256) throw new IOException("Старый файл изменился во время установки.");
                        string saved = Path.Combine(rollback, originalFiles.Count.ToString());
                        File.Copy(target, saved, false);
                        originalFiles.Add(obsolete.relativePath, saved);
                        changed.Add(obsolete.relativePath);
                        if (HashFile(saved) != obsolete.sha256) throw new IOException("Резервная копия старого файла повреждена.");
                        WriteRecoveryJournal(rollback, root, payload.version, oldManifest, previousFiles, entries, originalFiles, changed);
                        File.Delete(target);
                        applied.Add(obsolete.relativePath);
                    }
                    WriteManifest(root, new OwnershipManifest { schemaVersion = 1, appId = AppId, version = payload.version, installRoot = root, testMode = testMode, files = entries });
                }
                catch (Exception installError)
                {
                    try
                    {
                        InstallPhase("before-rollback");
                        foreach (string relative in changed.Where(applied.Contains).Reverse())
                        {
                            string target = RelativeTarget(root, relative);
                            string saved;
                            if (originalFiles.TryGetValue(relative, out saved)) File.Copy(saved, target, true);
                            else if (File.Exists(target)) File.Delete(target);
                        }
                        if (oldManifest == null) { string target = RelativeTarget(root, ManifestName); if (File.Exists(target)) File.Delete(target); }
                        else File.WriteAllBytes(RelativeTarget(root, ManifestName), oldManifest);
                    }
                    catch (Exception rollbackError) { throw new InstallFailure("recovery-required", "Установка прервана. Материалы восстановления сохранены в папке установки. Не удаляйте её до восстановления.", null, new AggregateException(installError, rollbackError)); }
                    CleanupRecovery(rollback, originalFiles.Values, locks);
                    foreach (string directory in created.Where(p => PathComparer.Equals(p, root) || p.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)).OrderByDescending(p => p.Length))
                    {
                        locks.Release(directory);
                        if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory, false);
                    }
                    throw;
                }
                CleanupRecovery(rollback, originalFiles.Values, locks);
            }
        }

        internal static Action<string> InstallPhase = delegate { };

        private static void WriteRecoveryJournal(string rollback, string root, string version, byte[] oldManifest,
            Dictionary<string, OwnedFile> previous, List<OwnedFile> current, Dictionary<string, string> originals, List<string> changed)
        {
            File.WriteAllText(Path.Combine(rollback, "recovery.json"), Json.Serialize(new {
                schemaVersion = 1, appId = AppId, installRoot = root, version = version,
                previousManifest = oldManifest == null ? null : Convert.ToBase64String(oldManifest),
                previousFiles = previous.Values, currentFiles = current,
                backups = originals.Select(entry => new { relativePath = entry.Key, savedName = Path.GetFileName(entry.Value), sha256 = previous[entry.Key].sha256 }),
                changed = changed
            }), new UTF8Encoding(false));
        }

        private static void CleanupRecovery(string rollback, IEnumerable<string> originals, DirectoryLocks locks)
        {
            foreach (string saved in originals)
            {
                CheckComponents(saved, locks);
                if (File.Exists(saved)) File.Delete(saved);
            }
            string journal = Path.Combine(rollback, "recovery.json");
            CheckComponents(journal, locks);
            if (File.Exists(journal)) File.Delete(journal);
            locks.Release(rollback);
            if (!Directory.EnumerateFileSystemEntries(rollback).Any()) Directory.Delete(rollback, false);
        }

        public static bool IsTestInstall(string input)
        {
            string root = CanonicalRoot(input);
            return ReadManifest(RelativeTarget(root, ManifestName), root, true).testMode;
        }

        public static int Uninstall(string input)
        {
            string root = CanonicalRoot(input);
            BeforeMutation(root);
            OwnershipManifest manifest = ReadManifest(RelativeTarget(root, ManifestName), root, true);
            var removable = new List<OwnedFile>();
            var preserved = new List<OwnedFile>();
            var directories = new HashSet<string>(PathComparer);
            using (var locks = new DirectoryLocks())
            {
                CheckComponents(root, locks);
                foreach (OwnedFile entry in manifest.files)
                {
                    string target = RelativeTarget(root, entry.relativePath);
                    CheckComponents(Path.GetDirectoryName(target), locks);
                    if (Directory.Exists(target)) throw new IOException("Manifest ссылается на папку вместо файла.");
                    if (File.Exists(target))
                    {
                        if (HashFile(target) == entry.sha256) removable.Add(entry);
                        else preserved.Add(entry);
                    }
                    string directory = Path.GetDirectoryName(target);
                    while (!PathComparer.Equals(directory, root)) { directories.Add(directory); directory = Path.GetDirectoryName(directory); }
                }
                foreach (OwnedFile entry in removable.OrderBy(f => f.relativePath == UninstallerName ? 1 : 0))
                {
                    string target = RelativeTarget(root, entry.relativePath);
                    if (HashFile(target) != entry.sha256) throw new IOException("Файл изменился во время удаления.");
                    File.Delete(target);
                }
                if (!manifest.testMode) RemoveIntegration(root);
                if (preserved.Count == 0) File.Delete(RelativeTarget(root, ManifestName));
                else WriteManifest(root, manifest);
                foreach (string directory in directories.OrderByDescending(p => p.Length))
                {
                    locks.Release(directory);
                    if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory, false);
                }
                locks.Release(root);
                if (!Directory.EnumerateFileSystemEntries(root).Any()) Directory.Delete(root, false);
            }
            return preserved.Count == 0 ? 0 : 10;
        }

        private static bool OwnedShortcut(string shortcut, string root)
        {
            if (!File.Exists(shortcut)) return true;
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object link = shellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { shortcut });
            try
            {
                string target = (string)link.GetType().InvokeMember("TargetPath", System.Reflection.BindingFlags.GetProperty, null, link, null);
                return new[] { ExecutableName, "Egoist.exe", LegacyExecutable }.Any(name => PathComparer.Equals(target, Path.Combine(root, name)));
            }
            finally { Marshal.FinalReleaseComObject(link); Marshal.FinalReleaseComObject(shell); }
        }

        public static void Integrate(string input, string version, bool desktop)
        {
            string root = CanonicalRoot(input);
            BeforeMutation(root);
            BeforeNativeIntegration(root);
            OwnershipManifest manifest = ReadManifest(RelativeTarget(root, ManifestName), root, true);
            if (manifest.testMode) throw new IOException("Тестовая установка не меняет реестр и ярлыки.");
            if (version != manifest.version) throw new IOException("Версия интеграции не совпадает с установленными файлами.");
            string menuDirectory = Path.Combine(ReadSpecialFolder(Environment.SpecialFolder.Programs), "Квессер");
            string menuShortcut = Path.Combine(menuDirectory, "Квессер.lnk");
            string desktopShortcut = Path.Combine(ReadSpecialFolder(Environment.SpecialFolder.DesktopDirectory), "Квессер.lnk");
            if (!OwnedShortcut(menuShortcut, root) || (desktop && !OwnedShortcut(desktopShortcut, root))) throw new IOException("Ярлык Квессер принадлежит другой программе; он сохранён.");
            Directory.CreateDirectory(menuDirectory);
            CreateShortcut(menuShortcut, Path.Combine(root, ExecutableName));
            if (desktop) CreateShortcut(desktopShortcut, Path.Combine(root, ExecutableName));
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RegistryPath))
            {
                key.SetValue("DisplayName", "Квессер"); key.SetValue("DisplayVersion", version); key.SetValue("Publisher", "Egoist Gorbachev");
                key.SetValue("InstallLocation", root); key.SetValue("DisplayIcon", Path.Combine(root, ExecutableName));
                key.SetValue("UninstallString", "\"" + Path.Combine(root, UninstallerName) + "\"");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord); key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
            RemoveLegacyShortcuts(root);
        }

        private static void CreateShortcut(string shortcut, string executable)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object link = shellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { shortcut });
            try
            {
                link.GetType().InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, link, new object[] { executable });
                link.GetType().InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, link, new object[] { Path.GetDirectoryName(executable) });
                link.GetType().InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, link, null);
            }
            finally { Marshal.FinalReleaseComObject(link); Marshal.FinalReleaseComObject(shell); }
        }

        private static void RemoveLegacyShortcuts(string root)
        {
            foreach (string name in new[] { "Egoist", "Account Manager EGO" })
            {
                string directory = Path.Combine(ReadSpecialFolder(Environment.SpecialFolder.Programs), name);
                foreach (string file in new[] { Path.Combine(directory, name + ".lnk"), Path.Combine(ReadSpecialFolder(Environment.SpecialFolder.DesktopDirectory), name + ".lnk") })
                    if (File.Exists(file) && OwnedShortcut(file, root)) File.Delete(file);
                if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory, false);
            }
        }

        private static void RemoveIntegration(string root)
        {
            BeforeNativeIntegration(root);
            string directory = Path.Combine(ReadSpecialFolder(Environment.SpecialFolder.Programs), "Квессер");
            foreach (string file in new[] { Path.Combine(directory, "Квессер.lnk"), Path.Combine(ReadSpecialFolder(Environment.SpecialFolder.DesktopDirectory), "Квессер.lnk") })
                if (File.Exists(file) && OwnedShortcut(file, root)) File.Delete(file);
            if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory, false);
            RemoveLegacyShortcuts(root);
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RegistryPath))
            {
                string registered = key == null ? null : key.GetValue("InstallLocation") as string;
                if (String.IsNullOrWhiteSpace(registered) || !PathComparer.Equals(registered.TrimEnd('\\'), root)) return;
            }
            Registry.CurrentUser.DeleteSubKey(RegistryPath, false);
        }
    }
}