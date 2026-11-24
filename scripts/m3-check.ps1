[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
foreach($name in @('m3-build.ps1','m3-start.ps1','m3-stop.ps1','m3-check.ps1')){
 $path=Join-Path $PSScriptRoot $name
 $tokens=$null;$parseErrors=$null
 [System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors) | Out-Null
 if($parseErrors.Count -gt 0){$parseErrors | ForEach-Object {Write-Output $_.Message};exit 1}
}
Write-Output 'M3_POWERSHELL_SYNTAX_PASSED'
exit 0
