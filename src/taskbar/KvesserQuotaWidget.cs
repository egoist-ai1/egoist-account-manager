using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal sealed class KvesserQuotaWidget : ApplicationContext
{
    private const string WidgetClass = "KvesserQuotaWidget";
    private const string NoData = "\u2014";
    private const int GroupWidth = 62;
    private const int GroupHeight = 32;
    private const int GroupGap = 2;
    private const int WidgetWidth = GroupWidth * 2 + GroupGap;
    private const int WsChild = 0x40000000;
    private const int WsClipSiblings = 0x04000000;
    private const int WsExLayered = 0x00080000;
    private const int WsExNoActivate = 0x08000000;
    private const int SwpNoActivate = 0x0010;
    private const int SwpShowWindow = 0x0040;
    private const int WmMouseActivate = 0x0021;
    private const int WmMouseMove = 0x0200;
    private const int WmLeftButtonUp = 0x0202;
    private const int WmRightButtonUp = 0x0205;
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private readonly StreamWriter output;
    private readonly WindowProcedure windowProcedure;
    private readonly IntPtr module = GetModuleHandle(null);
    private readonly System.Windows.Forms.Timer timer;
    private IntPtr window;
    private IntPtr parent;
    private Rectangle bounds;
    private uint lastDpi;
    private int hover = -1;
    private bool visible;
    private bool? available;
    private Quotas drawn;
    private volatile Quotas quotas;
    private volatile bool inputClosed;
    private volatile bool outputClosed;

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 0) return Preview(args);
        using (var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" })
        {
            try
            {
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
                using (var app = new KvesserQuotaWidget(output))
                {
                    Application.Run(app);
                }
                return 0;
            }
            catch
            {
                try { output.WriteLine("unavailable"); }
                catch (IOException) { }
                return 1;
            }
        }
    }

    private static int Preview(string[] args)
    {
        uint dpi;
        if (args.Length != 6 || args[0] != "--preview" || !Path.IsPathRooted(args[1]) ||
            !string.Equals(Path.GetFullPath(args[1]), args[1], StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetExtension(args[1]), ".png", StringComparison.OrdinalIgnoreCase) ||
            !uint.TryParse(args[2], NumberStyles.None, Invariant, out dpi) || dpi < 72 || dpi > 480)
            return 2;
        Quotas sample = ParseState(args[3], args[4], args[5]);
        if (sample == null) return 2;
        try
        {
            using (Bitmap image = Render(sample, dpi, -1))
            using (FileStream file = new FileStream(args[1], FileMode.CreateNew, FileAccess.Write, FileShare.None))
                image.Save(file, ImageFormat.Png);
            return 0;
        }
        catch (Exception error)
        {
            if (error is IOException || error is UnauthorizedAccessException || error is ExternalException) return 1;
            throw;
        }
    }

    private KvesserQuotaWidget(StreamWriter output)
    {
        this.output = output;
        windowProcedure = ProcessWindowMessage;
        var windowClass = new WindowClass
        {
            Size = (uint)Marshal.SizeOf(typeof(WindowClass)),
            Procedure = windowProcedure,
            Instance = module,
            Cursor = LoadCursor(IntPtr.Zero, (IntPtr)32512),
            ClassName = WidgetClass
        };
        if (RegisterClassEx(ref windowClass) == 0) throw new InvalidOperationException();
        timer = new System.Windows.Forms.Timer { Interval = 100 };
        timer.Tick += CheckPlacement;
        timer.Start();
        new Thread(ReadInput) { IsBackground = true, Name = "Quota widget input" }.Start();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose();
            DestroyWidget();
        }
        base.Dispose(disposing);
    }

    private void ReadInput()
    {
        try
        {
            using (var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false, true)))
            {
                string line;
                while ((line = input.ReadLine()) != null)
                {
                    if (line.Length > 32) continue;
                    string[] parts = line.Split('\t');
                    if (parts.Length != 4 || parts[0] != "state") continue;
                    Quotas next = ParseState(parts[1], parts[2], parts[3]);
                    if (next != null) quotas = next;
                }
            }
        }
        catch (IOException) { }
        catch (DecoderFallbackException) { }
        finally { inputClosed = true; }
    }

    private void WriteEvent(string message)
    {
        if (outputClosed) return;
        try { output.WriteLine(message); }
        catch (IOException) { outputClosed = true; }
    }

    private void ReportAvailability(bool next)
    {
        if (available == next) return;
        available = next;
        WriteEvent(next ? "ready" : "unavailable");
    }

    private void CheckPlacement(object sender, EventArgs args)
    {
        if (inputClosed || outputClosed)
        {
            ExitThread();
            return;
        }
        Quotas state = quotas;
        if (state == null) return;

        IntPtr taskbar = FindWindow("Shell_TrayWnd", null);
        if (window != IntPtr.Zero && (taskbar != parent || !IsWindow(window))) DestroyWidget();

        uint dpi;
        Rectangle area;
        Placement placement = Locate(taskbar, out dpi, out area);
        if (placement == Placement.Unavailable)
        {
            HideWidget();
            ReportAvailability(false);
            return;
        }
        if (window == IntPtr.Zero)
        {
            window = CreateWindowEx(WsExLayered | WsExNoActivate, WidgetClass, "", WsChild | WsClipSiblings,
                0, 0, 1, 1, taskbar, IntPtr.Zero, module, IntPtr.Zero);
            if (window == IntPtr.Zero)
            {
                ReportAvailability(false);
                return;
            }
            parent = taskbar;
        }

        bool moved = bounds != area || lastDpi != dpi;
        if (placement == Placement.Hidden)
        {
            HideWidget();
            if (moved && !MoveWidget(area, false))
            {
                ReportAvailability(false);
                return;
            }
            bounds = area;
            lastDpi = dpi;
            ReportAvailability(true);
            return;
        }
        if (moved)
        {
            SetHover(-1);
            bounds = area;
            lastDpi = dpi;
        }
        int nextHover = HoverGroup();
        if (!visible || moved || nextHover != hover || !state.Matches(drawn))
        {
            using (Bitmap bitmap = Render(state, dpi, nextHover))
            {
                if (!UpdatePixels(window, bitmap))
                {
                    HideWidget();
                    ReportAvailability(false);
                    return;
                }
            }

            if (!MoveWidget(area, true))
            {
                HideWidget();
                ReportAvailability(false);
                return;
            }
            visible = true;
            drawn = state;
        }
        ReportAvailability(true);
        SetHover(nextHover);
    }

    private bool MoveWidget(Rectangle area, bool reveal)
    {
        Point position = new Point(area.Left, area.Top);
        Rectangle actual;
        return ScreenToClient(parent, ref position) &&
            SetWindowPos(window, IntPtr.Zero, position.X, position.Y, area.Width, area.Height,
                SwpNoActivate | (reveal ? SwpShowWindow : 0)) &&
            ReadBounds(window, out actual) && actual == area;
    }

    private void HideWidget()
    {
        SetHover(-1);
        if (visible && IsWindow(window)) ShowWindow(window, 0);
        visible = false;
    }

    private void DestroyWidget()
    {
        HideWidget();
        if (window != IntPtr.Zero && IsWindow(window)) DestroyWindow(window);
        window = IntPtr.Zero;
        parent = IntPtr.Zero;
        bounds = Rectangle.Empty;
        drawn = null;
    }

    private int HoverGroup()
    {
        Point cursor;
        if (!GetCursorPos(out cursor) || !bounds.Contains(cursor)) return -1;
        if (GetAncestor(WindowFromPoint(cursor), 2) != parent) return -1;
        int x = cursor.X - bounds.Left;
        if (x < Px(GroupWidth, lastDpi)) return 0;
        return x >= Px(GroupWidth + GroupGap, lastDpi) ? 1 : -1;
    }

    private void SetHover(int next)
    {
        if (hover == next) return;
        hover = next;
        if (hover < 0) WriteEvent("leave");
        else WriteGroupEvent("enter", hover);
    }

    private void WriteGroupEvent(string kind, int group)
    {
        float center = GroupWidth / 2f + group * (GroupWidth + GroupGap);
        WriteEvent(string.Format(Invariant, "{0}\t{1}\t{2}\t{3}", kind, group == 0 ? "codex" : "antigravity",
            bounds.Left + Px(center, lastDpi), bounds.Top + bounds.Height / 2));
    }

    private IntPtr ProcessWindowMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == WmMouseActivate) return (IntPtr)3; // MA_NOACTIVATE
        if (message == WmMouseMove) return IntPtr.Zero;
        if (message == WmLeftButtonUp || message == WmRightButtonUp)
        {
            int group = HoverGroup();
            if (visible && group >= 0) WriteGroupEvent(message == WmLeftButtonUp ? "click" : "context", group);
            return IntPtr.Zero;
        }
        return DefWindowProc(handle, message, wParam, lParam);
    }

    private enum Placement { Unavailable, Hidden, Found }

    private Placement Locate(IntPtr taskbar, out uint dpi, out Rectangle area)
    {
        dpi = 96;
        area = Rectangle.Empty;
        if (taskbar == IntPtr.Zero) return Placement.Unavailable;
        IntPtr tray = FindWindowEx(taskbar, IntPtr.Zero, "TrayNotifyWnd", null);
        Rectangle bar, notification;
        if (!ReadBounds(taskbar, out bar) || !ReadBounds(tray, out notification) || bar.Width <= bar.Height)
            return Placement.Unavailable;
        var monitor = new MonitorInfo { Size = (uint)Marshal.SizeOf(typeof(MonitorInfo)) };
        if (!GetMonitorInfo(MonitorFromWindow(taskbar, 2), ref monitor)) return Placement.Unavailable;
        Rectangle monitorBounds = monitor.Monitor.Rectangle;
        Rectangle onScreen = Rectangle.Intersect(bar, monitorBounds);
        bool hidden = onScreen.Height < bar.Height - 3 || !IsWindowVisible(taskbar) || !IsWindowVisible(tray) ||
            FullScreen(taskbar, monitorBounds);

        dpi = GetDpiForWindow(taskbar);
        if (dpi == 0) return Placement.Unavailable;
        int height = Px(GroupHeight, dpi);
        if (bar.Height < height) return Placement.Unavailable;

        int right = notification.Left;
        for (IntPtr child = GetWindow(taskbar, 5); child != IntPtr.Zero; child = GetWindow(child, 2))
        {
            Rectangle battery;
            if (ClassOf(child) == "WirelessBatteryWidget" && IsWindowVisible(child) && ReadBounds(child, out battery) &&
                battery.Right <= notification.Left && battery.Left >= bar.Left && battery.IntersectsWith(bar))
                right = Math.Min(right, battery.Left);
        }
        right -= Px(3, dpi);
        area = new Rectangle(right - Px(WidgetWidth, dpi), bar.Top + (bar.Height - height) / 2, Px(WidgetWidth, dpi), height);
        if (!bar.Contains(area) || area.Left < monitorBounds.Left || area.Right > monitorBounds.Right) return Placement.Unavailable;

        // Любой видимый сосед резервирует свою область. Никому не меняем размер или позицию.
        for (IntPtr child = GetWindow(taskbar, 5); child != IntPtr.Zero; child = GetWindow(child, 2))
        {
            Rectangle neighbor;
            if (child != window && IsWindowVisible(child) && ReadBounds(child, out neighbor)
                && area.IntersectsWith(neighbor))
                return Placement.Unavailable;
        }
        return hidden ? Placement.Hidden : Placement.Found;
    }

    private static bool FullScreen(IntPtr taskbar, Rectangle monitor)
    {
        IntPtr foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero || foreground == taskbar || IsZoomed(foreground)) return false;
        NativeRect frame;
        if (DwmGetWindowAttribute(foreground, 9, out frame, Marshal.SizeOf(typeof(NativeRect))) != 0 &&
            !GetWindowRect(foreground, out frame))
            return false;
        if (ClassOf(foreground) == "Progman" || ClassOf(foreground) == "WorkerW") return false;
        return frame.Left <= monitor.Left && frame.Top <= monitor.Top &&
            frame.Right >= monitor.Right && frame.Bottom >= monitor.Bottom;
    }

    private static bool ReadBounds(IntPtr handle, out Rectangle rect)
    {
        NativeRect result;
        bool read = GetWindowRect(handle, out result);
        rect = read ? result.Rectangle : Rectangle.Empty;
        return read && rect.Width > 0 && rect.Height > 0;
    }

    private static string ClassOf(IntPtr handle)
    {
        var name = new StringBuilder(128);
        GetClassName(handle, name, name.Capacity);
        return name.ToString();
    }

    private static int Px(float dip, uint dpi)
    {
        return (int)Math.Round(dip * dpi / 96f, MidpointRounding.AwayFromZero);
    }

    private sealed class Quotas
    {
        internal readonly string Codex, Antigravity;
        internal readonly bool Dark;
        internal Quotas(string codex, string antigravity, bool dark)
        {
            Codex = codex;
            Antigravity = antigravity;
            Dark = dark;
        }
        internal bool Matches(Quotas other)
        {
            return other != null && Codex == other.Codex && Antigravity == other.Antigravity && Dark == other.Dark;
        }
    }

    private static Quotas ParseState(string codex, string antigravity, string theme)
    {
        if (theme != "dark" && theme != "light") return null;
        if (!ValidQuota(codex) || !ValidQuota(antigravity)) return null;
        return new Quotas(codex, antigravity, theme == "dark");
    }

    private static bool ValidQuota(string value)
    {
        if (value == NoData || value == "<1%") return true;
        int percent;
        return value.Length >= 2 && value.Length <= 4 && value.EndsWith("%", StringComparison.Ordinal) &&
            int.TryParse(value.Substring(0, value.Length - 1), NumberStyles.None, Invariant, out percent) &&
            percent >= 0 && percent <= 100 && value == percent.ToString(Invariant) + "%";
    }

    private static bool IsCritical(string label)
    {
        return label == "<1%" || (label.Length == 2 && label[1] == '%');
    }

    private static Bitmap Render(Quotas state, uint dpi, int hoveredGroup)
    {
        var bitmap = new Bitmap(Px(WidgetWidth, dpi), Px(GroupHeight, dpi), PixelFormat.Format32bppPArgb);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        using (var font = new Font("Segoe UI", 13, FontStyle.Regular, GraphicsUnit.Pixel))
        using (StringFormat format = StringFormat.GenericTypographic)
        {
            format.LineAlignment = StringAlignment.Center;
            graphics.ScaleTransform(dpi / 96f, dpi / 96f);
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            DrawGroup(graphics, font, format, state.Codex, false, state.Dark, hoveredGroup == 0);
            DrawGroup(graphics, font, format, state.Antigravity, true, state.Dark, hoveredGroup == 1);
        }
        return bitmap;
    }

    private static void DrawGroup(Graphics graphics, Font font, StringFormat format, string label, bool antigravity, bool dark, bool hovered)
    {
        float left = antigravity ? GroupWidth + GroupGap : 0;
        Color neutral = dark ? Color.White : Color.FromArgb(27, 27, 27);
        Color ink = IsCritical(label) ? (dark ? Color.FromArgb(255, 118, 128) : Color.FromArgb(162, 20, 39)) : neutral;
        if (hovered)
        {
            using (var background = new SolidBrush(Color.FromArgb(dark ? 30 : 19, neutral)))
            using (var path = new GraphicsPath())
            {
                const int radius = 10;
                path.AddArc(left, 0, radius, radius, 180, 90);
                path.AddArc(left + GroupWidth - radius, 0, radius, radius, 270, 90);
                path.AddArc(left + GroupWidth - radius, GroupHeight - radius, radius, radius, 0, 90);
                path.AddArc(left, GroupHeight - radius, radius, radius, 90, 90);
                path.CloseFigure();
                graphics.FillPath(background, path);
            }
        }
        QuotaGlyphs.Draw(graphics, new RectangleF(left + 6, 7, 18, 18), antigravity, neutral);
        using (var foreground = new SolidBrush(ink))
            graphics.DrawString(label, font, foreground, new RectangleF(left + 29, 0, GroupWidth - 29, GroupHeight), format);
    }

    private static bool UpdatePixels(IntPtr handle, Bitmap bitmap)
    {
        var header = new BitmapInfoHeader
        {
            Size = (uint)Marshal.SizeOf(typeof(BitmapInfoHeader)), Width = bitmap.Width, Height = -bitmap.Height, Planes = 1, BitCount = 32
        };
        IntPtr memory = CreateCompatibleDC(IntPtr.Zero);
        if (memory == IntPtr.Zero) return false;
        IntPtr pixels, dib = CreateDIBSection(memory, ref header, 0, out pixels, IntPtr.Zero, 0);
        try
        {
            if (dib == IntPtr.Zero || pixels == IntPtr.Zero) return false;
            BitmapData source = bitmap.LockBits(new Rectangle(Point.Empty, bitmap.Size), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
            try
            {
                int stride = bitmap.Width * 4;
                byte[] row = new byte[stride];
                for (int y = 0; y < bitmap.Height; y++)
                {
                    Marshal.Copy(IntPtr.Add(source.Scan0, y * source.Stride), row, 0, row.Length);
                    Marshal.Copy(row, 0, IntPtr.Add(pixels, y * stride), row.Length);
                }
            }
            finally { bitmap.UnlockBits(source); }
            IntPtr previous = SelectObject(memory, dib);
            if (previous == IntPtr.Zero || previous == new IntPtr(-1)) return false;
            try
            {
                Size size = bitmap.Size;
                Point origin = Point.Empty;
                var blend = new BlendFunction { SourceConstantAlpha = 255, AlphaFormat = 1 };
                return UpdateLayeredWindow(handle, IntPtr.Zero, IntPtr.Zero, ref size, memory, ref origin, 0, ref blend, 2);
            }
            finally { SelectObject(memory, previous); }
        }
        finally
        {
            if (dib != IntPtr.Zero) DeleteObject(dib);
            DeleteDC(memory);
        }
    }

    private delegate IntPtr WindowProcedure(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClass
    {
        public uint Size, Style;
        public WindowProcedure Procedure;
        public int ClassExtra, WindowExtra;
        public IntPtr Instance, Icon, Cursor, Background;
        public string MenuName, ClassName;
        public IntPtr SmallIcon;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left, Top, Right, Bottom;
        public Rectangle Rectangle { get { return Rectangle.FromLTRB(Left, Top, Right, Bottom); } }
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public uint Size;
        public NativeRect Monitor, Work;
        public uint Flags;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader
    {
        public uint Size;
        public int Width, Height;
        public ushort Planes, BitCount;
        public uint Compression, SizeImage;
        public int XPelsPerMeter, YPelsPerMeter;
        public uint ColorsUsed, ColorsImportant;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct BlendFunction
    {
        public byte Operation, Flags, SourceConstantAlpha, AlphaFormat;
    }

    [DllImport("kernel32", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern ushort RegisterClassEx(ref WindowClass windowClass);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowEx(int exStyle, string className, string name, int style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr LoadCursor(IntPtr module, IntPtr cursor);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string className, string name);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string name);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
    [DllImport("user32")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32")] private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);
    [DllImport("user32")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32")] private static extern bool GetCursorPos(out Point cursor);
    [DllImport("user32")] private static extern IntPtr WindowFromPoint(Point cursor);
    [DllImport("user32")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32")] private static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32")] private static extern bool ScreenToClient(IntPtr hwnd, ref Point point);
    [DllImport("user32")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, int flags);
    [DllImport("user32")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32")] private static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("dwmapi")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out NativeRect value, int size);
    [DllImport("user32")] private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr destination, IntPtr position, ref Size size,
        IntPtr source, ref Point origin, uint colorKey, ref BlendFunction blend, uint flags);
    [DllImport("gdi32")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32")] private static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfoHeader info, uint usage, out IntPtr pixels, IntPtr section, uint offset);
    [DllImport("gdi32")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32")] private static extern bool DeleteDC(IntPtr dc);
}
