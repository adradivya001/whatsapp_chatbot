# WhatsApp Chatbot - Docker Deployment Guide

## Quick Start

### 1. Clone and Configure
```bash
# Copy environment template
cp .env.example .env

# Edit with your credentials
nano .env
```

### 2. Build and Run with Docker Compose (Recommended)
```bash
# Build and start
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

### 3. Or Build and Run Manually
```bash
# Build the image
docker build -t whatsapp-chatbot .

# Run the container
docker run -d \
  --name whatsapp-chatbot \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  whatsapp-chatbot
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VERIFY_TOKEN` | ✅ | Webhook verification token (set in Meta Developer Console) |
| `WHATSAPP_TOKEN` | ✅ | WhatsApp Cloud API access token |
| `PHONE_NUMBER_ID` | ✅ | Your WhatsApp phone number ID |
| `SAKHI_API_URL` | ❌ | Backend API URL (default: `http://host.docker.internal:8000/sakhi/chat`) |
| `PORT` | ❌ | Server port (default: `3000`) |

---

## Production Deployment Checklist

- [ ] Set all environment variables in `.env`
- [ ] Configure reverse proxy (nginx/traefik) with HTTPS
- [ ] Update Meta webhook URL to your public domain
- [ ] Enable log rotation (already configured in docker-compose.yml)
- [ ] Set up monitoring/alerting for health endpoint

---

## Health Check

The container includes a health check endpoint:
```bash
curl http://localhost:3000/
# Returns: "WhatsApp webhook is running..."
```

---

## Useful Commands

```bash
# View container status
docker compose ps

# View real-time logs
docker compose logs -f whatsapp-chatbot

# Restart container
docker compose restart

# Rebuild after code changes
docker compose up -d --build

# Remove container and image
docker compose down --rmi local
```

---

## Network Configuration

If your Sakhi API is running on the **host machine**:
- Use `host.docker.internal` as the hostname (already configured in docker-compose.yml)

If running in **Docker network**:
```yaml
services:
  whatsapp-chatbot:
    environment:
      - SAKHI_API_URL=http://sakhi-backend:8000/sakhi/chat
    networks:
      - app-network
```

---

## Troubleshooting

### Container won't start
```bash
docker compose logs whatsapp-chatbot
```

### Sharp image processing errors
The Dockerfile includes `vips-dev` for Sharp. If issues persist:
```bash
docker compose build --no-cache
```

### Connection refused to Sakhi API
- Verify `SAKHI_API_URL` is correct
- If API is on host machine, use `host.docker.internal:8000`
- Check firewall allows port 8000
