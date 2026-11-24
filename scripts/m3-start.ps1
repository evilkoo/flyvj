[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$RunId,[switch]$NoBrowser,[ValidateRange(0,65535)][int]$Port=54654,[ValidateRange(10,7200)][int]$IdleSeconds=7200,[string]$PythonExe='C:\Users\evilkoo\AppData\Local\Programs\Python\Python311\python.exe')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if($RunId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'){throw 'Safe run ID required'}
$run=Join-Path $root ('work\runs\'+$RunId)
$console=Join-Path $run 'console.html'
if(-not(Test-Path -LiteralPath $console)){throw 'Build M3 first; no auto install/build'}
if(-not(Test-Path -LiteralPath $PythonExe -PathType Leaf)){throw 'Existing Python required'}
foreach($relative in @('work','work\m3','work\m3\sessions')){
 $candidateDir=Join-Path $root $relative
 if((Test-Path -LiteralPath $candidateDir) -and ((Get-Item -LiteralPath $candidateDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Runtime directory must not be a reparse point'}
}
$dir=Join-Path $root 'work\m3\sessions'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
# Reuse only our exact executable/GUID-receipt/run/bundle. Never stop another process occupying the port.
if($Port -gt 0){
 $idleMismatchReceipt=$null
 $expectedHash=(Get-FileHash -LiteralPath $console -Algorithm SHA256).Hash.ToLowerInvariant()
 foreach($file in @(Get-ChildItem -LiteralPath $dir -Filter '*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 50)){
  try{
   $s=Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
   if($s.app -ne 'M3' -or $s.scope -ne 'ONE_GENERATED_M3_BUNDLE_NO_FILE_PROXY' -or [int]$s.port -ne $Port -or [IO.Path]::GetFullPath([string]$s.console) -ne [IO.Path]::GetFullPath($console)){continue}
   $p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$s.pid)
   if($null -eq $p -or $p.ExecutablePath -ne $s.executable -or -not $p.CommandLine.Contains('-m flyvj_m3.serve') -or -not $p.CommandLine.Contains($file.FullName) -or -not $p.CommandLine.Contains($root)){continue}
   $url='http://127.0.0.1:'+ $Port +'/'
   $h=(Invoke-WebRequest -Uri ($url+'health') -UseBasicParsing -TimeoutSec 2).Content | ConvertFrom-Json
   if($h.run_id -ne $RunId -or $h.bundle_sha256 -ne $expectedHash){continue}
   if([int]$s.idle_seconds -ne $IdleSeconds){$idleMismatchReceipt=$file.FullName;continue}
   Write-Output ('M3: '+$url);Write-Output ('Session: '+$file.FullName);Write-Output 'Existing owned runtime reused'
   if(-not $NoBrowser){Start-Process -FilePath $url -WindowStyle Hidden | Out-Null}
   return
  }catch{}
 }
 if($null -ne $idleMismatchReceipt){throw ('Existing owned runtime idle setting differs; stop it explicitly using m3-stop.ps1 -SessionFile '+$idleMismatchReceipt)}
}
$id=[Guid]::NewGuid().ToString('N');$receipt=Join-Path $dir ($id+'.json')
$out=Join-Path $dir ($id+'.stdout.log');$err=Join-Path $dir ($id+'.stderr.log')
$old=$env:PYTHONPATH;$process=$null
try{
 $env:PYTHONPATH=Join-Path $root 'src'
 $args=@('-m','flyvj_m3.serve','--run-dir',('"'+$run+'"'),'--session-file',('"'+$receipt+'"'),'--port',"$Port",'--idle-seconds',"$IdleSeconds")
 $process=Start-Process -FilePath $PythonExe -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
 $session=$null
 for($i=0;$i -lt 60 -and $null -eq $session;$i++){
  if($process.HasExited){throw ('Runtime start failed; see '+$err)}
  if(Test-Path -LiteralPath $receipt){
   try{
    $candidate=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
    if($candidate.app -eq 'M3' -and [int]$candidate.pid -eq $process.Id -and $candidate.scope -eq 'ONE_GENERATED_M3_BUNDLE_NO_FILE_PROXY' -and $candidate.url -match '^http://127\.0\.0\.1:[0-9]+/$'){$session=$candidate}
   }catch{}
  }
  if($null -eq $session){Start-Sleep -Milliseconds 100}
 }
 if($null -eq $session){
  if(-not $process.HasExited){$process.Kill()};throw ('Runtime readiness timed out; see '+$err)
 }
 Write-Output ('M3: '+$session.url);Write-Output ('Session: '+$receipt)
 if(-not $NoBrowser){Start-Process -FilePath $session.url -WindowStyle Hidden | Out-Null}
}catch{
 if($null -ne $process -and -not $process.HasExited){$process.Kill()}
 throw
}finally{$env:PYTHONPATH=$old}
