# Walkthrough: Internal Marketing Messaging API

## Goal
Enable an external Python Backend (FastAPI) to trigger WhatsApp messages via the existing Node.js Middleware.

## Changes Implemented

### 1. New Internal API Endpoint
We added a secure endpoint to `index.js` that bypassing the webhook logic and directly invokes the WhatsApp API.

- **URL**: `POST /v1/send-message`
- **Security**: Protected by `x-internal-secret` header.
- **Payload**:
  ```json
  {
    "phone": "919999999999",
    "message": "Hello World",
    "media_url": "https://example.com/image.png" // Optional
  }
  ```

### 2. Environment Configuration
Added `INTERNAL_API_SECRET` to `.env`.
```properties
INTERNAL_API_SECRET=my_super_secret_key_123
```

### 3. Documentation for Backend Team
Created [backend_integration_spec.md](backend_integration_spec.md) detailed the database schema and exact API contract for the Python developers.

## Usage / Verification

To test the integration, we utilized the `Invoke-RestMethod` in PowerShell (simulating the Python backend request).

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/v1/send-message" `
  -Method Post `
  -Headers @{"x-internal-secret"="my_super_secret_key_123"} `
  -ContentType "application/json" `
  -Body '{"phone": "918143630515", "message": "Verification Successful!"}'
```

> [!IMPORTANT]
> **24-Hour Rule**: WhatsApp only allows free-form messages if the user has messaged the business within the last 24 hours. For pure marketing (cold outreach), you MUST use **Template Messages**. The current implementation supports text/media, which works for active sessions. For templates, the `sendMessage` logic in `config/whatsapp.js` will need to be extended to support `type: "template"`.

## Next Steps
- Share `docs/backend_integration_spec.md` with the backend team.
- Backend team implements the specified logic.
- Consider updating `send-message` to support **Templates** for cold marketing.
