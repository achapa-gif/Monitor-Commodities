# Arma la carpeta _sitio que se publica en GitHub Pages.
# Si existe la variable de entorno CLAVE_DASHBOARD (secreto de GitHub), los datos y el código del dashboard
# se cifran con esa clave (PBKDF2-SHA256 + AES-256-CBC + HMAC-SHA256) y la página pide la clave para abrirse.
# Sin la clave, el contenido cifrado no se puede leer, ni siquiera revisando el código fuente.
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\preparar_sitio.ps1

$ErrorActionPreference = 'Stop'
$raiz   = Split-Path -Parent $PSScriptRoot
$origen = Join-Path $raiz 'dashboard'
$sitio  = Join-Path $raiz '_sitio'
$utf8   = New-Object System.Text.UTF8Encoding($false)

if (Test-Path $sitio) { Remove-Item $sitio -Recurse -Force }
New-Item -ItemType Directory $sitio | Out-Null
Copy-Item (Join-Path $origen 'logo-escala-capital.png') $sitio

$html    = [IO.File]::ReadAllText((Join-Path $origen 'index.html'), [Text.Encoding]::UTF8)
$precios = [IO.File]::ReadAllText((Join-Path $origen 'precios.js'), [Text.Encoding]::UTF8)
$app     = [IO.File]::ReadAllText((Join-Path $origen 'app.js'), [Text.Encoding]::UTF8)
$clave   = $env:CLAVE_DASHBOARD
$scripts = '(?s)<script src="precios\.js"></script>\s*<script src="app\.js"></script>'
if ($html -notmatch $scripts) { throw 'index.html no tiene las etiquetas de script esperadas' }

if ([string]::IsNullOrEmpty($clave)) {
    Copy-Item (Join-Path $origen 'precios.js'), (Join-Path $origen 'app.js') $sitio
    [IO.File]::WriteAllText((Join-Path $sitio 'index.html'), $html, $utf8)
    Write-Host 'Sitio preparado SIN clave (acceso abierto).'
    exit 0
}

# --- Cifrado ---
$iter  = 200000
$plano = $utf8.GetBytes($precios + "`n;`n" + $app)
$rng   = [Security.Cryptography.RandomNumberGenerator]::Create()
$sal   = New-Object byte[] 16; $rng.GetBytes($sal)
$kdf   = New-Object Security.Cryptography.Rfc2898DeriveBytes($clave, $sal, $iter, [Security.Cryptography.HashAlgorithmName]::SHA256)
$bits  = $kdf.GetBytes(64)
$aes   = [Security.Cryptography.Aes]::Create()
$aes.Mode = [Security.Cryptography.CipherMode]::CBC
$aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
$aes.Key = [byte[]]$bits[0..31]
$aes.GenerateIV()
$iv    = $aes.IV
$cifra = $aes.CreateEncryptor().TransformFinalBlock($plano, 0, $plano.Length)
$hmac  = New-Object Security.Cryptography.HMACSHA256(, [byte[]]$bits[32..63])
$mac   = $hmac.ComputeHash([byte[]]($iv + $cifra))

$datos = [ordered]@{
    iter  = $iter
    sal   = [Convert]::ToBase64String($sal)
    iv    = [Convert]::ToBase64String($iv)
    mac   = [Convert]::ToBase64String($mac)
    datos = [Convert]::ToBase64String($cifra)
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $sitio 'datos.enc.js'), "window.CIFRADO = $datos;", $utf8)
Copy-Item (Join-Path $PSScriptRoot 'candado.js') $sitio

$html = [regex]::Replace($html, $scripts, '<script src="datos.enc.js"></script>' + "`n" + '<script src="candado.js"></script>')
$html = $html.Replace('<meta charset="utf-8">', '<meta charset="utf-8">' + "`n" + '<meta name="robots" content="noindex, nofollow">')
[IO.File]::WriteAllText((Join-Path $sitio 'index.html'), $html, $utf8)
Write-Host 'Sitio preparado CON clave (contenido cifrado).'
