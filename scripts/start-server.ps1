$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$nodePath = 'G:\Scripts\node.exe'
$vitePath = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$stdoutPath = Join-Path $projectRoot 'vite.log'
$stderrPath = Join-Path $projectRoot 'vite-error.log'

$process = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @($vitePath, '--host', '127.0.0.1', '--port', '4173', '--strictPort') `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

Set-Content -LiteralPath (Join-Path $projectRoot '.vite.pid') -Value $process.Id -Encoding ascii
Write-Output $process.Id
