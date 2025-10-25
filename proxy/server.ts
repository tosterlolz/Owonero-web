import http from 'http';
import net from 'net';

const HTTP_PORT = Number(process.env.PORT) || 3001;
const TCP_TIMEOUT = 5000;

function stripEmptyLines(s: string) {
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/\u0000/g, '')) // remove any nulls
    .filter((l) => l.trim().length > 0)
    .join('\n');
}

function extractAfterEcho(command: string, text: string) {
  // Split into lines, remove nulls but keep original spacing for detection
  const rawLines = text.split(/\r?\n/).map((l) => l.replace(/\u0000/g, ''));
  const lines = rawLines.map((l) => l.trim());

  // Heuristics:
  // 1) If the daemon echoes the command (exact match), return lines after it.
  // 2) If the daemon prints a header like "owonero-daemon height=...", return the following non-empty lines.
  // 3) If a line contains a key like "height=NUMBER" return the next non-empty line(s).

  let idx = lines.findIndex((l) => l === command);
  if (idx === -1) {
    idx = lines.findIndex((l) => l.startsWith('owonero-daemon'));
  }
  if (idx === -1) {
    idx = lines.findIndex((l) => /\bheight=\d+/.test(l));
  }

  if (idx >= 0) {
    const tail = rawLines.slice(idx + 1).map((l) => l.trim()).filter((l) => l.length > 0);
    if (tail.length > 0) return tail.join('\n');
  }

  // As a final attempt, if the whole cleaned text is non-empty return it
  const cleaned = stripEmptyLines(text);
  if (cleaned.length > 0) return cleaned;

  // otherwise return original raw text
  return text;
}

function sendTcpCommand(host: string, port: number, command: string, payload: unknown | null, eol = '\r\n'): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => {
      console.debug(`TCP connected to ${host}:${port}`);
      // send command using provided EOL; do NOT end the socket immediately so daemon has
      // opportunity to reply on the same connection
      socket.write(command + eol);
      if (payload !== null && payload !== undefined) {
        try {
          socket.write(JSON.stringify(payload) + eol);
        } catch (e) {
          // ignore JSON stringify errors here
        }
      }
      // do not call socket.end() here; we'll close when response is considered complete
    });

    let response = '';
    let rawBuffer: Uint8Array[] = [];
    let resolved = false;
    let idleTimer: NodeJS.Timeout | null = null;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      try {
        const original = rawBuffer.length ? Buffer.concat(rawBuffer).toString('utf8') : response;
        const cleaned = stripEmptyLines(response);
        // Also try to remove an echoed command and return only the data after it
        let adjusted = extractAfterEcho(command, original);
        // Special-case formatting for getheight: return only "height:<number>"
        try {
          if (command.trim().toLowerCase().startsWith('getheight')) {
            // try to find a number in adjusted, cleaned, or original
            const candidate = [adjusted, cleaned, original].find((s) => typeof s === 'string' && s.length > 0) || '';
            const m = /(-?\d+)/.exec(candidate);
            if (m) {
              adjusted = `height:${m[1]}`;
            } else {
              // fallback to cleaned/adjusted as-is
              adjusted = stripEmptyLines(candidate);
            }
          }
        } catch (e) {
          // ignore formatting errors
        }
        // special-case: mineractive often returns an address line then 'ok'
        if (String(command).trim().toLowerCase().startsWith('mineractive')) {
          // look through original/cleaned/adjusted to find the first non-OK, non-command line
          const pick = (s: string) => s
            .split(/\r?\n/)
            .map((l) => l.replace(/\u0000/g, '').trim())
            .filter((l) => l.length > 0 && l.toLowerCase() !== 'ok' && l.toLowerCase() !== String(command).trim().toLowerCase());
          const picks = pick(original).concat(pick(cleaned)).concat(pick(adjusted));
          if (picks.length > 0) {
            adjusted = picks[0]!;
          } else {
            // leave adjusted as-is or mark none
            adjusted = adjusted || 'no miner';
          }
        }
        resolve(JSON.stringify({ original, cleaned, adjusted }));
      } catch (err) {
        resolve(response);
      } finally {
        try { socket.destroy(); } catch (e) { /* ignore */ }
      }
    };

    socket.setEncoding('utf8');
    socket.setTimeout(TCP_TIMEOUT, () => {
      if (!resolved) {
        resolved = true;
        reject(new Error('TCP timeout'));
      }
      try { socket.destroy(); } catch (e) {}
    });

    socket.on('data', (chunk: string | Buffer) => {
      // keep both raw and string concatenation
      if (typeof chunk === 'string') {
        response += chunk;
        rawBuffer.push(Buffer.from(chunk, 'utf8'));
      } else {
        response += chunk.toString('utf8');
        rawBuffer.push(chunk);
      }

      console.debug(`TCP received ${response.length} bytes so far`);

      // reset idle timer; when no data arrives for 250ms we consider response complete
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), 250);
    });

    // fallback: if the socket ends, finish immediately
    socket.on('end', () => {
      console.debug('TCP socket ended by remote');
      finish();
    });

    socket.on('error', (err) => {
      if (!resolved) reject(new Error('TCP connection failed'));
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/tcp') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    try {
      const json = body ? JSON.parse(body) : {};
      const host = json.host || 'localhost';
      const port = Number(json.port || 6969);
      const command = String(json.command || 'getheight');
      const payload = json.payload ?? null;

      const response = await sendTcpCommand(host, port, command, payload);

      // response is a JSON string that includes original/cleaned/adjusted
      let adjustedValue = '';
      try {
        const parsed = JSON.parse(response);
        console.debug('proxy parsed tcp response:', parsed);
        adjustedValue = parsed.adjusted ?? '';

        // fallback order: adjusted -> cleaned -> original
        if (!adjustedValue) adjustedValue = parsed.cleaned ?? '';
        if (!adjustedValue) adjustedValue = parsed.original ?? '';

        // special-case: if getheight, extract first integer and format
        if (String(command).trim().toLowerCase().startsWith('getheight')) {
          const m = /(-?\d+)/.exec(adjustedValue);
          if (m) adjustedValue = `height:${m[1]}`;
        }

        // special-case: mineractive - prefer actual OWO address if present
        if (String(command).trim().toLowerCase().startsWith('mineractive')) {
          const addrRe = /\bOWO[0-9A-Z]+\b/i;
          const searchAreas = [parsed.adjusted ?? '', parsed.cleaned ?? '', parsed.original ?? ''];
          let found: string | null = null;
          for (const area of searchAreas) {
            const m = addrRe.exec(area);
            if (m) { found = m[0]; break; }
          }
          // If no OWO address, look for lines containing the word 'shows' and take the following token
          if (!found) {
            for (const area of searchAreas) {
              const lines = area.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
              for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(/\s+/);
                const idx = parts.findIndex((p: string) => /shows/i.test(p));
                if (idx !== -1 && parts.length > idx+1) {
                  found = parts[idx+1];
                  break;
                }
              }
              if (found) break;
            }
          }
          // If still not found, and the response contains a header like 'owonero-daemon ...',
          // try to return the next non-empty line after that header in the original text.
          if (!found) {
            const raw = String(parsed.original ?? parsed.cleaned ?? parsed.adjusted ?? '');
            const rawLines = raw.split(/\r?\n/).map((l: string) => l.replace(/\u0000/g, '').trim());
            const headerIdx = rawLines.findIndex((l) => l.toLowerCase().startsWith('owonero-daemon') || l.toLowerCase().includes('miner-active') || l.toLowerCase().includes('mineractive'));
            if (headerIdx !== -1) {
              for (let j = headerIdx + 1; j < rawLines.length; j++) {
                const line = (rawLines[j] ?? '').trim();
                if (!line || line.toLowerCase() === 'ok') continue;
                const tokens = line.split(/\s+/).map((t: string) => t.trim()).filter(Boolean);
                // Prefer explicit OWO-style address
                let tokFound = tokens.find((t: string) => addrRe.test(t));
                if (!tokFound) {
                  // pick first token that looks like an address/identifier and isn't just 'owonero' or 'height=...'
                  tokFound = tokens.find((t: string) => {
                    const tl = t.toLowerCase();
                    if (tl.includes('owonero')) return false;
                    if (/^height=/.test(tl)) return false;
                    if (tl === 'ok') return false;
                    if (tl === String(command).trim().toLowerCase()) return false;
                    return /[A-Za-z0-9]{4,}/.test(t);
                  });
                }
                if (tokFound) { found = tokFound; break; }
              }
            }
          }
          if (found) adjustedValue = found;
            else adjustedValue = 'no miner';
        }

        if (!adjustedValue) adjustedValue = 'no response';
      } catch (e) {
        adjustedValue = response || 'no response';
      }

      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
      // return only adjusted at top-level for the caller
      res.end(JSON.stringify({ ok: true, adjusted: adjustedValue }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ ok: true, adjusted: 'no response' }));
    }

    return;
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

server.listen(HTTP_PORT, () => {
  console.log(`Proxy server listening on http://localhost:${HTTP_PORT}`);
  console.log('POST JSON to /api/tcp { host, port, command, payload }');
});
