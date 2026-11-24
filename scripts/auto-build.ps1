[CmdletBinding()]
param(
    [ValidateSet('Verify','VerifyData')][string]$Mode = 'Verify',
    [string]$PythonExe,
    [string]$RunId,
    [string]$DatasetPath,
    [ValidateRange(1,300)][int]$StepTimeoutSeconds = 30
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$oldEnvironment = @{}
foreach ($name in @('PYTHONPATH','PYTHONUTF8','PYTHONNOUSERSITE','PYTHONDONTWRITEBYTECODE')) {
    $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$exitCode = 2
try {
    if (-not $PythonExe) {
        $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
        if (-not $launcher) { throw 'Python 3.11 not found. Supply -PythonExe; no automatic installation.' }
        $PythonExe = (& $launcher.Source -3.11 -c 'import sys; print(sys.executable)' | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $PythonExe) { throw 'Python 3.11 is unavailable. No automatic installation.' }
    }
    if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw 'Python executable does not exist.' }
    & $PythonExe -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 2)'
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or later is required.' }
    $env:PYTHONPATH = Join-Path $projectRoot 'src'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONNOUSERSITE = '1'
    $env:PYTHONDONTWRITEBYTECODE = '1'
    if ($PSBoundParameters.ContainsKey('DatasetPath') -and $Mode -ne 'VerifyData') { throw 'DatasetPath is only accepted by VerifyData.' }
    $subcommand = if ($Mode -eq 'VerifyData') { 'verify-data' } else { 'run' }
    $arguments = @('-X','utf8','-m','flyvj_m0',$subcommand,'--project-root',$projectRoot,'--step-timeout',[string]$StepTimeoutSeconds)
    if ($PSBoundParameters.ContainsKey('RunId')) { $arguments += @('--run-id',$RunId) }
    if ($PSBoundParameters.ContainsKey('DatasetPath')) { $arguments += @('--dataset',$DatasetPath) }
    & $PythonExe @arguments
    $exitCode = $LASTEXITCODE
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    $exitCode = 2
} finally {
    foreach ($name in $oldEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process')
    }
}
exit $exitCode