using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Runtime.InteropServices;

internal static class Program
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool OpenClipboard(IntPtr hWndNewOwner);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseClipboard();
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetClipboardData(uint uFormat);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EmptyClipboard();
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr hMem);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalFree(IntPtr hMem);

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public uint type; public InputUnion U; }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const byte VK_CONTROL = 0x11;
    private const byte VK_C = 0x43;
    private const uint CF_UNICODETEXT = 13;
    private const uint GMEM_MOVEABLE = 0x0002;

    private static string DebugPath;
    private static void Dbg(string message)
    {
        if (string.IsNullOrEmpty(DebugPath)) return;
        try { File.AppendAllText(DebugPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + "\n", Encoding.UTF8); } catch { }
    }

    private static bool WithClipboard(Func<bool> action)
    {
        for (int attempt = 0; attempt < 12; attempt++)
        {
            if (!OpenClipboard(IntPtr.Zero)) { Thread.Sleep(20); continue; }
            try { return action(); }
            finally { CloseClipboard(); }
        }
        return false;
    }

    private static string ReadClipboardText()
    {
        string result = null;
        WithClipboard(() =>
        {
            IntPtr handle = GetClipboardData(CF_UNICODETEXT);
            if (handle == IntPtr.Zero) return true;
            IntPtr pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero) return true;
            try { result = Marshal.PtrToStringUni(pointer); }
            finally { GlobalUnlock(handle); }
            return true;
        });
        return result;
    }

    private static bool SetClipboardText(string text)
    {
        if (text == null) return false;
        return WithClipboard(() =>
        {
            if (!EmptyClipboard()) return false;
            byte[] bytes = Encoding.Unicode.GetBytes(text + "\0");
            IntPtr memory = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
            if (memory == IntPtr.Zero) return false;
            IntPtr pointer = GlobalLock(memory);
            if (pointer == IntPtr.Zero) { GlobalFree(memory); return false; }
            try { Marshal.Copy(bytes, 0, pointer, bytes.Length); }
            finally { GlobalUnlock(memory); }
            if (SetClipboardData(CF_UNICODETEXT, memory) == IntPtr.Zero) { GlobalFree(memory); return false; }
            return true;
        });
    }

    private static bool ClearClipboard()
    {
        return WithClipboard(() => EmptyClipboard());
    }

    private static void SendCopy()
    {
        var inputs = new INPUT[4];
        inputs[0] = MakeKey(VK_CONTROL, false);
        inputs[1] = MakeKey(VK_C, false);
        inputs[2] = MakeKey(VK_C, true);
        inputs[3] = MakeKey(VK_CONTROL, true);
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sent != inputs.Length)
        {
            keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
            keybd_event(VK_C, 0, 0, UIntPtr.Zero);
            keybd_event(VK_C, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }
    }

    private static INPUT MakeKey(byte vk, bool up)
    {
        var input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.U.ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = up ? KEYEVENTF_KEYUP : 0, time = 0, dwExtraInfo = IntPtr.Zero };
        return input;
    }

    private static string TryUiaSelection()
    {
        try
        {
            var focused = AutomationElement.FocusedElement;
            string text = ReadTextPattern(focused);
            if (!string.IsNullOrEmpty(text)) return text;
            if (focused != null)
            {
                var condition = new OrCondition(
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
                var found = focused.FindFirst(TreeScope.Descendants, condition);
                text = ReadTextPattern(found);
                if (!string.IsNullOrEmpty(text)) return text;
            }
        }
        catch (Exception ex) { Dbg("uia-err " + ex.GetType().Name + " " + ex.Message); }
        return null;
    }

    private static string ReadTextPattern(AutomationElement element)
    {
        if (element == null) return null;
        try
        {
            object pattern;
            if (!element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return null;
            var textPattern = (TextPattern)pattern;
            var ranges = textPattern.GetSelection();
            var sb = new StringBuilder();
            foreach (var range in ranges)
            {
                string part = range.GetText(-1);
                if (!string.IsNullOrEmpty(part)) sb.Append(part);
            }
            return sb.ToString().Trim();
        }
        catch (Exception ex) { Dbg("textpattern-err " + ex.GetType().Name); return null; }
    }

    [STAThread]
    private static void Main()
    {
        DebugPath = Environment.GetEnvironmentVariable("LUMEN_GRABBER_DEBUG");
        Console.OutputEncoding = Encoding.UTF8;
        Dbg("start");
        string before = ReadClipboardText();
        uint seq = GetClipboardSequenceNumber();
        Dbg("before len=" + (before == null ? -1 : before.Length) + " seq=" + seq);

        try { SendCopy(); Dbg("sent copy"); }
        catch (Exception ex) { Dbg("send-err " + ex.GetType().Name + " " + ex.Message); }

        string selected = null;
        for (int i = 0; i < 45; i++)
        {
            Thread.Sleep(20);
            if (GetClipboardSequenceNumber() == seq) continue;
            string current = ReadClipboardText();
            if (!string.IsNullOrEmpty(current))
            {
                selected = current;
                Dbg("copied at " + i + " len=" + selected.Length);
            }
            break;
        }

        if (string.IsNullOrEmpty(selected))
        {
            string uia = null;
            var thread = new Thread(() => { uia = TryUiaSelection(); }) { IsBackground = true };
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            if (!thread.Join(900)) Dbg("uia-timeout");
            selected = uia;
            Dbg("uia len=" + (selected == null ? -1 : selected.Length));
        }

        try
        {
            if (before != null) { if (before != selected) SetClipboardText(before); }
            else if (selected != null) { ClearClipboard(); }
        }
        catch (Exception ex) { Dbg("restore-err " + ex.GetType().Name); }

        Dbg("end selected=" + (selected == null ? -1 : selected.Length));
        if (!string.IsNullOrEmpty(selected)) Console.Write(selected.Trim());
    }
}