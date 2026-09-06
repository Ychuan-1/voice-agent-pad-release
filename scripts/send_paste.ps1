param(
  [Int64]$TargetHwnd = 0,
  [ValidateSet('Type', 'Paste')]
  [string]$Mode = 'Type',
  [string]$TextFile = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$source = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class VoiceAgentPadPasteInput
{
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    private const ushort VK_LCONTROL = 0xA2;
    private const ushort VK_V = 0x56;
    private const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public MOUSEINPUT mi;

        [FieldOffset(0)]
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    public static bool IsForeground(long hwnd) { return GetForegroundWindow() == new IntPtr(hwnd); }

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    private static INPUT Key(ushort vk, bool keyUp)
    {
        return new INPUT
        {
            type = INPUT_KEYBOARD,
            u = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = vk,
                    wScan = 0,
                    dwFlags = keyUp ? KEYEVENTF_KEYUP : 0,
                    time = 0,
                    dwExtraInfo = UIntPtr.Zero
                }
            }
        };
    }

    private static INPUT UnicodeKey(char value, bool keyUp)
    {
        return new INPUT
        {
            type = INPUT_KEYBOARD,
            u = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = 0,
                    wScan = (ushort)value,
                    dwFlags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0),
                    time = 0,
                    dwExtraInfo = UIntPtr.Zero
                }
            }
        };
    }

    private static void Send(params INPUT[] inputs)
    {
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sent != inputs.Length)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    public static bool FocusWindow(long hwndValue)
    {
        if (hwndValue <= 0)
        {
            return false;
        }

        IntPtr hwnd = new IntPtr(hwndValue);
        if (!IsWindow(hwnd))
        {
            return false;
        }

        ShowWindow(hwnd, SW_RESTORE);
        uint currentThread = GetCurrentThreadId();
        uint targetThread = GetWindowThreadProcessId(hwnd, IntPtr.Zero);
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        bool attached = false;
        bool foregroundAttached = false;

        try
        {
            if (foregroundThread != 0 && foregroundThread != currentThread)
            {
                foregroundAttached = AttachThreadInput(currentThread, foregroundThread, true);
            }
            if (targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread)
            {
                attached = AttachThreadInput(currentThread, targetThread, true);
            }

            return SetForegroundWindow(hwnd) || GetForegroundWindow() == hwnd;
        }
        finally
        {
            if (attached)
            {
                AttachThreadInput(currentThread, targetThread, false);
            }
            if (foregroundAttached)
            {
                AttachThreadInput(currentThread, foregroundThread, false);
            }
        }
    }

    public static void Paste()
    {
        Send(Key(VK_LCONTROL, false), Key(VK_V, false), Key(VK_V, true), Key(VK_LCONTROL, true));
    }

    public static void TypeText(string text)
    {
        if (String.IsNullOrEmpty(text))
        {
            return;
        }

        foreach (char value in text)
        {
            if (value == '\r')
            {
                continue;
            }

            // Never synthesize Enter in a chat window. Clipboard mode preserves line breaks.
            char cleanValue = value == '\n' ? ' ' : value;
            Send(UnicodeKey(cleanValue, false), UnicodeKey(cleanValue, true));
        }
    }
}
"@

Add-Type -TypeDefinition $source
if ($DryRun) {
  'send_paste ready'
  return
}

if ($TargetHwnd -gt 0) {
  if (-not [VoiceAgentPadPasteInput]::FocusWindow($TargetHwnd)) { throw 'Cannot restore target window.' }
  Start-Sleep -Milliseconds 180
  if (-not [VoiceAgentPadPasteInput]::IsForeground($TargetHwnd)) { throw 'Target window lost focus.' }
} else {
  Start-Sleep -Milliseconds 130
}

try {
  if ($Mode -eq 'Type') {
    $text = if ($TextFile) { Get-Content -LiteralPath $TextFile -Raw -Encoding UTF8 } else { Get-Clipboard -Raw }
    [VoiceAgentPadPasteInput]::TypeText($text)
  } else {
    [VoiceAgentPadPasteInput]::Paste()
  }
} catch {
  throw
}
