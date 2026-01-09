# WhatsApp Template Messaging Specification (Cold Marketing)

## Overview
This document describes how to send **Template Messages** via the Node.js middleware. Templates are required for messaging users outside the 24-hour session window (e.g., first-time users, cold outreach).

## What Are Templates?
Templates are pre-approved message formats registered with Meta. They can contain:
- **Static Text**: Fixed copy approved by Meta.
- **Dynamic Variables**: Placeholders like `{{1}}`, `{{2}}` for personalization (e.g., names, dates, codes).

> [!IMPORTANT]
> You **cannot** send arbitrary text for cold marketing. You must use a template approved in your Meta Business Manager.

---

## API Contract

### Endpoint
`POST /v1/send-message` (same as before, extended payload)

### Headers
```
Content-Type: application/json
x-internal-secret: YOUR_INTERNAL_SECRET
```

### Payload Schema
```json
{
  "phone": "+919999999999",
  "template_name": "hello_world",
  "language_code": "en_US",
  "components": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | Yes | Recipient phone number (E.164 format) |
| `template_name` | string | Yes | Name of the approved template |
| `language_code` | string | Yes | Template language (e.g., "en_US", "hi") |
| `components` | array | No | Dynamic variable values (see below) |

### Components Structure (For Dynamic Templates)
If your template has placeholders like `Hello {{1}}, your code is {{2}}`, you must provide values:

```json
{
  "phone": "+919999999999",
  "template_name": "otp_notification",
  "language_code": "en",
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Aditya" },
        { "type": "text", "text": "123456" }
      ]
    }
  ]
}
```

---

## Example: Sending "hello_world" Template

The `hello_world` template is a default test template available in all WhatsApp Business accounts.

### PowerShell Command
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/v1/send-message" `
  -Method Post `
  -Headers @{"x-internal-secret"="my_super_secret_key_123"} `
  -ContentType "application/json" `
  -Body '{"phone": "918143630515", "template_name": "hello_world", "language_code": "en_US"}'
```

### Expected Response
```json
{ "status": "success", "phone": "918143630515" }
```

---

## Python Example (For Backend Integration)
```python
import requests

MIDDLEWARE_URL = "http://localhost:3000/v1/send-message"
INTERNAL_SECRET = "my_super_secret_key_123"

def send_marketing_template(phone, template_name, language_code="en_US", components=None):
    payload = {
        "phone": phone,
        "template_name": template_name,
        "language_code": language_code,
    }
    if components:
        payload["components"] = components

    headers = {"x-internal-secret": INTERNAL_SECRET}

    response = requests.post(MIDDLEWARE_URL, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()

# Usage
send_marketing_template("+919876543210", "hello_world", "en_US")
```
