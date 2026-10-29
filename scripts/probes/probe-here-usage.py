#!/usr/bin/env python3
"""Lee el consumo facturable de HERE por la API de Usage (Cost Management v2), para que la
revisión del experimento de facturación no dependa del portal (pedido del PO, 2026-10-20).

Flujo:
  1. Token OAuth 2.0 de HERE con credenciales de cliente (access key id + secret de la app),
     firmado HMAC-SHA256 al estilo OAuth 1.0a, como exige account.api.here.com/oauth2/token.
  2. GET https://usage.bam.api.here.com/v2/usage/realms/{realmId}?startDate&endDate&appId
  3. Imprime el JSON crudo recortado y, si la forma coincide con la documentada (ítems por
     feature con usageValue/billableValue), una tabla por fecha y feature.

Env: HERE_ACCESS_KEY_ID, HERE_ACCESS_KEY_SECRET (secretos), HERE_REALM_ID (org; si falta se
     deriva con GET account.api.here.com/user/me), HERE_APP_ID,
     USAGE_START (YYYY-MM-DD, default 2026-10-20), USAGE_END (default hoy UTC).
Sin credenciales: sale con código 2 y mensaje claro; no inventa datos.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.parse
import urllib.request

TOKEN_URL = "https://account.api.here.com/oauth2/token"
USAGE_URL = "https://usage.bam.api.here.com/v2/usage/realms/{realm}"
UA = "booster-ai-probe/1.0 (dev@boosterchile.com)"


def _q(s: str) -> str:
    return urllib.parse.quote(s, safe="~")


def token(key_id: str, key_secret: str) -> str:
    oauth = {
        "oauth_consumer_key": key_id,
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA256",
        "oauth_timestamp": str(int(time.time())),
        "oauth_version": "1.0",
    }
    body = {"grant_type": "client_credentials"}
    todos = {**oauth, **body}
    params = "&".join(f"{_q(k)}={_q(v)}" for k, v in sorted(todos.items()))
    base = "&".join(("POST", _q(TOKEN_URL), _q(params)))
    key = f"{_q(key_secret)}&"
    sig = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha256).digest()).decode()
    oauth["oauth_signature"] = sig
    header = "OAuth " + ",".join(f'{k}="{_q(v)}"' for k, v in oauth.items())
    req = urllib.request.Request(
        TOKEN_URL, data=urllib.parse.urlencode(body).encode(), method="POST",
        headers={"Authorization": header, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"token HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")
    tok = j.get("access_token")
    if not tok:
        raise SystemExit(f"token sin access_token: {json.dumps(j)[:300]}")
    return tok


def realm_de_la_cuenta(tok: str) -> str:
    """GET /user/me con el token: la respuesta trae el realm (org) de la cuenta."""
    req = urllib.request.Request("https://account.api.here.com/user/me", headers={"Authorization": f"Bearer {tok}", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"user/me HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")
    realm = j.get("realm") or j.get("realmId") or ""
    if not realm:
        raise SystemExit(f"user/me sin campo realm; claves: {list(j.keys())}. Cargar HERE_REALM_ID a mano.")
    return str(realm)


def main() -> int:
    key_id = os.environ.get("HERE_ACCESS_KEY_ID", "")
    key_secret = os.environ.get("HERE_ACCESS_KEY_SECRET", "")
    realm = os.environ.get("HERE_REALM_ID", "")
    app_id = os.environ.get("HERE_APP_ID", "")
    if not (key_id and key_secret):
        print("faltan HERE_ACCESS_KEY_ID / HERE_ACCESS_KEY_SECRET", file=sys.stderr)
        return 2
    start = os.environ.get("USAGE_START", "2026-10-20")
    end = os.environ.get("USAGE_END") or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")

    tok = token(key_id, key_secret)
    if not realm:
        # Sin HERE_REALM_ID: el realm (org) se deriva de la cuenta dueña de las credenciales.
        realm = realm_de_la_cuenta(tok)
        print(f"realm derivado de la cuenta: {realm}")
    params = {"startDate": start, "endDate": end}
    if app_id:
        params["appId"] = app_id
    url = USAGE_URL.format(realm=urllib.parse.quote(realm, safe="")) + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")
            code = r.status
    except urllib.error.HTTPError as e:
        print(f"usage HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:600]}")
        return 1
    print(f"== usage {start} → {end} appId={app_id or '(todas)'} → HTTP {code} ==")
    out = os.environ.get("OUT_DIR", "./probe-out")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "here-usage.json"), "w", encoding="utf-8") as f:
        f.write(raw)
    try:
        j = json.loads(raw)
    except json.JSONDecodeError:
        print(raw[:1500])
        return 1
    print("claves de primer nivel:", list(j.keys()) if isinstance(j, dict) else type(j).__name__)
    # Forma documentada: items[] con feature/serviceName, usageValue, billableValue y fecha.
    items = j.get("items") if isinstance(j, dict) else j
    if isinstance(items, list) and items:
        print(f"{'fecha':<12} {'feature/servicio':<40} {'usage':>10} {'billable':>10}")
        for it in items:
            fecha = str(it.get("date") or it.get("startDate") or it.get("period") or "")[:10]
            feat = str(it.get("featureName") or it.get("feature") or it.get("serviceName") or it.get("sku") or "?")
            uso = it.get("usageValue", it.get("usage", ""))
            fact = it.get("billableValue", it.get("billable", ""))
            print(f"{fecha:<12} {feat:<40} {str(uso):>10} {str(fact):>10}")
    else:
        print(json.dumps(j, ensure_ascii=False, indent=1)[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
