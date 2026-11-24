[CmdletBinding()]
param(
    [string]$DatasetPath,
    [string]$RunId,
    [string]$PythonExe = 'C:\Users\evilkoo\AppData\Local\Programs\Python\Python311\python.exe',
    [string]$NodeExe,
    [ValidateRange(1,300)][int]$StepTimeout = 120
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($DatasetPath)) {
    $DatasetPath = Join-Path $root 'data\flywire783-m1\sample.json'
}
if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw 'Existing Python required; no auto install' }
if ([string]::IsNullOrWhiteSpace($NodeExe)) { $NodeExe = (Get-Command node -CommandType Application -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw 'Existing Node required; no auto install' }
$oldPath = $env:PYTHONPATH
$oldUtf8 = $env:PYTHONUTF8
try {
    $env:PYTHONPATH = Join-Path $root 'src'
    $env:PYTHONUTF8 = '1'
    $cli = @('-m','flyvj_m3','--dataset',$DatasetPath,'--node-exe',$NodeExe,'--step-timeout',"$StepTimeout")
    if (-not [string]::IsNullOrWhiteSpace($RunId)) { $cli += @('--run-id',$RunId) }
    & $PythonExe @cli
    $code = $LASTEXITCODE
} finally {
    $env:PYTHONPATH = $oldPath
    $env:PYTHONUTF8 = $oldUtf8
}
exit $code
