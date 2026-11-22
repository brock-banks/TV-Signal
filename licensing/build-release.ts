// Build a protected, self-contained Windows release:  npm run release
// Output: release/Signal-<version>/ and release/Signal-<version>-windows-x64.zip
// The application code and web assets are encrypted into app.dat; only an activation code you issue unlocks them.
import fs from 'node:fs';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {loadVault} from './vendor.ts';
const core=createRequire(import.meta.url)('./core.cjs');

const ROOT=process.cwd();
const pkgJson=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
const version=`${pkgJson.version}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
const name=`Signal-${version}`,outRoot=path.join(ROOT,'release'),out=path.join(outRoot,name);
const crlf=(lines:string[])=>lines.join('\r\n')+'\r\n';
const step=(s:string)=>console.log('› '+s);

const vault=loadVault();
if(process.platform!=='win32')console.warn('Warning: building on '+process.platform+'; the bundled runtime and media binaries will be for this platform, not Windows.');

step('Building dashboard');execSync('npx vite build',{stdio:'inherit',cwd:ROOT});

step('Bundling server');
const serverBundle=await build({entryPoints:[path.join(ROOT,'licensing','app-entry.ts')],bundle:true,platform:'node',format:'cjs',target:'node24',external:['sharp','ffmpeg-static','ffprobe-static'],minify:true,write:false,legalComments:'none',logLevel:'error'});

step('Collecting web assets');
const assets:Record<string,string>={};
const walk=(dir:string,prefix:string)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,prefix+e.name+'/');else assets[prefix+e.name]=fs.readFileSync(p).toString('base64');}};
walk(path.join(ROOT,'dist','dashboard'),'dashboard/');
for(const f of fs.readdirSync(path.join(ROOT,'tv-player')))if(fs.statSync(path.join(ROOT,'tv-player',f)).isFile())assets['tv-player/'+f]=fs.readFileSync(path.join(ROOT,'tv-player',f)).toString('base64');

step('Encrypting application package');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const plain=Buffer.from(JSON.stringify({version,built:Date.now(),server:serverBundle.outputFiles[0].text,assets}));
fs.writeFileSync(path.join(out,'app.dat'),core.encryptPackage(vault.masterKey,plain));

step('Building loader');
await build({entryPoints:[path.join(ROOT,'licensing','loader.cjs')],bundle:true,platform:'node',format:'cjs',target:'node24',minify:true,outfile:path.join(out,'signal.cjs'),legalComments:'none',logLevel:'error',define:{__SIGNAL_PUBLIC_KEY__:JSON.stringify(vault.publicKeyPem),__SIGNAL_VERSION__:JSON.stringify(version)}});

step('Adding Node.js runtime '+process.version);
fs.copyFileSync(process.execPath,path.join(out,process.platform==='win32'?'node.exe':'node'));

step('Adding native media components');
const seen=new Set<string>();
const probeKeep=path.join('bin',process.platform,process.arch);
function copyPkg(dep:string){
 if(seen.has(dep))return;const src=path.join(ROOT,'node_modules',dep);if(!fs.existsSync(src))return;seen.add(dep);
 fs.cpSync(src,path.join(out,'node_modules',dep),{recursive:true,filter:(p:string)=>{
  if(dep!=='ffprobe-static')return true;const rel=path.relative(src,p);if(!rel.startsWith('bin'))return !rel.startsWith('tests');return probeKeep.startsWith(rel)||rel.startsWith(probeKeep);}});
 const pj=JSON.parse(fs.readFileSync(path.join(src,'package.json'),'utf8'));for(const d of Object.keys({...pj.dependencies,...pj.optionalDependencies}))copyPkg(d);
}
for(const d of ['sharp','ffmpeg-static','ffprobe-static'])copyPkg(d);

step('Writing setup scripts');
const w=(f:string,c:string)=>fs.writeFileSync(path.join(out,f),c);
w('start.bat',crlf(['@echo off','setlocal','cd /d "%~dp0"','title Signal signage server','"%~dp0node.exe" --env-file-if-exists="%~dp0.env" "%~dp0signal.cjs"','if errorlevel 1 pause']));
w('activate.bat',crlf(['@echo off','setlocal','cd /d "%~dp0"','if "%~1"=="" (','  echo Machine ID for this PC:','  "%~dp0node.exe" "%~dp0signal.cjs" --machine-id','  echo.','  echo Send this Machine ID to your Signal provider. Then run:','  echo   activate.bat ^<activation code^>','  echo or open http://localhost:3000 after start.bat and paste the code there.','  pause','  exit /b 0',')','"%~dp0node.exe" "%~dp0signal.cjs" --activate %*','pause']));
w('status.bat',crlf(['@echo off','"%~dp0node.exe" "%~dp0signal.cjs" --status','pause']));
w('Setup.cmd',crlf([
 '@echo off','setlocal EnableExtensions','title Signal setup','set "SRC=%~dp0"','set "DEST=%~1"','if "%DEST%"=="" set "DEST=C:\\Signal"',
 'echo Installing Signal %SIGNAL_VERSION% to "%DEST%"',
 'if exist "%DEST%\\license.key" echo Existing activation and data in "%DEST%" are kept.',
 'robocopy "%SRC%." "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XF Setup.cmd license.key .env /XD data >nul',
 'if errorlevel 8 (echo Copy failed. Run Setup.cmd again, or choose another folder: Setup.cmd D:\\Signal & pause & exit /b 1)',
 'if not exist "%DEST%\\.env" copy "%DEST%\\.env.example" "%DEST%\\.env" >nul',
 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath(\'Desktop\')+\'\\Signal.lnk\');$s.TargetPath=\'%DEST%\\start.bat\';$s.WorkingDirectory=\'%DEST%\';$s.Description=\'Start the Signal signage server\';$s.Save()" >nul 2>&1',
 'net session >nul 2>&1',
 'if not errorlevel 1 (',
 '  choice /M "Allow TVs on this private network to reach Signal on TCP port 3000 (Windows Firewall rule)"',
 '  if not errorlevel 2 powershell -NoProfile -Command "if(-not (Get-NetFirewallRule -DisplayName \'Signal signage TCP 3000\' -ErrorAction SilentlyContinue)){New-NetFirewallRule -DisplayName \'Signal signage TCP 3000\' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private -RemoteAddress LocalSubnet | Out-Null}"',
 ') else (',
 '  echo Tip: run Setup.cmd as administrator to add the private-network firewall rule for TVs, or see INSTALL.txt.',
 ')',
 'echo.','echo Installed. A "Signal" shortcut was added to the desktop.','echo.','echo Machine ID for this PC:',
 '"%DEST%\\node.exe" "%DEST%\\signal.cjs" --machine-id',
 'echo.','echo Next: send the Machine ID to your Signal provider, start Signal from the desktop shortcut,','echo then open http://localhost:3000 on this PC and paste the activation code.','pause'
]).replace('%SIGNAL_VERSION%',version));
w('register-startup.ps1',['param([string]$TaskName = \'Signal signage\')','$ErrorActionPreference = \'Stop\'','$dir = $PSScriptRoot','$action = New-ScheduledTaskAction -Execute (Join-Path $dir \'node.exe\') -Argument \'--env-file-if-exists=.env signal.cjs\' -WorkingDirectory $dir','$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)','$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries','Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description \'Signal signage server at user sign-in\' | Out-Null','Write-Host "Registered $TaskName. It runs at sign-in. Remove with: Unregister-ScheduledTask -TaskName \'$TaskName\'"'].join('\r\n')+'\r\n');
fs.copyFileSync(path.join(ROOT,'.env.example'),path.join(out,'.env.example'));
w('INSTALL.txt',crlf([
 `Signal ${version} — local digital signage`,'',
 'INSTALL','  1. Copy this folder (or the zip) to the PC that will run the screens, unzip it, and run Setup.cmd.','     Right-click > "Run as administrator" also adds the Windows Firewall rule TVs need (private networks only).','     Default folder: C:\\Signal  (or: Setup.cmd D:\\Signal)','  2. Setup shows this PC\'s Machine ID. Send it to your Signal provider.','  3. Start Signal with the desktop shortcut (start.bat).','  4. On this PC open http://localhost:3000 and paste the activation code you received.','     (Or run: activate.bat <code>)','  5. Create the administrator password, then follow Setup & help in the dashboard.','',
 'ACTIVATION','  * A code works only on the PC whose Machine ID it was issued for.','  * Reinstalling Windows or moving to another PC needs a new code.','  * The application is stored encrypted (app.dat) and cannot run or be read without a valid code.','  * status.bat shows the current activation.','',
 'SETTINGS','  Edit .env in the install folder (PORT, HOST, DATA_DIR, PUBLIC_URL, MAX_UPLOAD_MB). Keep DATA_DIR on a local disk.','  Media, playlists and settings are stored in DATA_DIR (default: the "data" folder). Back up that folder with Signal stopped.','',
 'START AUTOMATICALLY','  Run in PowerShell:  powershell -ExecutionPolicy Bypass -File register-startup.ps1   (starts at Windows sign-in)','',
 'UPDATING','  Run the new version\'s Setup.cmd with the same folder. Activation (license.key), .env and data are kept.','',
 'THIRD-PARTY','  Includes Node.js, sharp/libvips and FFmpeg/ffprobe binaries under their own licenses (see node_modules/*/LICENSE*).'
]));

step('Creating zip');
const zip=path.join(outRoot,`${name}-windows-x64.zip`);fs.rmSync(zip,{force:true});
const tarExe=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe'):'';
if(tarExe&&fs.existsSync(tarExe))execSync(`"${tarExe}" -a -c -f "${zip}" -C "${outRoot}" "${name}"`,{stdio:'inherit'});
else console.warn('Zip skipped (Windows tar.exe not found); distribute the folder instead.');

const size=(p:string):number=>fs.statSync(p).isDirectory()?fs.readdirSync(p).reduce((n,f)=>n+size(path.join(p,f)),0):fs.statSync(p).size;
console.log(`\nRelease ready:\n  ${out}  (${(size(out)/1e6).toFixed(0)} MB)\n  ${fs.existsSync(zip)?zip+'  ('+(fs.statSync(zip).size/1e6).toFixed(0)+' MB)':''}\n\nGive the customer the zip. Issue their code with:\n  npm run license -- issue --machine <their Machine ID> --customer "<name>"`);
