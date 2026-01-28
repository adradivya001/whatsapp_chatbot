# Project Capabilities Report: WhatsApp Middleware

## Executive Summary
This project serves as the **central communication hub** (Middleware) for our business. It connects Meta's WhatsApp network with our internal systems (Support AI and Marketing Backend), ensuring a seamless flow of messages to and from our customers.

## Key Functionalities

### 1. 📞 Automated Customer Support (Inbound)
When a customer messages us on WhatsApp, this system handles it automatically:
*   **Listening**: It instantly receives any message sent by a user.
*   **AI Processing**: It forwards the user's query to our **Sakhi AI**.
*   **Smart Replies**: It delivers the AI's response back to the user on WhatsApp.
*   **Rich Media**: It can send images, buttons, and lists, not just plain text.

### 2. 📢 Marketing Campaigns (Outbound)
We can now proactively reach out to customers using our separate Marketing Dashboard (Python Backend). This middleware handles the delivery:
*   **Campaign Delivery**: The backend tells this system "Send this message to User A," and this system ensures it gets delivered.
*   **Intelligent Routing**:
    *   **Active Conversations**: If a user is already talking to us (within 24 hours), we can send them any **free-form text**.
    *   **Cold Outreach**: If we are contacting a user for the first time or after a long break, the system supports **Official Templates** (e.g., "Hello, we have a new offer") to comply with WhatsApp's rules.

### 3. 🔒 Security & Reliability
*   **Secure Channel**: The connection between our Marketing Backend and this Middleware is locked with a "Secret Key," ensuring no unauthorized sources can send messages.
*   **Billing Aware**: The system is designed to handle the specific requirements of WhatsApp's paid vs. free messaging windows.

## Current Status
*   ✅ **Inbound Support**: Working. Users can chat with the bot.
*   ✅ **Outbound API**: Working. The backend can successfully trigger messages.
*   ✅ **Template Support**: Working. ready for cold marketing (pending Meta billing setup).
