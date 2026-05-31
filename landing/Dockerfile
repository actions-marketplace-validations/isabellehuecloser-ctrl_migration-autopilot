FROM nginx:1.27-alpine

# Static smoke-test landing for migration.useautopilot.dev.
# Serves index.html (+ og.png once you add one); Fly terminates TLS.
COPY index.html /usr/share/nginx/html/index.html
COPY privacy.html /usr/share/nginx/html/privacy.html
COPY terms.html /usr/share/nginx/html/terms.html
COPY 404.html /usr/share/nginx/html/404.html
COPY og.png /usr/share/nginx/html/og.png
COPY favicon.png /usr/share/nginx/html/favicon.png
COPY hero.png /usr/share/nginx/html/hero.png
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1
