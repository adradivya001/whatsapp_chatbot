Deployment guide — Build locally, push to GitHub, deploy to Cloud Run

1) Local build & run (quick smoke test)

```powershell
cd /d d:\Ottobon\whatsapp-chatbot\whatsapp-chatbot
# build locally (requires Docker)
docker build -t sakhi-bot .

# run (map port and pass .env)
docker run --rm -p 3000:3000 --env-file .env --name sakhi-bot sakhi-bot

# test webhook handler locally
curl -X POST "http://localhost:3000/webhook" -H "Content-Type: application/json" -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"919281011683","text":{"body":"Hello test"},"type":"text"}]}}]}]}'
```

2) Prepare Google Cloud

- Create a service account with roles: `Cloud Run Admin`, `Storage Admin` (or `Storage Object Admin`), and `Cloud Build Editor` or `Cloud Build Service Account` permissions.
- Download the service account JSON key and save it locally.
- In your GitHub repository settings -> Secrets -> Actions, add these secrets:
  - `GCP_SA_KEY` — contents of the service account JSON file
  - `GCP_PROJECT` — your GCP project id
  - `GCP_REGION` — e.g. `us-central1`
  - `VERIFY_TOKEN` — `aditya_token` (or whichever you use)
  - `WHATSAPP_TOKEN` — your WhatsApp Cloud API token
  - `PHONE_NUMBER_ID` — your phone number id (e.g. `768950296311329`)

3) Push to GitHub

```powershell
# if not already a git repo
git init
git add .
git commit -m "Add Dockerfile and Cloud Run workflow"
# add remote and push
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

4) What the workflow does

- On push to `main`, the workflow authenticates to GCP using `GCP_SA_KEY`, runs Cloud Build to build and push the container image to Container Registry, and deploys the image to Cloud Run with environment variables taken from repository secrets.

5) After deployment

- Get the service URL via Cloud Console or:

```powershell
gcloud run services describe sakhi-bot --platform managed --region ${{ secrets.GCP_REGION }} --format "value(status.url)"
```

- Configure the Meta webhook callback URL to: `https://<SERVICE_URL>/webhook` and set Verify Token to the same `VERIFY_TOKEN` value.
- If your app requires any other secrets or env vars, add them in the GitHub secrets and update the workflow.

Notes
- Do NOT commit `.env` to the repo. Keep tokens in GitHub secrets or use Secret Manager.
- In Development app mode, only app admins/testers can receive messages. Make sure your target WhatsApp number is allowed or move the app to Live after review.
