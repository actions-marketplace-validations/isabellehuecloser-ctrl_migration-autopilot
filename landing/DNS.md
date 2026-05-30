# DNS — brancher migration.useautopilot.dev (Cloudflare)

> Landing déjà live sur **https://migration-autopilot-landing.fly.dev**.
> Cert Fly pour `migration.useautopilot.dev` déjà créé sur l'app `migration-autopilot-landing`
> (status "Not verified" = attend juste le DNS ci-dessous, puis s'émet seul).

## Records à ajouter dans Cloudflare (zone useautopilot.dev)

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A    | `migration` | `66.241.125.199` | **DNS only (nuage GRIS)** |
| AAAA | `migration` | `2a09:8280:1::11d:4fbc:0` | **DNS only (nuage GRIS)** |

⚠️ **Nuage GRIS** (DNS only, pas orange/proxy). Le proxy Cloudflare casse la validation Let's Encrypt de Fly.

### Alternative 1 record : CNAME
| Type | Name | Value | Proxy |
|------|------|-------|-------|
| CNAME | `migration` | `migration-autopilot-landing.fly.dev` | DNS only (gris) |

## Après avoir ajouté les records → me prévenir
Je lance `fly certs check migration.useautopilot.dev -a migration-autopilot-landing` jusqu'à "Configured",
puis je bascule les meta OG/twitter vers le domaine propre et je redéploie.

(IPs sorties par `fly deploy` : IPv4 partagée 66.241.125.199, IPv6 dédiée 2a09:8280:1::11d:4fbc:0.)
