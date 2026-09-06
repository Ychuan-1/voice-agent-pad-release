param(
  [Parameter(Mandatory = $true)]
  [string]$Accelerator
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-HookEvent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Type,
    [string]$Message = '',
    [Int64]$TargetHwnd = 0
  )

  $payload = @{
    type = $Type
    accelerator = $Accelerator
  }
  if ($TargetHwnd -gt 0) {
    $payload.targetHwnd = $TargetHwnd
  }
  if ($Message) {
    $payload.message = $Message
  }

  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Convert-KeyTokenToVk {
  param([Parameter(Mandatory = $true)][string]$Token)

  $upper = $Token.Trim().ToUpperInvariant()
  if ($upper -match '^[A-Z]$') {
    return [int][char]$upper
  }
  if ($upper -match '^[0-9]$') {
    return [int][char]$upper
  }
  if ($upper -match '^F([1-9]|1[0-9]|2[0-4])$') {
    return 0x6F + [int]$Matches[1]
  }

  switch ($upper) {
    'SPACE' { return 0x20 }
    'ENTER' { return 0x0D }
    'RETURN' { return 0x0D }
    'TAB' { return 0x09 }
    'ESC' { return 0x1B }
    'ESCAPE' { return 0x1B }
    'BACKSPACE' { return 0x08 }
    'DELETE' { return 0x2E }
    'DEL' { return 0x2E }
    'INSERT' { return 0x2D }
    'INS' { return 0x2D }
    'HOME' { return 0x24 }
    'END' { return 0x23 }
    'PAGEUP' { return 0x21 }
    'PAGEDOWN' { return 0x22 }
    'UP' { return 0x26 }
    'DOWN' { return 0x28 }
    'LEFT' { return 0x25 }
    'RIGHT' { return 0x27 }
    default {
      throw "Unsupported shortcut key: $Token"
    }
  }
}

function Get-ModifierVks {
  param([Parameter(Mandatory = $true)][string]$Modifier)

  switch ($Modifier.ToLowerInvariant()) {
    'control' { return @(0x11, 0xA2, 0xA3) }
    'alt' { return @(0x12, 0xA4, 0xA5) }
    'shift' { return @(0x10, 0xA0, 0xA1) }
    'meta' { return @(0x5B, 0x5C) }
    default { return @() }
  }
}

function Read-HotkeySpec {
  param([Parameter(Mandatory = $true)][string]$Value)

  $modifiers = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $mainKey = ''

  foreach ($rawPart in ($Value -split '\+')) {
    $part = $rawPart.Trim()
    if (-not $part) {
      continue
    }

    switch -Regex ($part) {
      '^(CommandOrControl|CmdOrCtrl|Control|Ctrl)$' {
        [void]$modifiers.Add('control')
        continue
      }
      '^(Alt|Option)$' {
        [void]$modifiers.Add('alt')
        continue
      }
      '^Shift$' {
        [void]$modifiers.Add('shift')
        continue
      }
      '^(Meta|Command|Cmd|Super|Win)$' {
        [void]$modifiers.Add('meta')
        continue
      }
      default {
        $mainKey = $part
      }
    }
  }

  if (-not $mainKey) {
    throw "Shortcut needs a main key: $Value"
  }

  $modifierArray = foreach ($modifier in $modifiers) {
    [string]$modifier
  }

  [pscustomobject]@{
    Modifiers = @($modifierArray)
    MainVk = Convert-KeyTokenToVk $mainKey
  }
}

try {
  $hotkey = Read-HotkeySpec $Accelerator
} catch {
  Write-HookEvent -Type 'error' -Message $_.Exception.Message
  exit 2
}

$source = @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class VoiceAgentPadHotkeyHook
{
    public static Func<string, int, bool> HandleKey;
    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static readonly LowLevelKeyboardProc Proc = HookCallback;
    private static IntPtr hookId = IntPtr.Zero;

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public int vkCode;
        public int scanCode;
        public int flags;
        public int time;
        public IntPtr dwExtraInfo;
    }

    public static void Start()
    {
        hookId = SetHook(Proc);
        if (hookId == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    public static void Stop()
    {
        if (hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(hookId);
            hookId = IntPtr.Zero;
        }
    }

    public static IntPtr GetForegroundWindowHandle()
    {
        return GetForegroundWindow();
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (Process currentProcess = Process.GetCurrentProcess())
        using (ProcessModule currentModule = currentProcess.MainModule)
        {
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(currentModule.ModuleName), 0);
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int message = wParam.ToInt32();
            if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN || message == WM_KEYUP || message == WM_SYSKEYUP)
            {
                KBDLLHOOKSTRUCT data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                string eventType = (message == WM_KEYDOWN || message == WM_SYSKEYDOWN) ? "down" : "up";
                bool suppress = false;
                try
                {
                    suppress = HandleKey != null && HandleKey(eventType, data.vkCode);
                }
                catch
                {
                    suppress = false;
                }
                if (suppress)
                {
                    return (IntPtr)1;
                }
            }
        }

        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
}
"@

Add-Type -TypeDefinition $source
Add-Type -AssemblyName System.Windows.Forms

$script:pressedVks = [System.Collections.Generic.HashSet[int]]::new()
$script:hotkeyActive = $false
$mainVk = [int]$hotkey.MainVk
$requiredModifiers = @($hotkey.Modifiers)

function Test-ModifierPressed {
  param([Parameter(Mandatory = $true)][string]$Modifier)

  foreach ($vk in (Get-ModifierVks $Modifier)) {
    if ($script:pressedVks.Contains([int]$vk)) {
      return $true
    }
  }
  return $false
}

function Test-HotkeyPressed {
  if (-not $script:pressedVks.Contains($mainVk)) {
    return $false
  }
  foreach ($modifier in $requiredModifiers) {
    if (-not (Test-ModifierPressed $modifier)) {
      return $false
    }
  }
  return $true
}

function Is-RequiredModifierVk {
  param([Parameter(Mandatory = $true)][int]$Vk)

  foreach ($modifier in $requiredModifiers) {
    if ((Get-ModifierVks $modifier) -contains $Vk) {
      return $true
    }
  }
  return $false
}

[VoiceAgentPadHotkeyHook]::HandleKey = [Func[string, int, bool]]{
  param([string]$EventType, [int]$VkCode)

  $isMainKey = $VkCode -eq $mainVk
  $isRequiredModifier = Is-RequiredModifierVk $VkCode
  $suppress = $false

  if ($EventType -eq 'down') {
    [void]$script:pressedVks.Add($VkCode)
    if (-not $script:hotkeyActive -and $isMainKey -and (Test-HotkeyPressed)) {
      $script:hotkeyActive = $true
      $targetHwnd = [VoiceAgentPadHotkeyHook]::GetForegroundWindowHandle().ToInt64()
      Write-HookEvent -Type 'down' -TargetHwnd $targetHwnd
      $suppress = $true
    } elseif ($script:hotkeyActive -and $isMainKey) {
      $suppress = $true
    }
  } else {
    [void]$script:pressedVks.Remove($VkCode)
    if ($script:hotkeyActive -and (-not (Test-HotkeyPressed))) {
      $script:hotkeyActive = $false
      Write-HookEvent -Type 'up'
      $suppress = $isMainKey
    } elseif ($isMainKey -and (Test-ModifierPressed 'control' -or Test-ModifierPressed 'alt' -or Test-ModifierPressed 'shift' -or Test-ModifierPressed 'meta')) {
      $suppress = $true
    }
  }

  return [bool]($suppress -and $isMainKey -and (-not $isRequiredModifier))
}

try {
  [VoiceAgentPadHotkeyHook]::Start()
  Write-HookEvent -Type 'ready'
  [System.Windows.Forms.Application]::Run()
} catch {
  Write-HookEvent -Type 'error' -Message $_.Exception.Message
  exit 1
} finally {
  [VoiceAgentPadHotkeyHook]::Stop()
}
