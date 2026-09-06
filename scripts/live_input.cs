using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using System.Windows.Forms;

public class LiveInputResult {
    public bool ok;
    public string reason = "";
    public string written = "";
    public bool retry;
    public long hwnd;
    public long foregroundHwnd;
}

public static class VoicePadLiveInput {
    delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    static HookProc keyboardProc = Keyboard;
    static HookProc mouseProc = Mouse;
    static IntPtr keyboardHook, mouseHook, target;
    static int activity, armedAt, trigger;
    static volatile bool armed;
    static bool compatibleMode;
    static int[] runtimeId;
    static string expectedPrefix;
    const uint InjectionTag = 0x5641504C;
    static Thread pump;
    static ManualResetEvent ready = new ManualResetEvent(false);
    static string startupError;

    [StructLayout(LayoutKind.Sequential)] struct KEYDATA { public uint vk, scan, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEDATA { public POINT pt; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEYINPUT key; [FieldOffset(0)] public MOUSEINPUT mouse; }
    [StructLayout(LayoutKind.Sequential)] struct KEYINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);

    static bool Modifier(int key) { return key == 16 || key == 17 || key == 18 || key == 91 || key == 92 || (key >= 160 && key <= 165); }
    static IntPtr Keyboard(int code, IntPtr message, IntPtr data) {
        if (code >= 0 && armed && (message.ToInt32() == 0x100 || message.ToInt32() == 0x104)) {
            var key = (KEYDATA)Marshal.PtrToStructure(data, typeof(KEYDATA));
            if (key.extra.ToUInt64() != InjectionTag && key.vk != trigger && !Modifier((int)key.vk)) Interlocked.Increment(ref activity);
        }
        return CallNextHookEx(keyboardHook, code, message, data);
    }
    static IntPtr Mouse(int code, IntPtr message, IntPtr data) {
        int kind = message.ToInt32();
        if (code >= 0 && armed && (kind == 0x201 || kind == 0x204 || kind == 0x207 || kind == 0x20A || kind == 0x20B || kind == 0x20E)) {
            var mouse = (MOUSEDATA)Marshal.PtrToStructure(data, typeof(MOUSEDATA));
            // Mouse input from other automation is also a cursor ownership change.
            Interlocked.Increment(ref activity);
        }
        return CallNextHookEx(mouseHook, code, message, data);
    }
    public static void Start() {
        pump = new Thread(() => {
            using (var process = Process.GetCurrentProcess()) {
                IntPtr module = GetModuleHandle(process.MainModule.ModuleName);
                keyboardHook = SetWindowsHookEx(13, keyboardProc, module, 0);
                mouseHook = SetWindowsHookEx(14, mouseProc, module, 0);
            }
            if (keyboardHook == IntPtr.Zero || mouseHook == IntPtr.Zero) startupError = "Cannot install input ownership guards";
            ready.Set();
            if (startupError == null) Application.Run();
            if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
            if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        });
        pump.IsBackground = true;
        pump.SetApartmentState(ApartmentState.STA);
        pump.Start();
        if (!ready.WaitOne(5000) || startupError != null) throw new Exception(startupError ?? "Input guard startup timeout");
    }
    static string CheckCaret(bool capture) {
        if (GetForegroundWindow() != target) return "focus-changed";
        if (activity != armedAt) return "user-input";
        if (compatibleMode) {
            if (capture) expectedPrefix = "";
            return "";
        }
        var focused = AutomationElement.FocusedElement;
        if (focused == null) return "unsupported-field";
        var info = focused.Current;
        uint processId;
        GetWindowThreadProcessId(target, out processId);
        if (info.ProcessId != processId || info.IsPassword || !info.IsEnabled || !info.IsKeyboardFocusable) return "unsupported-field";
        if (info.ControlType != ControlType.Edit) return "unsupported-field";
        if (capture) runtimeId = focused.GetRuntimeId();
        else if (!focused.GetRuntimeId().SequenceEqual(runtimeId)) return "field-changed";
        object pattern;
        if (!focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return "unsupported-field";
        var readOnly = ((TextPattern)pattern).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
        if (readOnly is bool && (bool)readOnly) return "readonly-field";
        var selections = ((TextPattern)pattern).GetSelection();
        if (selections.Length != 1 || selections[0].CompareEndpoints(TextPatternRangeEndpoint.Start, selections[0], TextPatternRangeEndpoint.End) != 0) return "selection-active";
        var prefix = ((TextPattern)pattern).DocumentRange.Clone();
        prefix.MoveEndpointByRange(TextPatternRangeEndpoint.End, selections[0], TextPatternRangeEndpoint.Start);
        string value = prefix.GetText(100001);
        if (value.Length > 100000) return "unsupported-field";
        if (capture) expectedPrefix = value;
        else if (value != expectedPrefix) return "caret-or-text-changed";
        return "";
    }
    public static LiveInputResult Arm(long hwnd, int hotkey, int excludedProcess, bool compatible) {
        armed = false;
        target = hwnd > 0 ? new IntPtr(hwnd) : GetForegroundWindow();
        uint owner;
        GetWindowThreadProcessId(target, out owner);
        if (owner == excludedProcess) return new LiveInputResult { reason = "own-window" };
        trigger = hotkey;
        compatibleMode = compatible;
        runtimeId = null;
        armedAt = activity;
        armed = true;
        string reason;
        try { reason = CheckCaret(true); } catch { reason = compatibleMode ? "target-unavailable" : "unsupported-field"; }
        if (reason.Length > 0) armed = false;
        return new LiveInputResult { ok = armed, reason = reason, hwnd = target.ToInt64(), foregroundHwnd = GetForegroundWindow().ToInt64() };
    }
    static bool ModifiersHeld() {
        return new int[] { 16, 17, 18, 91, 92 }.Any(key => (GetAsyncKeyState(key) & 0x8000) != 0);
    }
    public static LiveInputResult Append(string text) {
        var result = new LiveInputResult();
        if (!armed) { result.reason = "not-armed"; return result; }
        try { result.reason = CheckCaret(false); } catch { result.reason = "field-unavailable"; }
        if (result.reason.Length > 0) { armed = false; return result; }
        if (ModifiersHeld()) { result.retry = true; result.reason = "modifier-held"; return result; }
        foreach (char c in text) {
            if (!armed || GetForegroundWindow() != target || activity != armedAt) { armed = false; result.reason = "focus-or-input-changed"; return result; }
            var down = new INPUT { type = 1, u = new UNION { key = new KEYINPUT { scan = c, flags = 4, extra = new UIntPtr(InjectionTag) } } };
            var up = new INPUT { type = 1, u = new UNION { key = new KEYINPUT { scan = c, flags = 6, extra = new UIntPtr(InjectionTag) } } };
            var keys = new INPUT[] { down, up };
            if (SendInput(2, keys, Marshal.SizeOf(typeof(INPUT))) != 2) { armed = false; result.reason = "input-blocked"; return result; }
            result.written += c;
            expectedPrefix += c;
        }
        // SendInput accepting events does not prove that the control accepted text.
        // Wait briefly for its accessibility caret/text state to catch up.
        for (int attempt = 0; attempt < 10; attempt++) {
            Thread.Sleep(15);
            try { result.reason = CheckCaret(false); } catch { result.reason = compatibleMode ? "target-unavailable" : "field-unavailable"; }
            if (result.reason.Length == 0) break;
            if (!compatibleMode && result.reason != "caret-or-text-changed") break;
        }
        if (result.reason.Length > 0) { armed = false; return result; }
        result.ok = true;
        return result;
    }
    public static void End() { armed = false; compatibleMode = false; target = IntPtr.Zero; runtimeId = null; expectedPrefix = null; }
}
