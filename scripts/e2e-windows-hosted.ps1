param(
  [int]$WindowTimeoutSeconds = 15,
  [int]$CollectorTimeoutSeconds = 10,
  [switch]$FullHost
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Probe([string]$Name, [string]$Value) {
  Write-Host ("probe.{0}={1}" -f $Name, $Value)
}

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class DchUser32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Get-ForegroundInfo {
  $hwnd = [DchUser32]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) {
    return [pscustomobject]@{ Hwnd = 0; Pid = 0; Process = ''; Title = '' }
  }

  [uint32]$pidValue = 0
  [void][DchUser32]::GetWindowThreadProcessId($hwnd, [ref]$pidValue)
  $builder = New-Object System.Text.StringBuilder 1024
  [void][DchUser32]::GetWindowText($hwnd, $builder, $builder.Capacity)

  $processName = ''
  try { $processName = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName } catch {}

  [pscustomobject]@{
    Hwnd = $hwnd.ToInt64()
    Pid = $pidValue
    Process = $processName
    Title = $builder.ToString()
  }
}

function Wait-ForMainWindow([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $Process.Refresh()
    if ($Process.HasExited) {
      throw "Notepad exited before exposing a main window (exit $($Process.ExitCode))"
    }
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
      return $Process.MainWindowHandle
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Notepad did not expose a main window within $TimeoutSeconds seconds"
}

Write-Probe 'os' ([Environment]::OSVersion.VersionString)
Write-Probe 'interactive' ([Environment]::UserInteractive.ToString())
Write-Probe 'sessionId' ([System.Diagnostics.Process]::GetCurrentProcess().SessionId.ToString())
Write-Probe 'user' ([Environment]::UserName)
try {
  $sessions = (quser 2>&1 | Out-String).Trim()
  Write-Host 'probe.quser<<EOF'
  Write-Host $sessions
  Write-Host 'EOF'
} catch {
  Write-Probe 'quser' "unavailable: $($_.Exception.Message)"
}

$before = Get-ForegroundInfo
Write-Probe 'foregroundBefore' (($before | ConvertTo-Json -Compress))

$probeFile = Join-Path $env:RUNNER_TEMP 'dch-github-hosted-uia-probe.txt'
[System.IO.File]::WriteAllText(
  $probeFile,
  ('DCH GitHub-hosted Windows UIA probe' + [Environment]::NewLine),
  (New-Object System.Text.UTF8Encoding($false))
)

$notepad = $null
$notepad = Start-Process -FilePath 'notepad.exe' -ArgumentList @($probeFile) -PassThru
try {
  $hwnd = Wait-ForMainWindow -Process $notepad -TimeoutSeconds $WindowTimeoutSeconds
  [void][DchUser32]::ShowWindow($hwnd, 9)
  $setForeground = [DchUser32]::SetForegroundWindow($hwnd)

  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($notepad.Id)
  } catch {
    Write-Probe 'appActivate' "failed: $($_.Exception.Message)"
  }

  Start-Sleep -Milliseconds 750
  $active = Get-ForegroundInfo
  Write-Probe 'setForegroundWindow' ($setForeground.ToString())
  Write-Probe 'notepad' (([pscustomobject]@{
    Pid = $notepad.Id
    Hwnd = $hwnd.ToInt64()
    MainWindowTitle = $notepad.MainWindowTitle
  }) | ConvertTo-Json -Compress)
  Write-Probe 'foregroundAfter' (($active | ConvertTo-Json -Compress))

  $collector = Join-Path $PSScriptRoot '..\native\windows\target\release\dsh-computer-history-collector-windows.exe'
  $collector = [System.IO.Path]::GetFullPath($collector)
  if (-not (Test-Path $collector)) {
    throw "collector missing: $collector"
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $collector
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $collectorProcess = New-Object System.Diagnostics.Process
  $collectorProcess.StartInfo = $startInfo
  if (-not $collectorProcess.Start()) {
    throw 'collector did not start'
  }

  $configure = @{
    v = 1
    type = 'configure'
    revision = 1
    policy = @{
      mode = 'include-only'
      allowedBundleIds = @('Notepad.exe')
      blockedBundleIds = @()
      protectedBundleIds = @()
      protectedPathPatterns = @()
    }
  } | ConvertTo-Json -Compress -Depth 5

  $collectorProcess.StandardInput.WriteLine($configure)
  $collectorProcess.StandardInput.Flush()

  # configure() immediately reconciles once. One heartbeat gives a second chance
  # if the hosted runner delays foreground activation.
  Start-Sleep -Seconds 6

  $collectorProcess.StandardInput.WriteLine('{"v":1,"type":"shutdown"}')
  $collectorProcess.StandardInput.Flush()
  $collectorProcess.StandardInput.Close()

  if (-not $collectorProcess.WaitForExit($CollectorTimeoutSeconds * 1000)) {
    $collectorProcess.Kill($true)
    throw "collector did not exit within $CollectorTimeoutSeconds seconds"
  }

  $stdout = $collectorProcess.StandardOutput.ReadToEnd()
  $stderr = $collectorProcess.StandardError.ReadToEnd()
  Write-Host 'probe.collectorStdout<<EOF'
  Write-Host $stdout
  Write-Host 'EOF'
  if ($stderr.Trim()) {
    Write-Host 'probe.collectorStderr<<EOF'
    Write-Host $stderr
    Write-Host 'EOF'
  }

  $messages = @()
  foreach ($line in ($stdout -split '[\r\n]+')) {
    if (-not $line.Trim()) { continue }
    try { $messages += ($line | ConvertFrom-Json -ErrorAction Stop) } catch {}
  }

  $hello = @($messages | Where-Object { $_.type -eq 'hello' })
  $configured = @($messages | Where-Object { $_.type -eq 'configured' -and $_.revision -eq 1 })
  $observations = @($messages | Where-Object { $_.type -eq 'observation' })
  $notepadObservations = @($observations | Where-Object {
    $_.app.bundleId -ieq 'Notepad.exe' -and
    $_.source.adapter -eq 'notepad' -and
    $_.source.provider -eq 'windows-uia'
  })

  Write-Probe 'helloCount' ($hello.Count.ToString())
  Write-Probe 'configuredCount' ($configured.Count.ToString())
  Write-Probe 'observationCount' ($observations.Count.ToString())
  Write-Probe 'notepadObservationCount' ($notepadObservations.Count.ToString())

  if ($hello.Count -lt 1) {
    throw 'collector emitted no hello'
  }
  if ($configured.Count -lt 1) {
    throw 'collector did not acknowledge revision 1'
  }
  if ($notepadObservations.Count -lt 1) {
    throw "GitHub-hosted runner produced no Notepad/windows-uia observation; foreground=$($active.Process)/$($active.Title)"
  }

  $first = $notepadObservations[0] | ConvertTo-Json -Compress -Depth 6
  Write-Probe 'liveObservation' $first
  Write-Host 'GitHub-hosted Windows live UIA probe passed.'

  if ($FullHost) {
    $dshBin = Join-Path $env:RUNNER_TEMP 'dsh-cli\node_modules\.bin'
    $dshCmd = Join-Path $dshBin 'dsh.cmd'
    if (-not (Test-Path $dshCmd)) {
      throw "DSH CLI missing: $dshCmd"
    }

    # Keep the same Notepad window in front while the generic throwaway-Host
    # harness packs, installs, boots and waits for the real Windows collector.
    # Spawning the Host must not be allowed to turn a standalone collector pass
    # into a false full-stack pass against some other foreground application.
    [void][DchUser32]::ShowWindow($hwnd, 9)
    [void][DchUser32]::SetForegroundWindow($hwnd)
    try { [void]$shell.AppActivate($notepad.Id) } catch {}
    Start-Sleep -Milliseconds 500
    $hostForeground = Get-ForegroundInfo
    Write-Probe 'foregroundBeforeHost' (($hostForeground | ConvertTo-Json -Compress))
    if ($hostForeground.Pid -ne $notepad.Id) {
      throw "Notepad lost foreground before Host E2E; foreground=$($hostForeground.Process)/$($hostForeground.Title)"
    }

    $env:PATH = "$dshBin;$env:PATH"
    $env:DSH_CLI = 'dsh'
    $env:COLLECTOR_EXECUTABLE = $collector
    $env:DSH_E2E_ALLOW_BUNDLES = 'Notepad.exe'
    $env:DSH_E2E_EXPECT_ACTIVITY = '1'
    $env:DSH_E2E_EXPECT_PROVIDER = 'windows-uia'
    $env:DSH_E2E_ACTIVITY_TIMEOUT_MS = '30000'

    # Run the generic Host harness asynchronously. Packing/installing the plugin causes the hosted terminal
    # to regain foreground, so focusing Notepad *before* this process is not evidence that the collector sees it.
    # Wait until the Host has finished its collector handshake, then restore the exact same Notepad HWND while the
    # harness is in its strict activity window. The next five-second collector heartbeat must then reach the store.
    $hostStdout = Join-Path $env:RUNNER_TEMP 'dch-windows-host-e2e.stdout.log'
    $hostStderr = Join-Path $env:RUNNER_TEMP 'dch-windows-host-e2e.stderr.log'
    Remove-Item $hostStdout, $hostStderr -Force -ErrorAction SilentlyContinue
    $hostScript = Join-Path $PSScriptRoot 'e2e-macos.mjs'
    $hostProcess = Start-Process -FilePath 'node.exe' -ArgumentList @($hostScript) -PassThru -NoNewWindow `
      -RedirectStandardOutput $hostStdout -RedirectStandardError $hostStderr

    $hostDeadline = [DateTime]::UtcNow.AddMinutes(3)
    $refocused = $false
    do {
      $hostProcess.Refresh()
      $hostOutputSoFar = if (Test-Path $hostStdout) { Get-Content $hostStdout -Raw -ErrorAction SilentlyContinue } else { '' }
      if (-not $refocused -and $hostOutputSoFar -match 'collector settles:') {
        [void][DchUser32]::ShowWindow($hwnd, 9)
        $refocusResult = [DchUser32]::SetForegroundWindow($hwnd)
        try { [void]$shell.AppActivate($notepad.Id) } catch {}
        Start-Sleep -Milliseconds 500
        $captureForeground = Get-ForegroundInfo
        Write-Probe 'refocusAfterCollectorSettles' ($refocusResult.ToString())
        Write-Probe 'foregroundDuringCapture' (($captureForeground | ConvertTo-Json -Compress))
        if ($captureForeground.Pid -ne $notepad.Id) {
          Stop-Process -Id $hostProcess.Id -Force -ErrorAction SilentlyContinue
          throw "Notepad could not regain foreground during Host capture; foreground=$($captureForeground.Process)/$($captureForeground.Title)"
        }
        $refocused = $true
      }
      if ($hostProcess.HasExited) { break }
      Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $hostDeadline)

    if (-not $hostProcess.HasExited) {
      Stop-Process -Id $hostProcess.Id -Force -ErrorAction SilentlyContinue
      throw 'full Windows Host E2E exceeded the 3 minute probe bound'
    }
    $hostProcess.WaitForExit()
    $hostOutput = if (Test-Path $hostStdout) { Get-Content $hostStdout -Raw } else { '' }
    $hostErrors = if (Test-Path $hostStderr) { Get-Content $hostStderr -Raw } else { '' }
    Write-Host 'probe.fullHostStdout<<EOF'
    Write-Host $hostOutput
    Write-Host 'EOF'
    if ($hostErrors.Trim()) {
      Write-Host 'probe.fullHostStderr<<EOF'
      Write-Host $hostErrors
      Write-Host 'EOF'
    }

    $hostExit = $hostProcess.ExitCode
    Write-Probe 'fullHostRefocused' ($refocused.ToString())
    Write-Probe 'fullHostExit' ($hostExit.ToString())
    if (-not $refocused) {
      throw 'full Windows Host E2E never reached the collector-settled activity window'
    }
    if ($hostExit -ne 0) {
      throw "full Windows Host E2E failed with exit $hostExit"
    }
    Write-Host 'GitHub-hosted Windows full Host E2E passed.'
  }
}
finally {
  if ($null -ne $notepad -and -not $notepad.HasExited) {
    Stop-Process -Id $notepad.Id -Force -ErrorAction SilentlyContinue
  }
}
