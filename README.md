# Clawshier

OpenClaw skill that processes receipt/invoice photos from any chat channel, extracts expense data via OpenAI Vision, and logs it to a Google Spreadsheet.

## Prerequisites

- Node.js 18+
- OpenAI API key
- Google Cloud service account with Sheets API enabled

## Install

```bash
clawhub install clawshier
clawhub update clawshier
```

The skill is available on [ClawHub](https://clawhub.ai/fdocr/clawshier).

If you prefer to install manually instead of using the CLI:

```bash
git clone https://github.com/fdocr/clawshier.git
cd clawshier
npm install
```

After installing, configure the required environment variables (`OPENAI_API_KEY`, `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY`) in your OpenClaw environment.

### Google Sheets setup

1. Create a Google Cloud service account and download the JSON key file
   - Go to [Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) in the Google Cloud Console
   - Click **Create Service Account**, give it a name, and click through to finish
   - On the service account's **Keys** tab, click **Add Key > Create new key > JSON** and save the downloaded file
2. Enable the [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) in your project
3. Create an empty spreadsheet and share it with the service account email
4. Add the spreadsheet ID and key file path to `.env`

The skill automatically manages all sheet tabs (monthly expense sheets, Invoice Archive Breakdown, and Summary with chart). The default "Sheet1" tab is deleted on first use.

## License

MIT
