// Guarda el access token fuera de React, para que tanto los interceptores
// de axios (que no son componentes) como el AuthContext puedan leerlo/
// escribirlo desde el mismo lugar. Pese al nombre histórico "tokens", desde
// el cambio a cookie httpOnly (ver app/router/auth.py, hallazgo ALTA de la
// auditoría AppSec 2026-08-23) el backend ya no devuelve el refresh token en
// el body -- acá solo se guarda { access_token, token_type }.
//
// Nota sobre dónde se guarda: localStorage es legible por cualquier script
// que corra en la página. Antes ese riesgo alcanzaba también al refresh
// token (la pieza más sensible, de vida larga); ahora ese token está a
// salvo de un XSS del frontend porque nunca pasa por JavaScript. El access
// token que sigue viviendo acá tiene vida corta (15 min) precisamente para
// acotar el daño si se filtra.
const STORAGE_KEY = "novabyte_auth_tokens";

let tokensActuales = leerDeStorage();
const listeners = new Set();

function leerDeStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function avisarListeners() {
  for (const listener of listeners) {
    listener(tokensActuales);
  }
}

export function getTokens() {
  return tokensActuales;
}

export function setTokens(tokenResponse) {
  tokensActuales = tokenResponse;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokenResponse));
  avisarListeners();
}

export function clearTokens() {
  tokensActuales = null;
  localStorage.removeItem(STORAGE_KEY);
  avisarListeners();
}

// Permite que un componente (AuthContext) se entere si algo fuera de React
// (el interceptor de axios, al fallar un refresh) cerró la sesión.
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
