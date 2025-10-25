export type TCPResponse = { ok: boolean; adjusted?: string; raw?: string; error?: string };

export async function sendTcpCommand(
  command: string,
  payload?: unknown,
  host = 'owonero.yabai.buzz',
  port = 6969
): Promise<TCPResponse> {
  try {
    const res = await fetch('http://localhost:3001/api/tcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, command, payload }),
    });
  return (await res.json()) as TCPResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
