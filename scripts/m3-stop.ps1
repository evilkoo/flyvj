[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SessionFile)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$sessionRoot=[IO.Path]::GetFullPath((Join-Path $root 'work\m3\sessions'))+[IO.Path]::DirectorySeparatorChar
$target=[IO.Path]::GetFullPath($SessionFile)
if(-not $target.StartsWith($sessionRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Session path outside owned workspace'}
$s=Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
if($s.app -ne 'M3' -or $s.scope -ne 'ONE_GENERATED_M3_BUNDLE_NO_FILE_PROXY'){throw 'Not an owned M3 session'}
$ownedPid=[int]$s.pid
$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$ownedPid)
if($null -eq $p){Write-Output 'M3 already stopped';return}
if($p.ExecutablePath -ne $s.executable -or $p.CommandLine -notlike '*-m flyvj_m3.serve*' -or $p.CommandLine -notlike ('*'+$target+'*') -or $p.CommandLine -notlike ('*'+$root+'*')){throw 'Process identity mismatch; no stop'}
Stop-Process -Id $ownedPid -ErrorAction Stop
Write-Output 'Owned M3 runtime stopped'
