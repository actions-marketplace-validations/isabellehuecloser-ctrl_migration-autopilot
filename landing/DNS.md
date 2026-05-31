# DNS — migration.useautopilot.dev (Cloudflare)

Fly app `migration-autopilot-landing`. Cert créé, status "Not verified" — attend ces 2 records.

## Records à ajouter dans Cloudflare

Dashboard Cloudflare → zone **useautopilot.dev** → **DNS** → **Add record**, 2 fois :

| Type | Name        | Content (IPv4/IPv6)        | Proxy status        | TTL  |
|------|-------------|----------------------------|---------------------|------|
| A    | `migration` | `66.241.125.199`           | **DNS only (gris)** | Auto |
| AAAA | `migration` | `2a09:8280:1::11d:4fbc:0`  | **DNS only (gris)** | Auto |

⚠️ **Nuage GRIS (DNS only), PAS orange (Proxied)** — sinon le cert Let's Encrypt de Fly échoue.

## Après avoir ajouté les records
Dis "DNS fait" → je lance `fly certs check` jusqu'à "verified", puis bascule OG/canonical de la
landing vers https://migration.useautopilot.dev et redéploie.

Propagation : souvent <5 min en DNS-only, parfois jusqu'à 1h.
