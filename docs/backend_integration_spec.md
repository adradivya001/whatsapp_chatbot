# WhatsApp Marketing System - Backend Integration Spec

## Overview
This document defines the responsibilities and implementation details for the **Python FastAPI Backend** (`http://localhost:8000`) to enable WhatsApp marketing messages. The backend acts as the "Brain", managing users and campaigns, while the existing Node.js application acts as the "Middleware" to communicate with Meta's WhatsApp API.

## 1. Database Schema (Supabase)
Your backend must manage the following tables in Supabase to track marketing efforts.

### `users`
Stores potential recipients of marketing messages.
```sql
create table users (
  id uuid default uuid_generate_v4() primary key,
  phone_number text not null unique, -- Format: E.164 (e.g., +919999999999)
  display_name text,
  tags jsonb default '[]'::jsonb,    -- Array of tags e.g., ["premium", "interested_in_ivf"]
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
```

### `campaigns`
Manages marketing blasts.
```sql
create table campaigns (
  id uuid default uuid_generate_v4() primary key,
  name text not null,                -- Internal name e.g., "Diwali Offer 2025"
  message_template text not null,    -- The text message to send
  media_url text,                    -- Optional image/video URL
  target_tags jsonb default '[]'::jsonb, -- Send only to users with these tags. If empty, send to all.
  status text check (status in ('draft', 'scheduled', 'processing', 'completed', 'failed')),
  scheduled_at timestamp with time zone, -- When to send
  created_at timestamp with time zone default now()
);
```

### `message_logs`
Tracks the status of individual messages sent.
```sql
create table message_logs (
  id uuid default uuid_generate_v4() primary key,
  campaign_id uuid references campaigns(id),
  user_id uuid references users(id),
  phone_number text not null,
  status text check (status in ('queued', 'sent', 'failed')),
  sent_at timestamp with time zone default now(),
  error_message text
);
```

---

## 2. Backend Logic (FastAPI Responsibilities)

The FastAPI backend needs to implement the "Manager" logic:

### A. API Endpoints to Build
1.  **`POST /users`**: Add or update subscribers (e.g. from a website form).
2.  **`POST /campaigns`**: Create a new marketing campaign.
3.  **`POST /campaigns/{id}/send`**: Manually trigger a campaign immediately.

### B. The "Sending" Logic (Background Worker)
When a campaign is triggered (either by schedule or manual API call), the backend implementation must:
1.  **Fetch Users**: Query the `users` table for matching records (filtering by `target_tags` if needed).
2.  **Iterate & Send**: For each user:
    *   Call the Node.js Middleware (see Section 3 below).
    *   Create a record in `message_logs` with status `sent` (if successful) or `failed`.
3.  **Update Campaign**: Set `campaigns.status` to `completed`.

---

## 3. Integration Interface (How to talk to Node.js)

The Node.js middleware will expose a **protected internal endpoint** for you to push messages.

### Request Details
*   **Method**: `POST`
*   **URL**: `http://localhost:3000/v1/send-message` (or your deployed domain)
*   **Headers**:
    *   `Content-Type`: `application/json`
    *   `x-internal-secret`: `YOUR_SECURE_SECRET` (Must match the `INTERNAL_API_SECRET` in Node.js `.env`)

### Payload Schema
```json
{
  "phone": "+919876543210",
  "message": "Hello! Check out our new IVF plans.",
  "media_url": "https://example.com/brochure.pdf"  // Optional
}
```

### Response
*   **200 OK**: `{ "status": "success", "messageId": "..." }`
*   **400 Bad Request**: Invalid inputs.
*   **401 Unauthorized**: Wrong secret.

### Example Python Code (for your FastAPI Service)
```python
import requests

MIDDLEWARE_URL = "http://localhost:3000/v1/send-message"
INTERNAL_SECRET = "super_secret_key_123"

def send_whatsapp_marketing(phone, text, media_url=None):
    payload = {
        "phone": phone,
        "message": text
    }
    if media_url:
        payload["media_url"] = media_url

    headers = {
        "x-internal-secret": INTERNAL_SECRET
    }

    try:
        response = requests.post(MIDDLEWARE_URL, json=payload, headers=headers)
        response.raise_for_status()
        return True
    except Exception as e:
        print(f"Failed to send to {phone}: {e}")
        return False
```
