import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const WIDGET_URI = 'ui://widget/stock-alert-v1.html';
const WIDGET_HTML = readFileSync(path.join(ROOT_DIR, 'public', 'widget.html'), 'utf8');

const ALERT_TYPES = ['above', 'below', 'percent_move_up', 'percent_move_down', 'percent_move_abs'] as const;
type AlertType = (typeof ALERT_TYPES)[number];

type Quote = {
  symbol: string;
  providerSymbol: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  date: string | null;
  time: string | null;
  provider: string;
  fetchedAt: string;
};

type AlertInput = {
  symbol: string;
  alertType?: AlertType;
  targetPrice?: number;
  percentChange?: number;
  baselinePrice?: number;
};

function normalizeSymbol(symbol: string): string {
  const cleaned = symbol.trim().toUpperCase().replaceAll(' ', '');
  if (!cleaned) throw new Error('A stock symbol is required.');
  if (cleaned.includes('.') || cleaned.startsWith('^')) return cleaned;
  return `${cleaned}.US`;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === 'N/D') return null;
  const parsed = Number(trimmed.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value >= 100 ? 2 : 3,
    maximumFractionDigits: value >= 100 ? 2 : 4,
  });
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

async function fetchStooqQuote(symbol: string): Promise<Quote> {
  const providerSymbol = normalizeSymbol(symbol);
  const url = new URL('https://stooq.com/q/l/');
  url.searchParams.set('s', providerSymbol.toLowerCase());
  url.searchParams.set('f', 'sd2t2ohlcv');
  url.searchParams.set('h', '');
  url.searchParams.set('e', 'json');

  const response = await fetch(url, {
    headers: { accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' },
  });
  if (!response.ok) throw new Error(`Quote provider returned HTTP ${response.status}.`);

  const payload = (await response.json()) as { symbols?: Array<Record<string, unknown>> };
  const row = payload.symbols?.[0];
  if (!row) throw new Error(`No quote was returned for ${symbol}.`);

  const price = toNumber(row.close);
  if (price === null) throw new Error(`No usable price was returned for ${symbol}.`);

  return {
    symbol: symbol.trim().toUpperCase(),
    providerSymbol,
    price,
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    volume: toNumber(row.volume),
    date: typeof row.date === 'string' ? row.date : null,
    time: typeof row.time === 'string' ? row.time : null,
    provider: 'stooq',
    fetchedAt: new Date().toISOString(),
  };
}

function evaluateAlert(quote: Quote, input: AlertInput) {
  const alertType = input.alertType ?? 'percent_move_abs';
  const baseline = input.baselinePrice ?? quote.open ?? quote.price;
  const changeFromBaseline = quote.price - baseline;
  const changeFromBaselinePercent = baseline === 0 ? 0 : (changeFromBaseline / baseline) * 100;
  const thresholdPercent = input.percentChange ?? 1;

  if (alertType === 'above') {
    const target = input.targetPrice;
    const triggered = typeof target === 'number' && quote.price >= target;
    return {
      alertType,
      triggered,
      targetPrice: target ?? null,
      thresholdPercent: null,
      baselinePrice: baseline,
      changeFromBaseline,
      changeFromBaselinePercent,
      reason: typeof target === 'number'
        ? `${quote.symbol} is ${triggered ? 'at or above' : 'below'} ${formatPrice(target)}.`
        : 'Set a target price to evaluate an above-price alert.',
    };
  }

  if (alertType === 'below') {
    const target = input.targetPrice;
    const triggered = typeof target === 'number' && quote.price <= target;
    return {
      alertType,
      triggered,
      targetPrice: target ?? null,
      thresholdPercent: null,
      baselinePrice: baseline,
      changeFromBaseline,
      changeFromBaselinePercent,
      reason: typeof target === 'number'
        ? `${quote.symbol} is ${triggered ? 'at or below' : 'above'} ${formatPrice(target)}.`
        : 'Set a target price to evaluate a below-price alert.',
    };
  }

  if (alertType === 'percent_move_up') {
    const triggered = changeFromBaselinePercent >= thresholdPercent;
    return {
      alertType,
      triggered,
      targetPrice: null,
      thresholdPercent,
      baselinePrice: baseline,
      changeFromBaseline,
      changeFromBaselinePercent,
      reason: `${quote.symbol} is ${formatPercent(changeFromBaselinePercent)} from the baseline; threshold is +${thresholdPercent.toFixed(2)}%.`,
    };
  }

  if (alertType === 'percent_move_down') {
    const triggered = changeFromBaselinePercent <= -thresholdPercent;
    return {
      alertType,
      triggered,
      targetPrice: null,
      thresholdPercent,
      baselinePrice: baseline,
      changeFromBaseline,
      changeFromBaselinePercent,
      reason: `${quote.symbol} is ${formatPercent(changeFromBaselinePercent)} from the baseline; threshold is -${thresholdPercent.toFixed(2)}%.`,
    };
  }

  const triggered = Math.abs(changeFromBaselinePercent) >= thresholdPercent;
  return {
    alertType,
    triggered,
    targetPrice: null,
    thresholdPercent,
    baselinePrice: baseline,
    changeFromBaseline,
    changeFromBaselinePercent,
    reason: `${quote.symbol} moved ${formatPercent(changeFromBaselinePercent)} from the baseline; threshold is +/-${thresholdPercent.toFixed(2)}%.`,
  };
}

function createAppServer(): McpServer {
  const server = new McpServer({ name: 'stock-price-alert', version: '0.1.0' });

  registerAppResource(server, 'stock-alert-widget', WIDGET_URI, {}, async () => ({
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: WIDGET_HTML,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [] },
          },
          'openai/widgetDescription': 'Displays a stock quote and alert status for the selected symbol.',
        },
      },
    ],
  }));

  registerAppTool(
    server,
    'watch_stock_price',
    {
      title: 'Watch stock price',
      description: 'Use this when the user wants to check a stock price and know whether a price-change alert condition is currently triggered.',
      inputSchema: {
        symbol: z.string().min(1).describe('Stock symbol to check, for example AAPL, TSLA, MSFT, or a provider-specific symbol such as BHP.AU.'),
        alertType: z.enum(ALERT_TYPES).default('percent_move_abs').describe('Alert condition to evaluate.'),
        targetPrice: z.number().positive().optional().describe('Target price for above or below alerts.'),
        percentChange: z.number().positive().max(100).optional().describe('Percent threshold for percent-move alerts.'),
        baselinePrice: z.number().positive().optional().describe('Optional baseline price. If omitted, the quote open is used when available.'),
      },
      outputSchema: {
        symbol: z.string(),
        providerSymbol: z.string(),
        price: z.number(),
        open: z.number().nullable(),
        high: z.number().nullable(),
        low: z.number().nullable(),
        volume: z.number().nullable(),
        date: z.string().nullable(),
        time: z.string().nullable(),
        provider: z.string(),
        fetchedAt: z.string(),
        alert: z.object({
          alertType: z.enum(ALERT_TYPES),
          triggered: z.boolean(),
          reason: z.string(),
          targetPrice: z.number().nullable(),
          thresholdPercent: z.number().nullable(),
          baselinePrice: z.number(),
          changeFromBaseline: z.number(),
          changeFromBaselinePercent: z.number(),
        }),
        disclaimer: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI, visibility: ['model', 'app'] },
        'openai/toolInvocation/invoking': 'Checking the stock price...',
        'openai/toolInvocation/invoked': 'Stock price checked.',
      },
    },
    async (input) => {
      const quote = await fetchStooqQuote(input.symbol);
      const alert = evaluateAlert(quote, input);
      const disclaimer = 'Market data may be delayed and is provided for informational purposes only.';

      return {
        content: [
          {
            type: 'text' as const,
            text: `${quote.symbol} is ${formatPrice(quote.price)}. Alert ${alert.triggered ? 'triggered' : 'not triggered'}: ${alert.reason}`,
          },
        ],
        structuredContent: { ...quote, alert, disclaimer },
        _meta: {
          'openai/outputTemplate': WIDGET_URI,
          quoteProvider: quote.provider,
          requestedInput: input,
        },
      };
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? '8787');
const MCP_PATH = '/mcp';

createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end('Missing URL');
    return;
  }

  const url = new URL(req.url, 'http://' + (req.headers.host ?? 'localhost'));
  const isMcpRoute = url.pathname === MCP_PATH || url.pathname.startsWith(`${MCP_PATH}/`);

  if (req.method === 'OPTIONS' && isMcpRoute) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('Stock Price Alert MCP server. Connect ChatGPT to /mcp.');
    return;
  }

  const transportMethods = new Set(['GET', 'POST', 'DELETE']);
  if (isMcpRoute && req.method && transportMethods.has(req.method)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    const server = createAppServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Failed to handle MCP request:', error);
      if (!res.headersSent) res.writeHead(500).end('Internal server error');
    }
    return;
  }

  res.writeHead(404).end('Not Found');
}).listen(port, () => {
  console.log(`Stock Price Alert MCP server listening on http://localhost:${port}${MCP_PATH}`);
});
