# ============================================================
#  capture.ps1 — native Windows screen capture (Release Journal Worker · Phase 3)
#
#  Captures a monitor, an explicit region, or the whole virtual desktop to a PNG.
#  Zero dependencies (System.Drawing). Runs on the journal box where Quantower's
#  charts live. The Node screenshot scheduler invokes this once per frame.
#
#  Windows PowerShell 5.1 compatible.
#
#  Examples:
#    powershell -ExecutionPolicy Bypass -File capture.ps1 -Out shot.png -Monitor 0
#    powershell -ExecutionPolicy Bypass -File capture.ps1 -Out shot.png -X 100 -Y 80 -W 1280 -H 720
#    powershell -ExecutionPolicy Bypass -File capture.ps1 -Out shot.png          # whole virtual desktop
# ============================================================

param(
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Monitor = -1,                       # 0-based screen index; -1 = all screens
    [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0,   # region (used when W>0 and H>0)
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

try {
    if ($W -gt 0 -and $H -gt 0) {
        $bx = $X; $by = $Y; $bw = $W; $bh = $H
    }
    elseif ($Monitor -ge 0) {
        $screens = [System.Windows.Forms.Screen]::AllScreens
        if ($Monitor -ge $screens.Count) { throw "Monitor $Monitor not found (have $($screens.Count))" }
        $b = $screens[$Monitor].Bounds
        $bx = $b.X; $by = $b.Y; $bw = $b.Width; $bh = $b.Height
    }
    else {
        $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bx = $b.X; $by = $b.Y; $bw = $b.Width; $bh = $b.Height
    }

    $dir = Split-Path -Parent $Out
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    $bmp = New-Object System.Drawing.Bitmap $bw, $bh
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $gfx.CopyFromScreen($bx, $by, 0, 0, $bmp.Size)
        $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $gfx.Dispose(); $bmp.Dispose()
    }

    if (-not $Quiet) { Write-Host "captured ${bw}x${bh} -> $Out" }
    exit 0
}
catch {
    Write-Error "capture failed: $($_.Exception.Message)"
    exit 1
}
