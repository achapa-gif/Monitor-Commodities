// Pantalla de acceso: descifra los datos y el código del dashboard con la clave (Web Crypto, en el navegador).
// La clave nunca sale del equipo; se recuerda solo durante la sesión de la pestaña.
(function () {
  'use strict';
  const C = window.CIFRADO;
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function descifrar(clave) {
    const te = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', te.encode(clave), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: b64(C.sal), iterations: C.iter, hash: 'SHA-256' }, base, 512));
    const kAes = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-CBC', false, ['decrypt']);
    const kMac = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const iv = b64(C.iv), datos = b64(C.datos);
    const firmado = new Uint8Array(iv.length + datos.length);
    firmado.set(iv); firmado.set(datos, iv.length);
    if (!await crypto.subtle.verify('HMAC', kMac, b64(C.mac), firmado)) throw new Error('clave');
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, kAes, datos));
  }

  function ejecutar(codigo) {
    const s = document.createElement('script');
    s.textContent = codigo;
    document.body.appendChild(s);
  }

  const estilo = document.createElement('style');
  estilo.textContent = `
    .candado { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; background: var(--page); }
    .candado form { width: 100%; max-width: 360px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
      padding: 28px 24px; box-shadow: 0 10px 40px rgba(0,0,0,.08); text-align: center; }
    .candado img { height: 52px; margin-bottom: 14px; }
    .candado h2 { font-size: 17px; margin: 0 0 4px; }
    .candado p { color: var(--ink-2); font-size: 13px; margin: 0 0 18px; }
    .candado input { width: 100%; font: inherit; font-size: 16px; padding: 11px 12px; border: 1px solid var(--border); border-radius: 10px;
      background: var(--surface); color: var(--ink); outline: none; }
    .candado input:focus { border-color: var(--axis); box-shadow: 0 0 0 3px var(--wash); }
    .candado button { width: 100%; margin-top: 12px; font: inherit; font-size: 15px; font-weight: 600; padding: 11px; border: 0; border-radius: 10px;
      background: var(--ink); color: var(--surface); cursor: pointer; }
    .candado button:disabled { opacity: .6; cursor: wait; }
    .candado .err { color: #d03b3b; font-size: 13px; min-height: 18px; margin-top: 10px; }`;
  document.head.appendChild(estilo);

  const capa = document.createElement('div');
  capa.className = 'candado';
  capa.innerHTML = `<form autocomplete="off">
      <img src="logo-escala-capital.png" alt="Escala Capital">
      <h2>Monitor de Commodities y Precios de Insumos</h2>
      <p>Acceso restringido. Escribe la clave para continuar.</p>
      <input type="password" placeholder="Clave de acceso" aria-label="Clave de acceso" required>
      <button type="submit">Entrar</button>
      <div class="err" role="alert"></div></form>`;
  document.body.appendChild(capa);
  const form = capa.querySelector('form'), input = capa.querySelector('input'),
        boton = capa.querySelector('button'), err = capa.querySelector('.err');

  async function entrar(clave, silencioso) {
    boton.disabled = true; err.textContent = '';
    try {
      const codigo = await descifrar(clave);
      try { sessionStorage.setItem('commodities.clave', clave); } catch (e) {}
      capa.remove();
      ejecutar(codigo);
    } catch (e) {
      try { sessionStorage.removeItem('commodities.clave'); } catch (x) {}
      if (!silencioso) { err.textContent = 'Clave incorrecta. Intenta de nuevo.'; input.select(); }
    } finally { boton.disabled = false; }
  }
  form.addEventListener('submit', e => { e.preventDefault(); entrar(input.value, false); });

  if (!window.crypto || !crypto.subtle) {
    err.textContent = 'Este navegador no permite abrir el dashboard. Usa una versión reciente de Chrome, Edge o Safari.';
    boton.disabled = true;
    return;
  }
  let guardada = null;
  try { guardada = sessionStorage.getItem('commodities.clave'); } catch (e) {}
  if (guardada) entrar(guardada, true); else input.focus();
})();
