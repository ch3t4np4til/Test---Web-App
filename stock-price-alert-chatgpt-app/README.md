# Stock Price Alert ChatGPT App

This is a small ChatGPT Apps SDK scaffold for checking stock price alert conditions from ChatGPT. It exposes an MCP server at `/mcp`, registers a widget resource, and provides one read-only tool that fetches a quote, evaluates an alert, and renders an inline dashboard.

## What It Does

- Checks a stock quote using the default Stooq quote endpoint.
- Evaluates alert conditions such as above price, below price, percent move up, percent move down, or absolute percent move.
- Renders a ChatGPT widget with the current quote, alert status, and refresh controls.
- Lets the widget re-check the same condition through the MCP Apps bridge while the widget is open.

ChatGPT apps do not run as background workers by themselves. For production push notifications, add an external scheduler plus a delivery channel such as email, Slack, Teams, SMS, or a broker alert API, then expose read-only status and alert-management tools through this MCP app.

## Run Locally

```bash
npm install
npm run dev
```

The server starts on:

```text
http://localhost:8787/mcp
```

Use another port with:

```bash
PORT=8790 npm run dev
```

## Check

```bash
npm run check
```

## Connect In ChatGPT

1. Start this server locally.
2. Expose it with an HTTPS tunnel, for example:

```bash
ngrok http 8787
```

3. In ChatGPT, enable Developer Mode under Settings > Apps & Connectors > Advanced settings.
4. Create a new app/connector and use the tunneled MCP URL:

```text
https://your-tunnel.ngrok-free.app/mcp
```

5. Refresh the app in ChatGPT after tool or widget metadata changes.

## Example Prompts

```text
Check AAPL and notify me if it moves by at least 1% from the open.
```

```text
Watch TSLA and tell me if it is above 250.
```

```text
Show a stock alert for MSFT below 400.
```

## Production Notes

- Stooq is useful for a no-key prototype but may be delayed and does not guarantee market-data licensing for your use case.
- Replace `fetchStooqQuote` in `src/server.ts` with your licensed market data provider for production.
- Keep API keys on the server; the widget should call MCP tools rather than market-data APIs directly.
- Add persistence before creating user-specific saved alerts.
- Add a scheduler and notification sender if you need true background notifications.
- Add authentication before storing or managing real user alerts.

## Docs Used

- https://developers.openai.com/apps-sdk/quickstart
- https://developers.openai.com/apps-sdk/build/mcp-server
- https://developers.openai.com/apps-sdk/build/chatgpt-ui
- https://developers.openai.com/apps-sdk/plan/tools
- https://developers.openai.com/apps-sdk/reference
- https://developers.openai.com/apps-sdk/build/examples
