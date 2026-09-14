# Production Grade Deployment on GDCC

## Architecture
Internet/LINE → WAF or Reverse Proxy → Web/API VM → Private PostgreSQL VM. PostgreSQL port 5432 is allowed only from the Web/API private IP. Upload storage is mounted separately and included in backup. For multiple app instances, replace local upload volume with approved shared/object storage.

## Security controls included
- LINE ID token verification and webhook signature verification
- Webhook event deduplication
- Parameterized SQL, role-based staff access and audit logs
- Request ID and JSON structured logs
- CSP, HSTS, no-store API responses and rate limits
- Non-root container, read-only filesystem, dropped Linux capabilities
- Liveness/readiness probes, database timeouts and graceful shutdown
- Migration checksum tracking

## Deployment sequence
1. Provision private PostgreSQL and create a least-privilege application account.
2. Copy `.env.production.example` to `.env.production`; store secrets in an approved secret manager or restricted file mode 600.
3. Run `docker compose -f docker-compose.production.yml build`.
4. Run migration using a one-off container with the same environment.
5. Start the application and verify `/health/live` and `/health/ready`.
6. Install the hardened Nginx configuration and an approved TLS certificate.
7. Configure LIFF endpoint and LINE webhook URL; verify the webhook.
8. Perform smoke test, VA/PT, backup/restore test and owner acceptance before opening traffic.

## Operations
- Centralize JSON stdout/stderr logs and alert on HTTP 5xx, readiness failure, failed webhook events and disk usage.
- Backup PostgreSQL and uploads daily; copy encrypted backups to a different failure domain.
- Test restore quarterly or according to agency policy.
- Patch OS, container base image and dependencies on an approved schedule.
- Review inactive accounts, audit logs and access permissions periodically.

## Important limitations
This package is a production-oriented baseline, not automatic certification. The agency must still complete threat modeling, PDPA documents, data retention rules, VA/PT, load testing, DR testing, operational ownership and GDCC-specific approval.
