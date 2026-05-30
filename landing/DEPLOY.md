# Déployer la landing de test — migration.useautopilot.dev

> But : page live pour mesurer la demande AVANT de coder l'app payante (Phase 0bis.A du playbook).

## Avant de déployer — 3 placeholders à remplir dans `index.html`

1. **Stripe** — crée un prix test **$1** dans ton Stripe LIVE → **Payment Link** → colle l'URL dans
   `data-stripe-link="REPLACE_WITH_STRIPE_CHECKOUT_LINK"` (sur le bouton #checkout).
   *(Rembourse le $1 sous 24h — c'est juste un test d'intention d'achat.)*
2. **Email** — crée un formulaire gratuit (Formspree / Tally / Buttondown) → colle l'endpoint dans
   `const FORM_ENDPOINT = ""` (en bas du fichier).
3. **Analytics** — colle ton snippet Plausible/Posthog dans le `<head>` pour compter
   impressions / emails / clics Stripe.

## Déployer (Fly, même méthode que useautopilot-landing)

```bash
cd migration-autopilot/landing
fly apps create migration-autopilot-landing --org personal   # 1x seulement
fly deploy --ha=false
fly certs create migration.useautopilot.dev --app migration-autopilot-landing
# -> Fly affiche les IP A/AAAA à ajouter
```

## DNS Cloudflare

Ajoute les records **A + AAAA** retournés par Fly, sur `migration` →
**nuage GRIS (DNS only, PAS proxy orange)** — sinon le certificat Let's Encrypt échoue.

```bash
fly certs check migration.useautopilot.dev --app migration-autopilot-landing   # poll jusqu'à "verified"
```

## Cibles (sur ~100 visiteurs dev qui matchent l'ICP)
- ≥10% laissent leur email
- ≥3% cliquent vers Stripe
- ≥1% paient le $1
- **<0.5% → STOP**, repenser le pitch ou la cible.

## Quand l'app payante existera
Cette landing statique sera remplacée par la vraie route `GET /` de `migration-autopilot-app`
(comme svelte/i18n). En attendant, elle suffit pour valider.
