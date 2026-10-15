# Monitor de Commodities

Registro semanal de precios de leche, acero, aluminio, gas natural y diésel: referencia internacional y México.

## Uso

- **Actualizar y abrir:** doble clic en `actualizar.bat`. Descarga los datos, actualiza el histórico y abre el dashboard.
- **Solo ver:** abrir `dashboard\index.html` en el navegador.
- Actualización sin abrir el navegador (para programarla): `actualizar.bat /silencioso`

No requiere instalar nada; usa PowerShell de Windows.

## Publicación en GitHub Pages

- **Actualización y publicación diaria:** el flujo `.github/workflows/actualizar.yml` corre todos los días a las 7:00 am (hora de Ciudad de México). Descarga los precios, guarda el histórico en el repositorio y publica el dashboard en GitHub Pages.
- **Correrlo a mano:** pestaña **Actions** → **Actualizar y publicar dashboard** → **Run workflow**.
- **Clave de acceso:** si el repositorio tiene el secreto `CLAVE_DASHBOARD` (Settings → Secrets and variables → Actions), el sitio se publica cifrado y pide esa clave para abrirse; sin el secreto, se publica abierto. Para cambiar la clave, edita el secreto y corre el flujo.
- **Configuración necesaria:**
  - Settings → Pages → Source: **GitHub Actions**
  - Settings → Actions → General → Workflow permissions: **Read and write permissions**

## Archivos

| Ruta | Qué es |
|---|---|
| `config\series.json` | Series a seguir: fuente, ticker o clave, unidades y conversiones. Aquí se agregan o quitan series. |
| `scripts\actualizar.ps1` | Descarga las fuentes y regenera los datos. |
| `data\historico.csv` | Histórico acumulado (`fecha,serie,valor`) en unidad original. Si una fuente falla, se conservan los datos previos. |
| `data\bitacora.log` | Resultado de cada actualización. |
| `dashboard\` | Dashboard (`index.html`, `app.js`) y datos generados (`precios.js`). |

## Fuentes

| Commodity | Internacional (Yahoo Finance, semanal) | México |
|---|---|---|
| Leche | Clase III CME (`DC=F`), USD/cwt | INEGI INPP, leche sin pasteurizar (índice mensual) |
| Acero | HRC EE.UU. CME (`HRC=F`), USD/ton corta | INEGI INPP, lámina de acero y varilla corrugada (índices mensuales) |
| Aluminio | COMEX (`ALI=F`), USD/t | INEGI INPP, afinación y laminación de aluminio (índice mensual) |
| Gas natural | Henry Hub NYMEX (`NG=F`), USD/MMBtu | INEGI INPP, gas natural (índice mensual) |
| Diésel | ULSD NY Harbor NYMEX (`HO=F`), USD/galón | CNE, precio al público promedio nacional, MXN/litro (diario → semanal) |
| Tipo de cambio | USD/MXN (`MXN=X`) | |

### Universo de commodities

Se definen en `commodities` dentro de `config\series.json`. Cada uno lleva `familia` (energia, metales, agro), `prioridad` (1 = pantalla principal, 2 = sección secundaria), `relevancia` como insumo (alta, media, baja) y `sectores`.

| Familia | Prioritarios | Secundarios |
|---|---|---|
| Energía | Petróleo WTI, Gas natural Henry Hub, Diésel ULSD, Gasolina RBOB | |
| Metales | Acero HRC, Aluminio, Cobre | Zinc, Níquel (Banco Mundial, mensual) |
| Agropecuarios | Maíz, Trigo, Soya, Ganado bovino, Leche | Cerdo, Azúcar, Café, Fertilizantes (urea y DAP, Banco Mundial, mensual) |

### Alertas y riesgo de costo

- **Riesgo de costo (Alto / Moderado / Bajo):** se muestra como semáforo al inicio del dashboard y se calcula solo con la variación de 3 meses:
  - Alto: más de +10%
  - Moderado: de 0% a +10%
  - Bajo: menos de 0%

  El umbral está en `UMBRAL_ALTO` dentro de `dashboard\app.js`.

### Tipos de referencia

Cada serie en `config\series.json` lleva un campo `tipo`:

| `tipo` | Etiqueta | Ejemplo |
|---|---|---|
| `benchmark` | Benchmark internacional | Futuros CME / COMEX / NYMEX |
| `referencia_mx` | Referencia México | IPGN (pendiente), diésel TAR (pendiente) |
| `indice_inegi` | Índice de precios México / INEGI | INPP |
| `domestico` | Precio doméstico | Diésel al público (CNE) |

- **Series pendientes:** una serie con `"estado": "pendiente"` aparece en la ficha del panel como **Pendiente**, con su motivo. No se descarga y no se muestra ningún valor para ella. Para activarla, agrega su fuente y quita `estado`.
- **Precios e índices por separado:** en la vista **Precio**, cada panel grafica los precios (benchmark, referencia y doméstico) aparte de los índices INPP. En la vista **Índice base 100** todas las series se comparan juntas como tendencia.
- **Fecha de corte:** cada serie guarda la fecha real de su último dato en `data\cortes.json`, y nunca es posterior a la actualización.

Notas:
- Cada dato semanal se etiqueta con el viernes de su semana; la semana en curso puede estar incompleta.
- Las conversiones a unidades métricas y a MXN usan el tipo de cambio de la misma semana (ver `conversion` en `config\series.json`).
- Si en un panel las series tienen unidades distintas (por ejemplo, un precio contra un índice INPP), se comparan como índice base 100.
- El INPP de INEGI y el archivo de la CNE vienen de formularios y URLs públicos no documentados como API, así que pueden cambiar sin aviso. Si pasa, la bitácora mostrará `ERROR` en esa serie y el histórico se conserva.
- Resumen: una serie es "estable" si su cambio en el horizonte elegido queda dentro de ±3% (1 mes), ±5% (3 meses) o ±10% (12 meses).
