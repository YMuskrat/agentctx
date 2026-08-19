param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\assets'),
  [string]$PreviewDirectory = '',
  [string]$FfmpegPath = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cliPath = Join-Path $repoRoot 'bin\agenctx.js'
$nodePath = (Get-Command node.exe).Source
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$demoRoot = Join-Path $tempBase ('agenctx-demos-' + [Guid]::NewGuid().ToString('N'))

$width = 1200
$height = 675
$terminalX = 28
$terminalY = 28
$terminalWidth = 1144
$terminalHeight = 619
$titleHeight = 52
$contentX = 58
$contentY = 104
$lineHeight = 22
$maxLines = 23

$colors = @{
  Canvas = [Drawing.ColorTranslator]::FromHtml('#061221')
  Terminal = [Drawing.ColorTranslator]::FromHtml('#09192b')
  Title = [Drawing.ColorTranslator]::FromHtml('#10243d')
  Border = [Drawing.ColorTranslator]::FromHtml('#25557a')
  Prompt = [Drawing.ColorTranslator]::FromHtml('#41d9d3')
  Command = [Drawing.ColorTranslator]::FromHtml('#edf4ff')
  Output = [Drawing.ColorTranslator]::FromHtml('#b7c6d9')
  Muted = [Drawing.ColorTranslator]::FromHtml('#7f94ac')
  Success = [Drawing.ColorTranslator]::FromHtml('#74e0b4')
  Badge = [Drawing.ColorTranslator]::FromHtml('#124d63')
}

function Quote-ProcessArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-ProcessCapture {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{}
  )

  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $FilePath
  $info.Arguments = (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = [Text.Encoding]::UTF8
  $info.StandardErrorEncoding = [Text.Encoding]::UTF8
  foreach ($key in $Environment.Keys) { $info.EnvironmentVariables[$key] = $Environment[$key] }

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $info
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  [PSCustomObject]@{
    Status = $process.ExitCode
    Output = (($stdout + $stderr).TrimEnd() -replace "`r`n", "`n")
  }
}

function Invoke-Agenctx([string]$Project, [string[]]$Arguments) {
  $result = Invoke-ProcessCapture -FilePath $nodePath -Arguments (@($cliPath) + $Arguments) `
    -WorkingDirectory $Project -Environment @{ NO_COLOR = '1' }
  if ($result.Status -ne 0) {
    throw "agenctx $($Arguments -join ' ') failed:`n$($result.Output)"
  }
  return $result.Output
}

function Invoke-PowerShellDemo([string]$Project, [string]$Command) {
  $powershell = (Get-Command powershell.exe).Source
  $result = Invoke-ProcessCapture -FilePath $powershell `
    -Arguments @('-NoLogo', '-NoProfile', '-Command', $Command) `
    -WorkingDirectory $Project
  if ($result.Status -ne 0) { throw "PowerShell demo command failed:`n$($result.Output)" }
  return $result.Output
}

function New-DemoProject([string]$Name, [string]$Description) {
  $project = Join-Path $demoRoot $Name
  [void](New-Item -ItemType Directory -Path $project -Force)
  $package = [ordered]@{ name = $Name; description = $Description; version = '1.0.0' }
  [IO.File]::WriteAllText(
    (Join-Path $project 'package.json'),
    (($package | ConvertTo-Json) + "`n"),
    [Text.UTF8Encoding]::new($false)
  )
  return $project
}

function New-Step([string]$Command, [string]$Output, [int]$Hold = 1300) {
  [PSCustomObject]@{ Command = $Command; Output = $Output; Hold = $Hold }
}

function Get-HumanScenario {
  $project = New-DemoProject 'checkout-api' 'Checkout API service'
  $steps = New-Object Collections.Generic.List[object]

  $init = Invoke-Agenctx $project @('init')
  $steps.Add((New-Step 'agenctx init' $init 1100))

  $warning = Invoke-Agenctx $project @('add', 'warning', '--pin', 'Never edit generated API clients directly')
  $steps.Add((New-Step 'agenctx add warning --pin "Never edit generated API clients directly"' $warning 1000))

  $decision = Invoke-Agenctx $project @('add', 'decision', 'Use SQLite so local development stays self-contained')
  $steps.Add((New-Step 'agenctx add decision "Use SQLite so local development stays self-contained"' $decision 1000))

  $view = Invoke-Agenctx $project @('view')
  $steps.Add((New-Step 'agenctx view' $view 2200))

  [PSCustomObject]@{
    Name = 'agenctx-human-demo.gif'
    Title = 'agenctx / maintain context'
    Badge = 'REAL POWERSHELL'
    Steps = $steps
  }
}

function Get-GuidesScenario {
  $project = New-DemoProject 'payments-worker' 'Payments background worker'
  [void](Invoke-Agenctx $project @('init'))
  [void](Invoke-Agenctx $project @('add', 'testing', 'Run npm test before committing'))
  $steps = New-Object Collections.Generic.List[object]

  $dump = Invoke-Agenctx $project @('dump')
  $steps.Add((New-Step 'agenctx dump' $dump 1200))

  $listingCommand = "Get-ChildItem AGENTS.md,CLAUDE.md,.cursorrules | Select-Object Name,Length"
  $listing = Invoke-PowerShellDemo $project $listingCommand
  $steps.Add((New-Step $listingCommand $listing 1600))

  $previewCommand = 'Get-Content AGENTS.md -TotalCount 8'
  $preview = Invoke-PowerShellDemo $project $previewCommand
  $steps.Add((New-Step $previewCommand $preview 2000))

  [PSCustomObject]@{
    Name = 'agenctx-dump-demo.gif'
    Title = 'agenctx / generate agent guides'
    Badge = 'REAL POWERSHELL'
    Steps = $steps
  }
}

function Get-AuditScenario {
  $project = New-DemoProject 'auth-service' 'Authentication service'
  [void](Invoke-Agenctx $project @('init'))
  [void](Invoke-Agenctx $project @('add', 'warning', '--pin', 'Token rotation must update both stores atomically'))
  $steps = New-Object Collections.Generic.List[object]

  $started = Invoke-Agenctx $project @('--agent', 'start', 'Fix token rotation')
  $sessionId = [regex]::Match($started, 's-[0-9a-f]{6}').Value
  if (-not $sessionId) { throw 'Could not read the real session ID.' }
  $steps.Add((New-Step 'agenctx --agent start "Fix token rotation"' $started 1100))

  $view = Invoke-Agenctx $project @('view', 'warnings', "--session=$sessionId")
  $steps.Add((New-Step "agenctx view warnings --session=$sessionId" $view 1300))

  $ended = Invoke-Agenctx $project @('--agent', 'end', "--session=$sessionId")
  $receipt = [regex]::Match($ended, '(?m)^  Receipt: ([0-9a-f]{64})$').Groups[1].Value
  if (-not $receipt) { throw 'Could not read the real receipt hash.' }
  $steps.Add((New-Step "agenctx --agent end --session=$sessionId" $ended 1100))

  $status = Invoke-Agenctx $project @('status')
  $steps.Add((New-Step 'agenctx status' $status 1300))

  $shortHash = $receipt.Substring(0, 12)
  $trace = Invoke-Agenctx $project @('session', 'show', $shortHash)
  $steps.Add((New-Step "agenctx session show $shortHash" $trace 2400))

  [PSCustomObject]@{
    Name = 'agenctx-agent-demo.gif'
    Title = 'agenctx / inspect an agent trace'
    Badge = 'REAL POWERSHELL'
    Steps = $steps
  }
}

function Split-DisplayLines([string]$Text, [int]$Columns = 112) {
  $result = New-Object Collections.Generic.List[string]
  foreach ($line in ($Text -split "`n", -1)) {
    $clean = $line -replace "`t", '    '
    if ($clean.Length -eq 0) {
      $result.Add('')
      continue
    }
    while ($clean.Length -gt $Columns) {
      $result.Add($clean.Substring(0, $Columns))
      $clean = $clean.Substring($Columns)
    }
    $result.Add($clean)
  }
  return $result
}

function New-TerminalBitmap {
  param(
    [string]$Title,
    [string]$Badge,
    [object[]]$Lines,
    [string]$Typing = ''
  )

  $bitmap = New-Object Drawing.Bitmap $width, $height, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $graphics.Clear($colors.Canvas)

  $terminalBrush = New-Object Drawing.SolidBrush $colors.Terminal
  $titleBrush = New-Object Drawing.SolidBrush $colors.Title
  $borderPen = New-Object Drawing.Pen $colors.Border, 1
  $graphics.FillRectangle($terminalBrush, $terminalX, $terminalY, $terminalWidth, $terminalHeight)
  $graphics.FillRectangle($titleBrush, $terminalX, $terminalY, $terminalWidth, $titleHeight)
  $graphics.DrawRectangle($borderPen, $terminalX, $terminalY, $terminalWidth, $terminalHeight)

  $font = New-Object Drawing.Font 'Consolas', 15, ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
  $titleFont = New-Object Drawing.Font 'Consolas', 18, ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
  $badgeFont = New-Object Drawing.Font 'Consolas', 11, ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)
  $commandBrush = New-Object Drawing.SolidBrush $colors.Command
  $outputBrush = New-Object Drawing.SolidBrush $colors.Output
  $promptBrush = New-Object Drawing.SolidBrush $colors.Prompt
  $mutedBrush = New-Object Drawing.SolidBrush $colors.Muted

  $graphics.DrawString('>_', $titleFont, $promptBrush, 45, 43)
  $graphics.DrawString("PowerShell  |  $Title", $titleFont, $commandBrush, 82, 43)
  $graphics.DrawString('_   []   X', $titleFont, $mutedBrush, 1055, 43)

  $display = New-Object Collections.Generic.List[object]
  foreach ($line in $Lines) { $display.Add($line) }
  if ($Typing -ne '') {
    $display.Add([PSCustomObject]@{ Kind = 'command'; Text = $Typing; Cursor = $true })
  }
  if ($display.Count -gt $maxLines) {
    $display = [Collections.Generic.List[object]]($display.GetRange($display.Count - $maxLines, $maxLines))
  }

  $y = $contentY
  foreach ($line in $display) {
    if ($line.Kind -eq 'command') {
      $prompt = 'PS C:\demo> '
      $graphics.DrawString($prompt, $font, $promptBrush, $contentX, $y)
      $promptWidth = $graphics.MeasureString($prompt, $font).Width
      $graphics.DrawString($line.Text, $font, $commandBrush, $contentX + $promptWidth + 2, $y)
      if ($line.Cursor) {
        $textWidth = $graphics.MeasureString($line.Text, $font).Width
        $graphics.FillRectangle($promptBrush, $contentX + $promptWidth + $textWidth + 5, $y + 3, 8, 16)
      }
    } else {
      $brush = if ($line.Text -match '^(✓|  ✓|RECEIPT|  Receipt:)') { $promptBrush } else { $outputBrush }
      $graphics.DrawString($line.Text, $font, $brush, $contentX, $y)
    }
    $y += $lineHeight
  }

  $graphics.DrawString('Commands and output captured from the local agenctx CLI.', $font, $mutedBrush, 58, 626)

  $graphics.Dispose()
  foreach ($resource in @($terminalBrush, $titleBrush, $borderPen, $font, $titleFont, $badgeFont, $commandBrush, $outputBrush, $promptBrush, $mutedBrush)) {
    $resource.Dispose()
  }
  return $bitmap
}

function New-GifFrame([Drawing.Bitmap]$Bitmap, [int]$DelayMilliseconds, [bool]$First) {
  $stream = New-Object IO.MemoryStream
  $Bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
  $stream.Position = 0
  $decoder = New-Object Windows.Media.Imaging.PngBitmapDecoder(
    $stream,
    [Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
    [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  )
  $metadata = New-Object Windows.Media.Imaging.BitmapMetadata 'gif'
  $delay = [UInt16][Math]::Max(2, [Math]::Round($DelayMilliseconds / 10))
  $metadata.SetQuery('/grctlext/Delay', $delay)
  $metadata.SetQuery('/grctlext/Disposal', [byte]2)
  if ($First) {
    $metadata.SetQuery('/appext/Application', [byte[]][char[]]'NETSCAPE2.0')
    $metadata.SetQuery('/appext/Data', [byte[]](3, 1, 0, 0))
  }
  $frame = [Windows.Media.Imaging.BitmapFrame]::Create($decoder.Frames[0], $null, $metadata, $null)
  $stream.Dispose()
  return $frame
}

function Render-Scenario($Scenario) {
  $frames = New-Object Collections.Generic.List[object]
  $lines = New-Object Collections.Generic.List[object]

  $initial = New-TerminalBitmap $Scenario.Title $Scenario.Badge $lines ''
  $frames.Add([PSCustomObject]@{ Bitmap = $initial; Delay = 700 })

  foreach ($step in $Scenario.Steps) {
    $command = $step.Command
    $cuts = @(
      [Math]::Min($command.Length, [Math]::Max(1, [Math]::Floor($command.Length * 0.35))),
      [Math]::Min($command.Length, [Math]::Max(1, [Math]::Floor($command.Length * 0.7))),
      $command.Length
    ) | Select-Object -Unique

    foreach ($cut in $cuts) {
      $typing = $command.Substring(0, $cut)
      $bitmap = New-TerminalBitmap $Scenario.Title $Scenario.Badge $lines $typing
      $frames.Add([PSCustomObject]@{ Bitmap = $bitmap; Delay = 90 })
    }

    $lines.Add([PSCustomObject]@{ Kind = 'command'; Text = $command; Cursor = $false })
    $outputLines = Split-DisplayLines $step.Output
    for ($index = 0; $index -lt $outputLines.Count; $index += 4) {
      $end = [Math]::Min($index + 4, $outputLines.Count)
      for ($lineIndex = $index; $lineIndex -lt $end; $lineIndex++) {
        $lines.Add([PSCustomObject]@{ Kind = 'output'; Text = $outputLines[$lineIndex]; Cursor = $false })
      }
      $bitmap = New-TerminalBitmap $Scenario.Title $Scenario.Badge $lines ''
      $delay = if ($end -eq $outputLines.Count) { $step.Hold } else { 110 }
      $frames.Add([PSCustomObject]@{ Bitmap = $bitmap; Delay = $delay })
    }
    $lines.Add([PSCustomObject]@{ Kind = 'output'; Text = ''; Cursor = $false })
  }

  [void](New-Item -ItemType Directory -Path $outputRoot -Force)
  $outputPath = Join-Path $outputRoot $Scenario.Name
  if ($FfmpegPath) {
    $frameRoot = Join-Path $demoRoot ('frames-' + [IO.Path]::GetFileNameWithoutExtension($Scenario.Name))
    [void](New-Item -ItemType Directory -Path $frameRoot -Force)
    $manifest = New-Object Collections.Generic.List[string]
    for ($index = 0; $index -lt $frames.Count; $index++) {
      $framePath = Join-Path $frameRoot ('frame-{0:d4}.png' -f $index)
      $frames[$index].Bitmap.Save($framePath, [Drawing.Imaging.ImageFormat]::Png)
      $manifestPath = $framePath.Replace('\', '/')
      $manifest.Add("file '$manifestPath'")
      $manifest.Add(('duration {0:0.000}' -f ($frames[$index].Delay / 1000)))
    }
    $lastFramePath = (Join-Path $frameRoot ('frame-{0:d4}.png' -f ($frames.Count - 1))).Replace('\', '/')
    $manifest.Add("file '$lastFramePath'")
    $manifestPath = Join-Path $frameRoot 'frames.txt'
    [IO.File]::WriteAllLines($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))

    $filter = '[0:v]split[base][palette];[palette]palettegen=max_colors=64:reserve_transparent=0:stats_mode=diff[p];[base][p]paletteuse=dither=none:diff_mode=rectangle'
    & $FfmpegPath -v error -y -f concat -safe 0 -i $manifestPath -filter_complex $filter -loop 0 $outputPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
      throw "ffmpeg could not encode $($Scenario.Name)"
    }
  } else {
    $encoder = New-Object Windows.Media.Imaging.GifBitmapEncoder
    for ($index = 0; $index -lt $frames.Count; $index++) {
      $encoder.Frames.Add((New-GifFrame $frames[$index].Bitmap $frames[$index].Delay ($index -eq 0)))
    }
    $file = [IO.File]::Open($outputPath, [IO.FileMode]::Create)
    try { $encoder.Save($file) } finally { $file.Dispose() }
  }
  foreach ($item in $frames) { $item.Bitmap.Dispose() }

  $inputStream = [IO.File]::OpenRead($outputPath)
  try {
    $decoder = New-Object Windows.Media.Imaging.GifBitmapDecoder(
      $inputStream,
      [Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
      [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    )
    $frameCount = $decoder.Frames.Count
  } finally {
    $inputStream.Dispose()
  }

  if ($PreviewDirectory) {
    $previewRoot = [IO.Path]::GetFullPath($PreviewDirectory)
    [void](New-Item -ItemType Directory -Path $previewRoot -Force)
    $middleFrame = [int][Math]::Floor(([double]$frameCount) / 2)
    $lastFrame = ([int]$frameCount) - 1
    foreach ($frameIndex in @($middleFrame, $lastFrame)) {
      $pngEncoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
      $pngEncoder.Frames.Add($decoder.Frames[$frameIndex])
      $previewName = "{0}-{1}.png" -f [IO.Path]::GetFileNameWithoutExtension($Scenario.Name), $frameIndex
      $previewPath = Join-Path $previewRoot $previewName
      $previewFile = [IO.File]::Open($previewPath, [IO.FileMode]::Create)
      try { $pngEncoder.Save($previewFile) } finally { $previewFile.Dispose() }
    }
  }
  Write-Host "Rendered $($Scenario.Name): $frameCount frames, $((Get-Item $outputPath).Length) bytes"
}

try {
  [void](New-Item -ItemType Directory -Path $demoRoot -Force)
  $scenarios = @(
    Get-HumanScenario
    Get-GuidesScenario
    Get-AuditScenario
  )
  foreach ($scenario in $scenarios) { Render-Scenario $scenario }
} finally {
  $resolvedDemoRoot = [IO.Path]::GetFullPath($demoRoot)
  if ($resolvedDemoRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($resolvedDemoRoot).StartsWith('agenctx-demos-', [StringComparison]::Ordinal)) {
    Remove-Item -LiteralPath $resolvedDemoRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
