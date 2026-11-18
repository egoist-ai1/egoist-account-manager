using System;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using System.Reflection;
using System.Web.Script.Serialization;
using AccountManagerEGO.Installer;

internal static class InstallerFixtureEntry
{
    private static bool configured;
    private static bool observedError;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    private static string Canonical(string input)
    {
        if (String.IsNullOrWhiteSpace(input) || !System.Text.RegularExpressions.Regex.IsMatch(input, @"^[A-Za-z]:[\\/]")) throw new InvalidOperationException("Fixture path must be absolute");
        return Path.GetFullPath(input).TrimEnd('\\');
    }

    private static void RejectLinks(string input)
    {
        string root = Path.GetPathRoot(input);
        string current = root;
        foreach (string part in input.Substring(root.Length).Split('\\'))
        {
            if (part.Length == 0) continue;
            current = Path.Combine(current, part);
            if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Fixture path contains a link");
        }
    }

    private static void Own(string input)
    {
        if (!configured) throw new InvalidOperationException("Fixture guard is not configured");
        string canonical = Canonical(input);
        if (!canonical.StartsWith(Canonical(InstallerFixtureConfig.Scratch) + "\\", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Fixture target escaped its exact scratch");
        RejectLinks(canonical);
    }

    private static void Event(string name, object data)
    {
        string file = Path.Combine(InstallerFixtureConfig.Scratch, "events.jsonl");
        Own(file);
        File.AppendAllText(file, Json.Serialize(new { name = name, data = data }) + "\n", new UTF8Encoding(false));
    }

    private static void Configure()
    {
        string work = Canonical(InstallerFixtureConfig.Work);
        string scratch = Canonical(InstallerFixtureConfig.Scratch);
        string suffix = "\\tasks\\" + InstallerFixtureConfig.ThreadId + "\\work";
        if (!work.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) || !scratch.StartsWith(work + "\\", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Fixture context does not match its task namespace");
        if (Environment.GetEnvironmentVariable("CODEX_THREAD_ID") != InstallerFixtureConfig.ThreadId)
            throw new InvalidOperationException("Fixture thread identity mismatch");
        RejectLinks(work); RejectLinks(scratch);
        if (!Canonical(Assembly.GetExecutingAssembly().Location).StartsWith(scratch + "\\", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Fixture assembly escaped scratch");
        configured = true;
        Own(InstallerFixtureConfig.Target);
        InstallOwnership.BeforeMutation = Own;
        InstallOwnership.BeforeNativeIntegration = delegate { throw new InvalidOperationException("Native integration is disabled by the fixture"); };
        InstallOwnership.ReadRegisteredInstallLocation = delegate { return InstallerFixtureConfig.Target; };
        InstallOwnership.ReadSpecialFolder = delegate(Environment.SpecialFolder folder)
        {
            if (folder == Environment.SpecialFolder.LocalApplicationData) return Path.Combine(scratch, "LocalAppData");
            if (folder == Environment.SpecialFolder.Programs) return Path.Combine(scratch, "Menu");
            if (folder == Environment.SpecialFolder.DesktopDirectory) return Path.Combine(scratch, "Desktop");
            throw new InvalidOperationException("Unmapped native folder in fixture");
        };
        ModernInstallerApp.BeforeExternalLaunch = delegate { throw new InvalidOperationException("External launches are disabled by the fixture"); };
        ModernInstallerApp.WindowReady = Observe;
        Event("guards-configured", new { target = InstallerFixtureConfig.Target, integration = "deny", registry = "constant fixture target", externalLaunch = "deny" });
    }

    private static T Field<T>(InstallerWindow window, string name)
    { return (T)typeof(InstallerWindow).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(window); }

    private static void Invoke(InstallerWindow window, string method)
    { typeof(InstallerWindow).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(window, null); }

    private static void Observe(InstallerWindow window)
    {
        window.ShowInTaskbar = false; window.Opacity = 0;
        window.WindowStartupLocation = WindowStartupLocation.Manual; window.Left = -30000; window.Top = -30000;
        Own(Field<TextBox>(window, "_txtInstallDir").Text);
        Field<ModernToggle>(window, "_toggleRunAfter").IsChecked = false;
        Field<ModernToggle>(window, "_toggleDesktopShortcut").IsChecked = false;
        window.ContentRendered += delegate
        {
            Event("gui-rendered", new { title = window.Title, directory = Field<TextBox>(window, "_txtInstallDir").Text });
            if (InstallerFixtureConfig.Scenario == "initialize") { Invoke(window, "CloseInstaller"); return; }
            Invoke(window, "StartInstallation");
        };
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
        DateTime started = DateTime.UtcNow;
        timer.Tick += delegate
        {
            if (window.IsComplete)
            {
                timer.Stop();
                if (!InstallOwnership.IsTestInstall(InstallerFixtureConfig.Target)) throw new InvalidOperationException("Fixture wrote a production manifest");
                Event("gui-complete", new { testMode = true }); Invoke(window, "FinishAndLaunch");
            }
            else if (Field<TextBlock>(window, "_configError").Visibility == Visibility.Visible && !observedError)
            {
                observedError = true;
                Event("gui-error", new { text = Field<TextBlock>(window, "_configError").Text });
                if (InstallerFixtureConfig.Scenario == "retry") Invoke(window, "StartInstallation");
                else { timer.Stop(); Invoke(window, "CloseInstaller"); }
            }
            else if ((DateTime.UtcNow - started).TotalSeconds > 20)
            {
                timer.Stop(); Event("gui-timeout", new { });
                Application.Current.Shutdown(97);
            }
        };
        timer.Start();
    }

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            Configure();
            if (args.Length > 0 && args[0].StartsWith("--"))
            {
                string target;
                if (args[0] == "--install-owned" && args.Length == 6)
                {
                    Own(args[1]); Own(args[2]); Own(args[3]); Own(args[4]);
                    args[5] = "1";
                    Event("fixture-install-test-mode", new { testMode = true });
                    if (InstallerFixtureConfig.Scenario == "retry")
                    {
                        string marker = Path.Combine(InstallerFixtureConfig.Scratch, "first-attempt.flag"); Own(marker);
                        if (!File.Exists(marker))
                        {
                            using (var stream = new FileStream(marker, FileMode.CreateNew)) { }
                            string payloadFile = Path.Combine(args[1], InstallOwnership.ExecutableName); Own(payloadFile);
                            File.WriteAllText(payloadFile, "intentional fixture payload corruption");
                            Event("fixture-corruption-injected", new { relativePath = InstallOwnership.ExecutableName });
                        }
                    }
                }
                else if (args[0] == "--integrate" && args.Length == 4)
                {
                    Own(args[1]);
                    if (!InstallOwnership.IsTestInstall(args[1])) throw new InvalidOperationException("Fixture integration skipped only for a proven TEST manifest");
                    Event("fixture-integration-noop", new { testMode = true }); return 0;
                }
                else if ((args[0] == "--validate-install" && args.Length == 3) || ((args[0] == "--check-running" || args[0] == "--is-test" || args[0] == "--uninstall-owned") && args.Length == 2))
                {
                    target = args[1]; Own(target);
                    if (args[0] == "--uninstall-owned" && !InstallOwnership.IsTestInstall(target)) throw new InvalidOperationException("Fixture refuses production uninstall");
                }
                else throw new InvalidOperationException("Unmapped fixture CLI command");
            }
            else
            {
                if (args.Length != 3) throw new InvalidOperationException("GUI fixture requires explicit directory from NSIS");
                Own(args[0]); Own(args[2]);
                if (!String.Equals(Canonical(args[2]), Canonical(InstallerFixtureConfig.Target), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("GUI target differs from fixture configuration");
                if (InstallerFixtureConfig.Scenario == "initialize") args = new[] { args[0], args[1] };
            }
            return ModernInstallerApp.Main(args);
        }
        catch (Exception error)
        {
            try { if (configured) Event("fixture-guard-error", new { exceptionType = error.GetType().Name }); } catch (Exception) { }
            return 95;
        }
    }
}
