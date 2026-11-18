using System;
using System.IO;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;
using Forms = System.Windows.Forms;
using System.Runtime.InteropServices;

namespace AccountManagerEGO.Installer
{
    public sealed class InstallerErrorInfo
    {
        public int schemaVersion { get; set; }
        public string appId { get; set; }
        public string operation { get; set; }
        public string code { get; set; }
        public string relativePath { get; set; }
        public string exceptionType { get; set; }
        public string hresult { get; set; }
    }

    public static class InstallerDiagnostic
    {
        private const string FileName = "installer-error.json";
        private static readonly System.Web.Script.Serialization.JavaScriptSerializer Json = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = 16384 };

        private static string Code(Exception error)
        {
            InstallFailure failure = error as InstallFailure;
            if (failure != null) return failure.Code;
            if (error is UnauthorizedAccessException || error is System.Security.SecurityException) return "access-denied";
            if (error is PathTooLongException) return "path-too-long";
            int native = error.HResult & 0xffff;
            if (error is IOException && (native == 32 || native == 33)) return "file-in-use";
            return error is IOException ? "filesystem-error" : "unexpected-error";
        }

        private static string Message(string code)
        {
            switch (code)
            {
                case "payload-invalid": return "Файл в установщике не прошёл проверку. Скачайте сборку заново.";
                case "temporary-path-too-long": return "Временная папка установщика слишком длинная. Используйте более короткую папку TEMP и повторите запуск.";
                case "path-too-long": return "Путь слишком длинный. Выберите более короткую папку установки.";
                case "file-conflict": return "Файл не принадлежит установке или был изменён. Посторонние данные сохранены. Проверьте указанный файл.";
                case "modified-owned-file": return "Файл прежней установки изменён и сохранён. Проверьте указанный файл перед повторной попыткой.";
                case "file-in-use": return "Файл занят другим процессом. Закройте Квессер и повторите установку; IDE можно оставить открытой.";
                case "access-denied": return "Нет доступа к файлам установки. Проверьте права на выбранную папку.";
                case "recovery-required": return "Установка прервана; материалы восстановления сохранены в выбранной папке. Не удаляйте их до восстановления.";
                case "ui-initialization": return "Не удалось открыть окно установки. Файлы приложения не изменены.";
                case "filesystem-error": return "Не удалось проверить или записать файлы. Проверьте доступность папки и свободное место.";
                case "unexpected-error": return "Установка прервана. Повторите попытку; если ошибка сохранится, сообщите её код.";
                default: return null;
            }
        }

        private static InstallerErrorInfo Read(string directory)
        {
            try
            {
                string file = System.IO.Path.Combine(directory, FileName);
                if (!File.Exists(file) || new FileInfo(file).Length > 16384 || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) return null;
                var info = Json.Deserialize<InstallerErrorInfo>(File.ReadAllText(file, System.Text.Encoding.Unicode));
                if (info == null || info.schemaVersion != 1 || info.appId != InstallOwnership.AppId || Message(info.code) == null
                    || !System.Text.RegularExpressions.Regex.IsMatch(info.hresult ?? "", "^0x[0-9A-F]{8}$")) return null;
                return info;
            }
            catch (Exception) { return null; }
        }

        public static void Clear(string directory)
        {
            if (Read(directory) == null) return;
            try { File.Delete(System.IO.Path.Combine(directory, FileName)); } catch (Exception) { }
        }

        public static void Record(string directory, string operation, Exception error)
        {
            string staging = null;
            try
            {
                if (!Directory.Exists(directory) || (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) return;
                string relative = (error as InstallFailure) == null ? null : ((InstallFailure)error).RelativePath;
                if (!String.IsNullOrEmpty(relative) && !System.Text.RegularExpressions.Regex.IsMatch(relative, @"^[A-Za-z0-9_./ -]{1,220}$")) relative = null;
                var info = new InstallerErrorInfo { schemaVersion = 1, appId = InstallOwnership.AppId, operation = operation,
                    code = Code(error), relativePath = relative, exceptionType = error.GetType().Name,
                    hresult = "0x" + unchecked((uint)error.HResult).ToString("X8") };
                if (Message(info.code) == null) info.code = "unexpected-error";
                string file = System.IO.Path.Combine(directory, FileName);
                if (File.Exists(file) && Read(directory) == null) return;
                staging = System.IO.Path.Combine(directory, ".diag-" + Guid.NewGuid().ToString("N") + ".tmp");
                using (var stream = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, System.Text.Encoding.Unicode)) writer.Write(Json.Serialize(info));
                if (File.Exists(file)) File.Replace(staging, file, null); else File.Move(staging, file);
            }
            catch (Exception) { }
            finally { try { if (staging != null && File.Exists(staging)) File.Delete(staging); } catch (Exception) { } }
        }

        public static string Describe(string directory, string fallback)
        {
            InstallerErrorInfo info = Read(directory);
            if (info == null) return fallback;
            string text = Message(info.code);
            if (!String.IsNullOrEmpty(info.relativePath) && System.Text.RegularExpressions.Regex.IsMatch(info.relativePath, @"^[A-Za-z0-9_./ -]{1,220}$")) text += "\nФайл: " + info.relativePath;
            return text + "\nКод: " + info.code + " (" + info.hresult + ").";
        }
    }

    public class ModernInstallerApp : Application
    {
        internal static Action<InstallerWindow> WindowReady = delegate { };
        internal static Action<string> BeforeExternalLaunch = delegate { };
        public static int CheckRunning(string installDir)
        {
            string root = InstallOwnership.CanonicalRoot(installDir);
            foreach (string name in new[] { "Kvesser", "Egoist", "Account Manager EGO" })
            {
                string target = System.IO.Path.Combine(root, name + ".exe");
                foreach (Process process in Process.GetProcessesByName(name))
                {
                    using (process)
                    {
                        try
                        {
                            if (process.HasExited) continue;
                            if (string.Equals(System.IO.Path.GetFullPath(process.MainModule.FileName), target, StringComparison.OrdinalIgnoreCase)) return 2;
                        }
                        catch (Exception) { return 3; }
                    }
                }
            }
            return 0;
        }

        private static int RunOwnershipCommand(string[] args)
        {
            try
            {
                if (args[0] == "--validate-install" && args.Length == 3)
                { InstallOwnership.ValidateDirectory(args[1], args[2] == "1"); return 0; }
                if (args[0] == "--install-owned" && args.Length == 6)
                { InstallOwnership.Install(args[1], args[2], args[3], args[4], args[5] == "1"); return 0; }
                if (args[0] == "--integrate" && args.Length == 4)
                { InstallOwnership.Integrate(args[1], args[2], args[3] == "1"); return 0; }
                if (args[0] == "--uninstall-owned" && args.Length == 2)
                    return InstallOwnership.Uninstall(args[1]);
                if (args[0] == "--is-test" && args.Length == 2)
                    return InstallOwnership.IsTestInstall(args[1]) ? 10 : 0;
                return 3;
            }
            catch (Exception error)
            {
                if (args[0] == "--install-owned" || args[0] == "--integrate" || args[0] == "--uninstall-owned")
                    InstallerDiagnostic.Record(AppDomain.CurrentDomain.BaseDirectory, args[0], error);
                try { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); } catch (Exception) { }
                return 3;
            }
        }

        [STAThread]
        public static int Main(string[] args)
        {
            if (args.Length == 2 && args[0] == "--check-running")
            {
                try { return CheckRunning(args[1]); }
                catch (Exception) { return 3; }
            }
            if (args.Length > 0 && args[0].StartsWith("--")) return RunOwnershipCommand(args);
            int installerPid;
            if ((args.Length != 2 && args.Length != 3) || !int.TryParse(args[1], out installerPid)) return 1;
            string exchangeDir = args[0];
            try
            {
                ModernInstallerApp app = new ModernInstallerApp();
                app.DispatcherUnhandledException += (sender, error) =>
                {
                    WriteUiError(exchangeDir, error.Exception);
                    error.Handled = true;
                    app.Shutdown(1);
                };
                File.WriteAllText(System.IO.Path.Combine(exchangeDir, "ui_heartbeat.flag"), "1");
                DispatcherTimer heartbeat = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
                InstallerWindow window = new InstallerWindow(exchangeDir, args.Length == 3 ? args[2] : null);
                WindowReady(window);
                Process installerProcess = Process.GetProcessById(installerPid);
                heartbeat.Tick += (sender, error) =>
                {
                    if (installerProcess.HasExited)
                    {
                        heartbeat.Stop();
                        if (!window.IsComplete)
                        {
                            Forms.MessageBox.Show("Установщик завершился до окончания установки. Повторите установку.", "Квессер", Forms.MessageBoxButtons.OK, Forms.MessageBoxIcon.Error);
                            app.Shutdown(1);
                        }
                        return;
                    }
                    File.WriteAllText(System.IO.Path.Combine(exchangeDir, "ui_heartbeat.flag"), "1");
                };
                heartbeat.Start();
                int result = app.Run(window);
                installerProcess.Dispose();
                heartbeat.Stop();
                return result;
            }
            catch (Exception error) { WriteUiError(exchangeDir, error); return 1; }
        }

        private static void WriteUiError(string exchangeDir, Exception error)
        {
            InstallerDiagnostic.Record(exchangeDir, "ui-initialization", new InstallFailure("ui-initialization", "UI initialization failed", null, error));
            try { File.WriteAllText(System.IO.Path.Combine(exchangeDir, "ui_error.flag"), "1"); }
            catch (Exception) { }
        }
    }

    public class ModernToggle : CheckBox
    {
        public ModernToggle(bool initial)
        {
            IsChecked = initial;
            Width = 36; Height = 20; Cursor = Cursors.Hand;
            UseLayoutRounding = true; SnapsToDevicePixels = true;
            var track = new FrameworkElementFactory(typeof(Border));
            track.Name = "track";
            track.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
            track.SetValue(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(24, 24, 27)));
            track.SetValue(Border.BorderBrushProperty, new SolidColorBrush(Color.FromRgb(113, 113, 122)));
            track.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            var thumb = new FrameworkElementFactory(typeof(Border));
            thumb.Name = "thumb";
            thumb.SetValue(Border.WidthProperty, 14.0); thumb.SetValue(Border.HeightProperty, 14.0);
            thumb.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));
            thumb.SetValue(Border.BackgroundProperty, Brushes.White);
            thumb.SetValue(Border.HorizontalAlignmentProperty, HorizontalAlignment.Left);
            thumb.SetValue(Border.VerticalAlignmentProperty, VerticalAlignment.Center);
            thumb.SetValue(Border.MarginProperty, new Thickness(2, 0, 2, 0));
            track.AppendChild(thumb);
            var template = new ControlTemplate(typeof(CheckBox)) { VisualTree = track };
            var selected = new Trigger { Property = IsCheckedProperty, Value = true };
            selected.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(124, 58, 237)), "track"));
            selected.Setters.Add(new Setter(Border.HorizontalAlignmentProperty, HorizontalAlignment.Right, "thumb"));
            template.Triggers.Add(selected);
            var focus = new Trigger { Property = IsKeyboardFocusWithinProperty, Value = true };
            focus.Setters.Add(new Setter(Border.BorderBrushProperty, new SolidColorBrush(Color.FromRgb(192, 132, 252)), "track"));
            focus.Setters.Add(new Setter(Border.BorderThicknessProperty, new Thickness(2), "track"));
            template.Triggers.Add(focus);
            var hover = new Trigger { Property = IsMouseOverProperty, Value = true };
            hover.Setters.Add(new Setter(Border.BorderBrushProperty, Brushes.White, "track"));
            template.Triggers.Add(hover);
            var active = new Trigger { Property = IsPressedProperty, Value = true };
            active.Setters.Add(new Setter(OpacityProperty, 0.8));
            template.Triggers.Add(active);
            var disabled = new Trigger { Property = IsEnabledProperty, Value = false };
            disabled.Setters.Add(new Setter(OpacityProperty, 0.5));
            template.Triggers.Add(disabled);
            Template = template;
        }
    }

    public class InstallerWindow : Window
    {
        public bool IsComplete { get; private set; }
        private string _exchangeDir;
        private Grid _mainContainer;
        private Grid _configView;
        private Grid _progressView;
        private Grid _completeView;

        private TextBox _txtInstallDir;
        private TextBlock _configError;
        private readonly string _initialDirectory;
        private ModernToggle _toggleRunAfter;
        private ModernToggle _toggleDesktopShortcut;

        private TextBlock _lblStatus;
        private Button _finishButton;
        private TextBlock _lblPercent;
        private Border _progressBarTrack;
        private Border _progressBarFill;
        private LinearGradientBrush _shimmerBrush;
        private DispatcherTimer _pollTimer;
        private DispatcherTimer _shimmerTimer;
        private double _shimmerOffset = 0.0;
        private double _currentProgress = 0.0;
        private double _targetProgress = 0.0;
        private string _chosenDir;
        private bool _runAfter = true;
        private bool _desktopShortcut = true;
        private bool _isInstalling;

        [System.Runtime.InteropServices.DllImport("gdi32.dll", SetLastError = true)]
        private static extern int AddFontResourceEx(string lpszFilename, uint fl, IntPtr pdv);
        private const uint FR_PRIVATE = 0x10;

        public InstallerWindow(string exchangeDir) : this(exchangeDir, null) { }

        public InstallerWindow(string exchangeDir, string initialDirectory)
        {
            _exchangeDir = exchangeDir;
            _initialDirectory = initialDirectory;
            Title = "Квессер — установка";
            Width = 540;
            Height = 360;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;

            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
            TextOptions.SetTextRenderingMode(this, TextRenderingMode.ClearType);
            TextOptions.SetTextHintingMode(this, TextHintingMode.Fixed);
            RenderOptions.SetClearTypeHint(this, ClearTypeHint.Enabled);
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;

            try
            {
                string fontFile = System.IO.Path.Combine(_exchangeDir, "Unbounded.ttf");
                if (!System.IO.File.Exists(fontFile))
                {
                    fontFile = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Unbounded.ttf");
                }
                if (System.IO.File.Exists(fontFile))
                {
                    try { AddFontResourceEx(fontFile, FR_PRIVATE, IntPtr.Zero); } catch { }
                    string fontDir = System.IO.Path.GetDirectoryName(fontFile).Replace('\\', '/');
                    if (!fontDir.EndsWith("/")) fontDir += "/";
                    FontFamily = new FontFamily(new Uri("file:///" + fontDir), "./#Unbounded, Unbounded, Segoe UI, sans-serif");
                }
                else
                {
                    FontFamily = new FontFamily("Unbounded, Segoe UI, sans-serif");
                }
            }
            catch
            {
                FontFamily = new FontFamily("Segoe UI, sans-serif");
            }

            var logo = GetBrandLogoSource();
            if (logo != null) Icon = logo;

            BuildUI();
        }

        private void BuildUI()
        {
            Border outerBorder = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(5, 5, 7)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Margin = new Thickness(4)
            };

            outerBorder.Effect = new DropShadowEffect
            {
                Color = Color.FromRgb(0, 0, 0),
                BlurRadius = 20,
                ShadowDepth = 0,
                Opacity = 0.90
            };

            Grid rootGrid = new Grid();
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(36) });
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            // Title Bar
            Border titleBar = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(5, 5, 7)),
                CornerRadius = new CornerRadius(10, 10, 0, 0),
                BorderBrush = new SolidColorBrush(Color.FromRgb(31, 31, 35)),
                BorderThickness = new Thickness(0, 0, 0, 1)
            };
            titleBar.MouseLeftButtonDown += (s, e) => { if (e.ButtonState == MouseButtonState.Pressed) DragMove(); };

            Grid titleGrid = new Grid { Margin = new Thickness(14, 0, 10, 0) };
            StackPanel brandPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            // Brand icon
            UIElement logoBorder = CreateBrandImage(20, new Thickness(0, 0, 9, 0));

            TextBlock brandText = new TextBlock
            {
                Text = "Квессер",
                Foreground = Brushes.White,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center
            };

            Border badge = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(24, 24, 27)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(5, 1, 5, 1),
                Margin = new Thickness(7, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            badge.Child = new TextBlock
            {
                Text = "3.2 RC",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 10,
                FontWeight = FontWeights.Medium
            };

            brandPanel.Children.Add(logoBorder);
            brandPanel.Children.Add(brandText);
            brandPanel.Children.Add(badge);

            StackPanel controlsPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center
            };

            Button btnMin = CreateWinButton("-", 12);
            btnMin.Click += (s, e) => WindowState = WindowState.Minimized;

            Button btnClose = CreateWinButton("✕", 11);
            btnClose.Click += (s, e) => CloseInstaller();

            controlsPanel.Children.Add(btnMin);
            controlsPanel.Children.Add(btnClose);

            titleGrid.Children.Add(brandPanel);
            titleGrid.Children.Add(controlsPanel);
            titleBar.Child = titleGrid;
            Grid.SetRow(titleBar, 0);
            rootGrid.Children.Add(titleBar);

            // Body Container
            _mainContainer = new Grid { Margin = new Thickness(24, 14, 24, 18) };
            Grid.SetRow(_mainContainer, 1);
            rootGrid.Children.Add(_mainContainer);

            outerBorder.Child = rootGrid;
            Content = outerBorder;

            CreateConfigView();
            CreateProgressView();
            CreateCompleteView();

            ShowConfigView();
        }

        private Button CreateWinButton(string text, double fontSize)
        {
            Button btn = new Button
            {
                Content = text,
                Width = 24,
                Height = 24,
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                FontSize = fontSize,
                FontWeight = FontWeights.Bold,
                Cursor = Cursors.Hand
            };
            btn.MouseEnter += (s, e) => { btn.Background = new SolidColorBrush(Color.FromRgb(24, 24, 27)); btn.Foreground = Brushes.White; };
            btn.MouseLeave += (s, e) => { btn.Background = Brushes.Transparent; btn.Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)); };
            return btn;
        }

        private Button CreateActionButton(string text, bool isPrimary)
        {
            Button btn = new Button
            {
                Content = text,
                Height = 38,
                Cursor = Cursors.Hand,
                BorderThickness = new Thickness(0),
            };

            Style style = new Style(typeof(Button));
            ControlTemplate template = new ControlTemplate(typeof(Button));
            FrameworkElementFactory borderFactory = new FrameworkElementFactory(typeof(Border));
            borderFactory.Name = "border";
            borderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));

            if (isPrimary)
            {
                borderFactory.SetValue(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(255, 255, 255)));
            }
            else
            {
                borderFactory.SetValue(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(39, 39, 42)));
            }

            FrameworkElementFactory contentFactory = new FrameworkElementFactory(typeof(ContentPresenter));
            contentFactory.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            contentFactory.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            contentFactory.SetValue(TextBlock.FontSizeProperty, 13.5);
            contentFactory.SetValue(TextBlock.FontWeightProperty, FontWeights.Bold);

            if (isPrimary)
            {
                contentFactory.SetValue(TextBlock.ForegroundProperty, new SolidColorBrush(Color.FromRgb(0, 0, 0)));
            }
            else
            {
                contentFactory.SetValue(TextBlock.ForegroundProperty, new SolidColorBrush(Color.FromRgb(255, 255, 255)));
            }

            borderFactory.AppendChild(contentFactory);
            template.VisualTree = borderFactory;

            Trigger hoverTrigger = new Trigger { Property = Button.IsMouseOverProperty, Value = true };
            if (isPrimary)
            {
                hoverTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(228, 228, 231)), "border"));
            }
            else
            {
                hoverTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(63, 63, 70)), "border"));
            }
            template.Triggers.Add(hoverTrigger);

            Trigger pressedTrigger = new Trigger { Property = Button.IsPressedProperty, Value = true };
            if (isPrimary)
            {
                pressedTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(212, 212, 216)), "border"));
            }
            else
            {
                pressedTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(24, 24, 27)), "border"));
            }
            template.Triggers.Add(pressedTrigger);

            Trigger focusTrigger = new Trigger { Property = Button.IsKeyboardFocusedProperty, Value = true };
            focusTrigger.Setters.Add(new Setter(Border.BorderBrushProperty, new SolidColorBrush(Color.FromRgb(255, 255, 255)), "border"));
            focusTrigger.Setters.Add(new Setter(Border.BorderThicknessProperty, new Thickness(1.5), "border"));
            template.Triggers.Add(focusTrigger);

            Trigger disabledTrigger = new Trigger { Property = Button.IsEnabledProperty, Value = false };
            disabledTrigger.Setters.Add(new Setter(UIElement.OpacityProperty, 0.45));
            template.Triggers.Add(disabledTrigger);

            style.Setters.Add(new Setter(Button.TemplateProperty, template));
            btn.Style = style;
            return btn;
        }

        private void CreateConfigView()
        {
            _configView = new Grid();
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // Hero Header
            StackPanel heroPanel = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
            heroPanel.Children.Add(new TextBlock
            {
                Text = "Установка Квессер",
                Foreground = Brushes.White,
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 0, 0, 4)
            });
            heroPanel.Children.Add(new TextBlock
            {
                Text = "Автономное управление мультиаккаунтами и квотами AI",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 11.5
            });
            Grid.SetRow(heroPanel, 0);
            _configView.Children.Add(heroPanel);

            // Path Selection Card
            Border pathCard = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(18, 18, 20)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(7),
                Padding = new Thickness(12, 8, 12, 8),
                Margin = new Thickness(0, 0, 0, 10)
            };

            StackPanel pathStack = new StackPanel();
            pathStack.Children.Add(new TextBlock
            {
                Text = "Папка установки",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 11,
                FontWeight = FontWeights.Medium,
                Margin = new Thickness(0, 0, 0, 4)
            });

            Grid pathRow = new Grid();
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            string defaultDir = String.IsNullOrWhiteSpace(_initialDirectory) ? InstallOwnership.DefaultDirectory() : _initialDirectory;
            _txtInstallDir = new TextBox
            {
                Text = defaultDir,
                Background = new SolidColorBrush(Color.FromRgb(24, 24, 27)),
                Foreground = Brushes.White,
                BorderBrush = new SolidColorBrush(Color.FromRgb(63, 63, 70)),
                BorderThickness = new Thickness(1),
                Height = 30,
                Padding = new Thickness(8, 4, 8, 4),
                FontSize = 11.5,
                FontWeight = FontWeights.Normal,
                VerticalContentAlignment = VerticalAlignment.Center
            };
            Grid.SetColumn(_txtInstallDir, 0);
            pathRow.Children.Add(_txtInstallDir);

            Button btnBrowse = new Button
            {
                Content = "Обзор…",
                Width = 76,
                Height = 30,
                Background = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                Foreground = Brushes.White,
                BorderBrush = new SolidColorBrush(Color.FromRgb(63, 63, 70)),
                BorderThickness = new Thickness(1),
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Cursor = Cursors.Hand
            };
            btnBrowse.Click += (s, e) =>
            {
                var dialog = new Forms.FolderBrowserDialog
                {
                    Description = "Выберите папку для установки Квессер",
                    SelectedPath = _txtInstallDir.Text
                };
                if (dialog.ShowDialog() == Forms.DialogResult.OK)
                {
                    string path = dialog.SelectedPath;
                    if (!path.EndsWith("Kvesser", StringComparison.OrdinalIgnoreCase))
                    {
                        path = System.IO.Path.Combine(path, "Kvesser");
                    }
                    _txtInstallDir.Text = path;
                }
            };
            Grid.SetColumn(btnBrowse, 2);
            pathRow.Children.Add(btnBrowse);

            pathStack.Children.Add(pathRow);
            pathCard.Child = pathStack;
            Grid.SetRow(pathCard, 1);
            _configView.Children.Add(pathCard);

            // Options Card (Compact Side-by-Side)
            Border optionsCard = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(18, 18, 20)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(7),
                Padding = new Thickness(12, 8, 12, 8),
                Margin = new Thickness(0, 0, 0, 14)
            };

            Grid optionsGrid = new Grid();
            optionsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            optionsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.3, GridUnitType.Star) });

            // Toggle 1: Run after install
            StackPanel opt1 = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            _toggleRunAfter = new ModernToggle(true);
            System.Windows.Automation.AutomationProperties.SetName(_toggleRunAfter, "Запустить Квессер после установки");
            opt1.Children.Add(_toggleRunAfter);
            opt1.Children.Add(new TextBlock
            {
                Text = "Запустить сразу",
                Foreground = new SolidColorBrush(Color.FromRgb(212, 212, 216)),
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 0, 0)
            });
            Grid.SetColumn(opt1, 0);
            optionsGrid.Children.Add(opt1);

            // Toggle 2: Desktop shortcut
            StackPanel opt2 = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            _toggleDesktopShortcut = new ModernToggle(true);
            System.Windows.Automation.AutomationProperties.SetName(_toggleDesktopShortcut, "Создать ярлык на рабочем столе");
            opt2.Children.Add(_toggleDesktopShortcut);
            opt2.Children.Add(new TextBlock
            {
                Text = "Ярлык на рабочем столе",
                Foreground = new SolidColorBrush(Color.FromRgb(212, 212, 216)),
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 0, 0)
            });
            Grid.SetColumn(opt2, 1);
            optionsGrid.Children.Add(opt2);

            optionsCard.Child = optionsGrid;
            Grid.SetRow(optionsCard, 2);
            _configView.Children.Add(optionsCard);

            // Install Button
            Button btnInstall = CreateActionButton("Установить Квессер", true);
            btnInstall.Height = 40;
            btnInstall.Click += (s, e) => StartInstallation();
            Grid.SetRow(btnInstall, 3);
            _configView.Children.Add(btnInstall);
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _configError = new TextBlock { Foreground = new SolidColorBrush(Color.FromRgb(248, 113, 113)), FontFamily = new FontFamily("Segoe UI"),
                FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 10, 0, 0), Visibility = Visibility.Collapsed };
            Grid.SetRow(_configError, 4);
            _configView.Children.Add(_configError);
        }

        private void CreateProgressView()
        {
            _progressView = new Grid();
            _progressView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            _progressView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _progressView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            StackPanel centerStack = new StackPanel
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };

            UIElement emblemBorder = CreateBrandImage(70, new Thickness(0, 0, 0, 16));
            centerStack.Children.Add(emblemBorder);

            centerStack.Children.Add(new TextBlock
            {
                Text = "Установка компонентов...",
                Foreground = Brushes.White,
                FontSize = 17,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 4)
            });

            _lblStatus = new TextBlock
            {
                Text = "Подготовка к распаковке...",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 12,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 16)
            };
            centerStack.Children.Add(_lblStatus);

            // Shimmering Progress Bar
            Grid progressGrid = new Grid
            {
                Width = 420,
                HorizontalAlignment = HorizontalAlignment.Center
            };

            _progressBarTrack = new Border
            {
                Height = 7,
                Background = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                CornerRadius = new CornerRadius(3.5)
            };

            _shimmerBrush = new LinearGradientBrush
            {
                StartPoint = new Point(0, 0.5),
                EndPoint = new Point(1, 0.5)
            };
            _shimmerBrush.GradientStops.Add(new GradientStop(Color.FromRgb(109, 40, 217), 0.0));
            _shimmerBrush.GradientStops.Add(new GradientStop(Color.FromRgb(255, 255, 255), 0.5));
            _shimmerBrush.GradientStops.Add(new GradientStop(Color.FromRgb(109, 40, 217), 1.0));

            _progressBarFill = new Border
            {
                Height = 7,
                Width = 0,
                Background = _shimmerBrush,
                CornerRadius = new CornerRadius(3.5),
                HorizontalAlignment = HorizontalAlignment.Left
            };

            _progressBarTrack.Child = _progressBarFill;
            progressGrid.Children.Add(_progressBarTrack);
            centerStack.Children.Add(progressGrid);

            _lblPercent = new TextBlock
            {
                Text = "0%",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 8, 0, 0)
            };
            centerStack.Children.Add(_lblPercent);

            Grid.SetRow(centerStack, 1);
            _progressView.Children.Add(centerStack);
        }

        private void CreateCompleteView()
        {
            _completeView = new Grid();
            _completeView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            _completeView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _completeView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            StackPanel centerStack = new StackPanel
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };

            UIElement emblem = CreateBrandImage(64, new Thickness(0, 0, 0, 14));
            centerStack.Children.Add(emblem);

            centerStack.Children.Add(new TextBlock
            {
                Text = "Установка завершена",
                Foreground = Brushes.White,
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 4)
            });

            centerStack.Children.Add(new TextBlock
            {
                Text = "Квессер готов к работе",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 12,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 18)
            });

            Button btnFinish = CreateActionButton("Запустить", true);
            btnFinish.Width = 200;
            btnFinish.Height = 42;
            btnFinish.Click += (s, e) => FinishAndLaunch();
            _finishButton = btnFinish;
            centerStack.Children.Add(btnFinish);

            Grid.SetRow(centerStack, 1);
            _completeView.Children.Add(centerStack);
        }

        private void ShowConfigView()
        {
            _mainContainer.Children.Clear();
            _mainContainer.Children.Add(_configView);
        }

        private void ShowProgressView()
        {
            _mainContainer.Children.Clear();
            _mainContainer.Children.Add(_progressView);

            bool animate = SystemParameters.ClientAreaAnimation;
            _shimmerTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(animate ? 16 : 200) };
            _shimmerTimer.Tick += (s, e) =>
            {
                if (animate)
                {
                    _shimmerOffset += 0.015;
                    if (_shimmerOffset > 1.4) _shimmerOffset = -0.4;
                    _shimmerBrush.StartPoint = new Point(_shimmerOffset - 0.35, 0.5);
                    _shimmerBrush.EndPoint = new Point(_shimmerOffset + 0.35, 0.5);
                    _currentProgress += (_targetProgress - _currentProgress) * 0.08;
                }
                else _currentProgress = _targetProgress;
                UpdateProgressBar(_currentProgress);
            };
            _shimmerTimer.Start();
        }

        private void ShowCompleteView()
        {
            IsComplete = true;
            _finishButton.Content = _runAfter ? "Запустить" : "Готово";
            if (_shimmerTimer != null) _shimmerTimer.Stop();
            if (_pollTimer != null) _pollTimer.Stop();
            _mainContainer.Children.Clear();
            _mainContainer.Children.Add(_completeView);
        }

        private void StartInstallation()
        {
            _chosenDir = _txtInstallDir.Text.Trim();
            if (string.IsNullOrEmpty(_chosenDir))
            {
                Forms.MessageBox.Show("Пожалуйста, укажите папку для установки.", "Квессер", Forms.MessageBoxButtons.OK, Forms.MessageBoxIcon.Warning);
                return;
            }

            _runAfter = _toggleRunAfter.IsChecked == true;
            _desktopShortcut = _toggleDesktopShortcut.IsChecked == true;

            try
            {
                _chosenDir = InstallOwnership.CanonicalRoot(_chosenDir);
                InstallOwnership.ValidateDirectory(_chosenDir, false);
                if (ModernInstallerApp.CheckRunning(_chosenDir) != 0)
                {
                    Forms.MessageBox.Show("Закройте Квессер перед установкой. Codex можно оставить открытым.", "Квессер", Forms.MessageBoxButtons.OK, Forms.MessageBoxIcon.Warning);
                    return;
                }
            }
            catch (Exception ex)
            {
                Forms.MessageBox.Show("Не удалось проверить папку установки: " + ex.Message, "Квессер", Forms.MessageBoxButtons.OK, Forms.MessageBoxIcon.Error);
                return;
            }

            try
            {
                Directory.CreateDirectory(_exchangeDir);
                InstallerDiagnostic.Clear(_exchangeDir);
                string oldStatus = System.IO.Path.Combine(_exchangeDir, "status.txt");
                if (File.Exists(oldStatus)) File.Delete(oldStatus);
                var exchangeEncoding = System.Text.Encoding.Unicode;
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "install_dir.txt"), _chosenDir, exchangeEncoding);
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "desktop_shortcut.txt"), _desktopShortcut ? "1" : "0", exchangeEncoding);
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "run_after.txt"), _runAfter ? "1" : "0", exchangeEncoding);
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "start_install.flag"), DateTime.UtcNow.Ticks.ToString(), exchangeEncoding);
            }
            catch (Exception ex)
            {
                Forms.MessageBox.Show("Ошибка записи параметров: " + ex.Message, "Квессер", Forms.MessageBoxButtons.OK, Forms.MessageBoxIcon.Error);
                return;
            }

            _configError.Visibility = Visibility.Collapsed;
            Height = 360;
            _targetProgress = 0;
            _currentProgress = 0;
            _lblStatus.Text = "Подготовка и проверка файлов…";
            _isInstalling = true;
            ShowProgressView();

            string statusPath = System.IO.Path.Combine(_exchangeDir, "status.txt");
            _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
            _pollTimer.Tick += (s, e) =>
            {
                try
                {
                    if (File.Exists(statusPath))
                    {
                        string line = File.ReadAllText(statusPath).Trim();
                        if (!string.IsNullOrEmpty(line))
                        {
                            string[] parts = line.Split(new char[] { '|' }, 2);
                            if (parts.Length == 2)
                            {
                                double pct;
                                if (double.TryParse(parts[0], out pct))
                                {
                                    _targetProgress = pct;
                                }
                                string msg = parts[1];
                                if (msg.StartsWith("ERROR:"))
                                {
                                    _pollTimer.Stop();
                                    if (_shimmerTimer != null) _shimmerTimer.Stop();
                                    _isInstalling = false;
                                    _configError.Text = InstallerDiagnostic.Describe(_exchangeDir, msg.Substring(6));
                                    _configError.Visibility = Visibility.Visible;
                                    Height = 450;
                                    ShowConfigView();
                                    _txtInstallDir.Focus();
                                    return;
                                }
                                if (msg == "DONE")
                                {
                                    _targetProgress = 100.0;
                                    _currentProgress = 100.0;
                                    UpdateProgressBar(100.0);
                                    _pollTimer.Stop();
                                    DispatcherTimer delay = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
                                    delay.Tick += (ds, de) => { delay.Stop(); ShowCompleteView(); };
                                    delay.Start();
                                    return;
                                }
                                _lblStatus.Text = msg;
                            }
                        }
                    }
                }
                catch { }
            };
            _pollTimer.Start();
        }

        private void UpdateProgressBar(double percent)
        {
            double trackWidth = _progressBarTrack.ActualWidth;
            if (trackWidth <= 0) trackWidth = 330;
            _progressBarFill.Width = Math.Max(0, (percent / 100.0) * trackWidth);
            _lblPercent.Text = string.Format("{0}%", (int)percent);
        }

        private void FinishAndLaunch()
        {
            try
            {
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "finished.flag"), "1");
            }
            catch { }

            if (_runAfter && !string.IsNullOrEmpty(_chosenDir))
            {
                string exePath = System.IO.Path.Combine(_chosenDir, "Kvesser.exe");
                if (File.Exists(exePath))
                {
                    try
                    {
                        ModernInstallerApp.BeforeExternalLaunch(_chosenDir);
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exePath,
                            UseShellExecute = true
                        });
                    }
                    catch (Exception ex)
                    {
                        Forms.MessageBox.Show("Не удалось запустить приложение: " + ex.Message, "Квессер", Forms.MessageBoxButtons.OK, Forms.MessageBoxIcon.Error);
                    }
                }
            }

            Close();
        }

        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            if (_isInstalling && !IsComplete) e.Cancel = true;
            base.OnClosing(e);
        }

        private void CloseInstaller()
        {
            if (_isInstalling && !IsComplete)
            {
                Forms.MessageBox.Show("Дождитесь окончания установки. Проверка и запись файлов продолжаются.", "Квессер", Forms.MessageBoxButtons.OK, Forms.MessageBoxIcon.Information);
                return;
            }
            try
            {
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "cancel.flag"), "1");
            }
            catch { }
            Close();
        }
        private static ImageSource _cachedBrandLogo;
        private static ImageSource GetBrandLogoSource()
        {
            if (_cachedBrandLogo != null) return _cachedBrandLogo;
            try
            {
                using (var stream = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("EgoistBrand.png"))
                {
                    if (stream != null)
                    {
                        var image = new System.Windows.Media.Imaging.BitmapImage();
                        image.BeginInit(); image.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                        image.StreamSource = stream; image.EndInit(); image.Freeze();
                        _cachedBrandLogo = image;
                        return image;
                    }
                }
                using (var icon = System.Drawing.Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location))
                {
                    if (icon == null) return null;
                    var bitmap = System.Windows.Interop.Imaging.CreateBitmapSourceFromHIcon(icon.Handle, Int32Rect.Empty, System.Windows.Media.Imaging.BitmapSizeOptions.FromEmptyOptions());
                    bitmap.Freeze();
                    _cachedBrandLogo = bitmap;
                    return _cachedBrandLogo;
                }
            }
            catch
            {
                return null;
            }
        }

        private static Image CreateBrandImage(double size, Thickness margin)
        {
            var img = new Image
            {
                Width = size,
                Height = size,
                Source = GetBrandLogoSource(),
                Margin = margin,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                UseLayoutRounding = true,
                SnapsToDevicePixels = true
            };
            RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.Fant);
            return img;
        }

    }
}
