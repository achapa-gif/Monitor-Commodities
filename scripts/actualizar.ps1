# Actualiza el histórico semanal de precios de commodities y regenera los datos del dashboard.
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\actualizar.ps1

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$raiz      = Split-Path -Parent $PSScriptRoot
$config    = Get-Content (Join-Path $raiz 'config\series.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$dirDatos  = Join-Path $raiz 'data'
$historico = Join-Path $dirDatos 'historico.csv'
$salidaJs  = Join-Path $raiz 'dashboard\precios.js'
$bitacora  = Join-Path $dirDatos 'bitacora.log'
$utf8      = New-Object System.Text.UTF8Encoding($false)
$ua        = @{ 'User-Agent' = 'Mozilla/5.0' }

New-Item -ItemType Directory -Force $dirDatos | Out-Null

# Hora de Ciudad de México, aunque el equipo (por ejemplo, el servidor de GitHub) esté en UTC.
function Get-AhoraMx {
    try {
        $zona = [TimeZoneInfo]::FindSystemTimeZoneById('Central Standard Time (Mexico)')
        [TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $zona)
    } catch { Get-Date }
}

function Escribir-Bitacora($mensaje) {
    $linea = '{0}  {1}' -f (Get-AhoraMx).ToString('yyyy-MM-dd HH:mm:ss'), $mensaje
    Write-Host $linea
    Add-Content -Path $bitacora -Value $linea -Encoding UTF8
}

# Todas las observaciones se etiquetan con el viernes de su semana (semana lunes-viernes).
function Get-ViernesDeSemana([datetime]$fecha) {
    $dow = [int]$fecha.DayOfWeek            # domingo = 0
    $lunes = $fecha.Date.AddDays(-(($dow + 6) % 7))
    return $lunes.AddDays(4)
}

# Agrupa observaciones (diarias o semanales) en promedio semanal.
function ConvertTo-Semanal($observaciones) {
    $observaciones |
        Group-Object { (Get-ViernesDeSemana $_.fecha).ToString('yyyy-MM-dd') } |
        ForEach-Object {
            [pscustomobject]@{
                fecha = $_.Name
                valor = ($_.Group | Measure-Object -Property valor -Average).Average
            }
        }
}

# Fecha del último dato real de cada serie; nunca posterior al día de la actualización.
$script:cortes = @{}
function Set-Corte($id, [datetime]$fecha) {
    $hoyMx = (Get-AhoraMx).Date
    if ($fecha.Date -gt $hoyMx) { $fecha = $hoyMx }
    $script:cortes[$id] = $fecha.ToString('yyyy-MM-dd')
}

# ---------- Fuentes ----------

function Get-Yahoo($serie, $anios) {
    $ticker = [uri]::EscapeDataString($serie.ticker)
    $url = "https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${anios}y&interval=1wk"
    $r = Invoke-RestMethod -Uri $url -Headers $ua -TimeoutSec 60
    $res = $r.chart.result[0]
    # Fecha de corte = última operación real, no el viernes con que se etiqueta la semana.
    Set-Corte $serie.id ([DateTimeOffset]::FromUnixTimeSeconds([long]$res.meta.regularMarketTime).UtcDateTime)
    $cierres = $res.indicators.quote[0].close
    $obs = for ($i = 0; $i -lt $res.timestamp.Count; $i++) {
        if ($null -eq $cierres[$i]) { continue }
        # Yahoo marca la barra semanal al inicio de la semana (a veces domingo por la noche UTC):
        # sumar un día la deja dentro de la semana lunes-viernes correcta.
        $f = [DateTimeOffset]::FromUnixTimeSeconds($res.timestamp[$i]).UtcDateTime.AddDays(1)
        [pscustomobject]@{ fecha = $f; valor = [double]$cierres[$i] }
    }
    ConvertTo-Semanal $obs
}

# INEGI - Índice Nacional de Precios Productor (mensual). Se descargan todas las series INEGI en una sola petición.
$script:cacheInegi = $null
function Get-Inegi($serie, $anios) {
    if (-not $script:cacheInegi) {
        $ids = ($config.series | Where-Object fuente -eq 'inegi_inpp' | ForEach-Object { $_.serie_inegi }) -join ','
        $est = '1120019000400050'   # INPP > Bienes intermedios > genéricos, producción total
        $form = @{
            idEstructura = $est; cuadro = $est; cvEstructura = $est; _formato = 'CSV'
            _anioI = [string]((Get-Date).Year - $anios); _anioF = [string](Get-Date).Year
            _meta = '0'; _tipo = 'BIE'; _info = 'Indices'; _orient = 'vertical'; esquema = ''; st = ''; pf = 'inp'
            _series = "e|$ids,"
        }
        $r = Invoke-WebRequest 'https://www.inegi.org.mx/app/indicesdeprecios/Exportacion.aspx?INPtipoExporta=CSV' `
            -Method Post -Body $form -Headers $ua -UseBasicParsing -TimeoutSec 120
        $texto = [Text.Encoding]::GetEncoding(1252).GetString($r.RawContentStream.ToArray())
        $lineas = $texto -split "`r?`n"
        $iHead = [array]::FindIndex($lineas, [Predicate[string]] { param($l) $l -match '^"?Fecha"?,' })
        if ($iHead -lt 0) { throw 'Respuesta de INEGI sin encabezado "Fecha"' }
        $cols = ($lineas[$iHead] -replace '"', '') -split ','
        $meses = @{ Ene=1; Feb=2; Mar=3; Abr=4; May=5; Jun=6; Jul=7; Ago=8; Sep=9; Oct=10; Nov=11; Dic=12 }
        $script:cacheInegi = @{}
        foreach ($l in $lineas[($iHead + 1)..($lineas.Count - 1)]) {
            $c = ($l -replace '"', '') -split ','
            if ($c[0] -notmatch '^(\w{3}) (\d{4})$' -or -not $meses[$Matches[1]]) { continue }
            $fecha = '{0}-{1:00}-01' -f $Matches[2], $meses[$Matches[1]]
            for ($j = 1; $j -lt $cols.Count; $j++) {
                $v = 0.0
                if ([double]::TryParse($c[$j], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$v)) {
                    if (-not $script:cacheInegi[$cols[$j]]) { $script:cacheInegi[$cols[$j]] = New-Object System.Collections.ArrayList }
                    [void]$script:cacheInegi[$cols[$j]].Add([pscustomobject]@{ fecha = $fecha; valor = $v })
                }
            }
        }
    }
    $obs = $script:cacheInegi[[string]$serie.serie_inegi]
    if (-not $obs) { throw "INEGI no devolvió la serie $($serie.serie_inegi)" }
    Set-Corte $serie.id ([datetime]($obs | Select-Object -Last 1).fecha)   # primer día del último mes publicado
    $obs
}

# CNE - precio promedio nacional diario en estaciones de servicio (MXN/litro, con IVA).
# El archivo mensual trae toda la historia desde 2017; su URL cambia cada mes, así que se busca el más reciente.
function Get-CneDiesel($serie, $anios) {
    $base = 'https://www.cne.gob.mx/da/CNE/DATOS%20ABIERTOS%20(GASOLINAS%20Y%20DI%C3%89SEL)'
    $nombres = 'enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'
    $tmp = Join-Path $env:TEMP 'cne_precios.xlsx'
    $ok = $false
    for ($k = 0; $k -lt 14 -and -not $ok; $k++) {
        $d = (Get-Date).AddMonths(-$k)
        $mes = $nombres[$d.Month - 1]
        $archivo = "Precios_promedio_diarios_y_mensuales_en_estaciones_de_servicio_${mes}_$($d.Year).xlsx"
        $carpeta = $mes.Substring(0,1).ToUpper() + $mes.Substring(1)
        foreach ($url in "$base/$($d.Year)/$carpeta/$archivo", "$base/$archivo") {
            try { Invoke-WebRequest $url -Headers $ua -UseBasicParsing -OutFile $tmp -TimeoutSec 120; $ok = $true; break } catch {}
        }
    }
    if (-not $ok) { throw 'No se encontró el archivo de precios de la CNE de los últimos 14 meses' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($tmp)
    try {
        $leer = { param($n) $s = New-Object IO.StreamReader($zip.GetEntry($n).Open()); try { $s.ReadToEnd() } finally { $s.Close() } }
        $ss = [xml](& $leer 'xl/sharedStrings.xml')
        $strings = @($ss.sst.si | ForEach-Object { $_.InnerText })
        $hoja = [xml](& $leer 'xl/worksheets/sheet2.xml')   # "Cuadro 1.1": promedio nacional diario
    } finally { $zip.Dispose() }

    $col = $serie.columna_cne   # A=Fecha, B=Regular, C=Premium, D=Diésel
    $desde = (Get-Date).AddYears(-$anios)
    $obs = foreach ($row in $hoja.worksheet.sheetData.row) {
        $celdas = @{}
        foreach ($c in $row.c) {
            $v = $c.v; if ($null -eq $v) { continue }
            if ($c.t -eq 's') { $v = $strings[[int]$v] }
            $celdas[($c.r -replace '\d', '')] = $v
        }
        $f = $celdas['A']; $valor = 0.0
        if (-not $f -or -not [double]::TryParse($celdas[$col], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$valor)) { continue }
        if ($f -match '^(\d{4})-(\d{2})-(\d{2})') { $fecha = Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] }
        elseif ($f -match '^(\d{1,2})/(\d{1,2})/(\d{4})$') { $fecha = Get-Date -Year $Matches[3] -Month $Matches[2] -Day $Matches[1] }
        elseif ($f -match '^\d+(\.\d+)?$') { $fecha = [datetime]::FromOADate([double]$f) }
        else { continue }
        if ($fecha -ge $desde) { [pscustomobject]@{ fecha = $fecha; valor = $valor } }
    }
    if (-not $obs) { throw 'El archivo de la CNE no tiene datos legibles' }
    Set-Corte $serie.id ($obs | Measure-Object -Property fecha -Maximum).Maximum
    ConvertTo-Semanal $obs
}

# Banco Mundial - Pink Sheet (precios mensuales). La URL del archivo cambia con cada edición anual,
# así que se busca en la página de Commodity Markets; si falla, se usa la última URL que funcionó.
$script:cacheBM = $null
function Get-BancoMundial($serie, $anios) {
    if (-not $script:cacheBM) {
        $archivoUrl = Join-Path $dirDatos 'url_banco_mundial.txt'
        $url = $null
        try {
            $pag = Invoke-WebRequest 'https://www.worldbank.org/en/research/commodity-markets' -Headers $ua -UseBasicParsing -TimeoutSec 60
            $url = [regex]::Match($pag.Content, 'https?://[^"''\s]*CMO-Historical-Data-Monthly\.xlsx').Value
        } catch {}
        if (-not $url -and (Test-Path $archivoUrl)) { $url = (Get-Content $archivoUrl -Raw).Trim() }
        if (-not $url) { throw 'No se encontró la URL del Pink Sheet del Banco Mundial' }
        $tmp = Join-Path $env:TEMP 'banco_mundial_pink.xlsx'
        Invoke-WebRequest $url -Headers $ua -UseBasicParsing -OutFile $tmp -TimeoutSec 120
        Set-Content $archivoUrl $url -Encoding UTF8

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($tmp)
        try {
            $leer = { param($n) $s = New-Object IO.StreamReader($zip.GetEntry($n).Open()); try { $s.ReadToEnd() } finally { $s.Close() } }
            $strings = @(([xml](& $leer 'xl/sharedStrings.xml')).sst.si | ForEach-Object { $_.InnerText })
            # Localiza la hoja "Monthly Prices" por nombre, no por posición.
            $wb = & $leer 'xl/workbook.xml'; $rels = & $leer 'xl/_rels/workbook.xml.rels'
            $rid = [regex]::Match($wb, '<sheet [^>]*name="Monthly Prices"[^>]*r:id="([^"]+)"').Groups[1].Value
            $destino = [regex]::Match($rels, "<Relationship [^>]*Id=`"$rid`"[^>]*Target=`"([^`"]+)`"|<Relationship [^>]*Target=`"([^`"]+)`"[^>]*Id=`"$rid`"")
            $ruta = 'xl/' + (@($destino.Groups[1].Value, $destino.Groups[2].Value) | Where-Object { $_ } | Select-Object -First 1)
            $hoja = [xml](& $leer $ruta)
        } finally { $zip.Dispose() }

        $valorCelda = { param($c) if ($c.t -eq 's') { $strings[[int]$c.v] } else { $c.v } }
        $filas = @($hoja.worksheet.sheetData.row)
        $iHead = [array]::FindIndex($filas, [Predicate[object]] { param($f) @($f.c | ForEach-Object { & $valorCelda $_ }) -contains 'Zinc' })
        if ($iHead -lt 0) { throw 'El Pink Sheet no tiene la fila de encabezados esperada' }
        $columnas = @{}
        foreach ($c in $filas[$iHead].c) { $columnas[([string](& $valorCelda $c)).Trim()] = ($c.r -replace '\d', '') }
        $desde = (Get-Date).AddYears(-$anios)
        $script:cacheBM = @{ columnas = $columnas; filas = @() }
        foreach ($f in $filas[($iHead + 1)..($filas.Count - 1)]) {
            $celdas = @{}
            foreach ($c in $f.c) { $celdas[($c.r -replace '\d', '')] = & $valorCelda $c }
            if ($celdas['A'] -notmatch '^(\d{4})M(\d{2})$') { continue }
            $fecha = Get-Date -Year $Matches[1] -Month $Matches[2] -Day 1
            if ($fecha -lt $desde) { continue }
            $script:cacheBM.filas += , @{ fecha = $fecha.ToString('yyyy-MM-dd'); celdas = $celdas }
        }
    }
    $col = $script:cacheBM.columnas[$serie.columna_bm]
    if (-not $col) { throw "El Pink Sheet no tiene la columna '$($serie.columna_bm)'" }
    $obs = foreach ($f in $script:cacheBM.filas) {
        $v = 0.0
        if ([double]::TryParse($f.celdas[$col], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$v)) {
            [pscustomobject]@{ fecha = $f.fecha; valor = $v }
        }
    }
    if (-not $obs) { throw "Sin datos para '$($serie.columna_bm)'" }
    Set-Corte $serie.id ([datetime]($obs | Select-Object -Last 1).fecha)   # primer día del último mes publicado
    $obs
}

function Get-Serie($serie, $anios) {
    switch ($serie.fuente) {
        'yahoo'         { return Get-Yahoo $serie $anios }
        'banco_mundial' { return Get-BancoMundial $serie $anios }
        'inegi_inpp' { return Get-Inegi $serie $anios }
        'cne'        { return Get-CneDiesel $serie $anios }
        default { throw "Fuente desconocida: $($serie.fuente)" }
    }
}

# ---------- Histórico ----------

$datos = @{}   # clave "SERIE|fecha" -> valor
if (Test-Path $historico) {
    Import-Csv $historico -Encoding UTF8 | ForEach-Object {
        $datos["$($_.serie)|$($_.fecha)"] = [double]::Parse($_.valor, [Globalization.CultureInfo]::InvariantCulture)
    }
}

# Fechas de corte de la corrida anterior: se conservan si una fuente falla esta vez.
$archivoCortes = Join-Path $dirDatos 'cortes.json'
if (Test-Path $archivoCortes) {
    (Get-Content $archivoCortes -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $script:cortes[$_.Name] = $_.Value }
}

$todas = @($config.tipo_cambio) + @($config.series | Where-Object { $_.estado -ne 'pendiente' })
$errores = 0
foreach ($s in $todas) {
    try {
        $puntos = @(Get-Serie $s $config.historia_anios)
        foreach ($p in $puntos) { $datos["$($s.id)|$($p.fecha)"] = [double]$p.valor }
        Escribir-Bitacora ("OK    {0,-18} {1} datos, corte {2}" -f $s.id, $puntos.Count, $script:cortes[$s.id])
    } catch {
        $errores++
        Escribir-Bitacora ("ERROR {0,-18} {1} (se conserva el histórico previo)" -f $s.id, $_.Exception.Message)
    }
}

$inv = [Globalization.CultureInfo]::InvariantCulture
$filas = $datos.GetEnumerator() | ForEach-Object {
    $serie, $fecha = $_.Key -split '\|'
    [pscustomobject]@{ fecha = $fecha; serie = $serie; valor = $_.Value }
} | Sort-Object serie, fecha

$csv = New-Object System.Text.StringBuilder
[void]$csv.AppendLine('fecha,serie,valor')
foreach ($f in $filas) { [void]$csv.AppendLine(('{0},{1},{2}' -f $f.fecha, $f.serie, $f.valor.ToString('R', $inv))) }
[IO.File]::WriteAllText($historico, $csv.ToString(), $utf8)

# ---------- Datos para el dashboard ----------

$porSerie = $filas | Group-Object serie -AsHashTable -AsString
$hoy = (Get-AhoraMx).ToString('yyyy-MM-dd')
# Series sin corte registrado (históricos previos): se usa su último dato, acotado a hoy.
foreach ($id in $porSerie.Keys) {
    if (-not $script:cortes[$id]) {
        $ult = ($porSerie[$id] | Select-Object -Last 1).fecha
        $script:cortes[$id] = $(if ($ult -gt $hoy) { $hoy } else { $ult })
    }
}
$cortesOrd = [ordered]@{}
$script:cortes.Keys | Sort-Object | ForEach-Object { $cortesOrd[$_] = $script:cortes[$_] }
[IO.File]::WriteAllText($archivoCortes, ($cortesOrd | ConvertTo-Json), $utf8)

$salida = [ordered]@{
    actualizado = (Get-AhoraMx).ToString('yyyy-MM-dd HH:mm')
    tipos = $config.tipos
    familias = $config.familias
    commodities = $config.commodities
    tipo_cambio = [ordered]@{
        id = $config.tipo_cambio.id
        nombre = $config.tipo_cambio.nombre
        fuente_nombre = $config.tipo_cambio.fuente_nombre
        corte = $script:cortes[$config.tipo_cambio.id]
        puntos = @($porSerie[$config.tipo_cambio.id] | ForEach-Object { , @($_.fecha, [math]::Round($_.valor, 6)) })
    }
    series = @(foreach ($s in $config.series) {
        $meta = [ordered]@{}
        $s.PSObject.Properties | ForEach-Object { $meta[$_.Name] = $_.Value }
        $meta.corte = $script:cortes[$s.id]
        $meta.puntos = @($porSerie[$s.id] | ForEach-Object { , @($_.fecha, [math]::Round($_.valor, 6)) })
        $meta
    })
}
$json = $salida | ConvertTo-Json -Depth 8 -Compress
[IO.File]::WriteAllText($salidaJs, "window.PRECIOS = $json;", $utf8)

Escribir-Bitacora ("Listo: {0} registros en historico.csv, {1} errores" -f $filas.Count, $errores)
if ($errores -gt 0) { exit 1 }
