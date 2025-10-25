import { useState } from 'react';
import { sendTcpCommand } from './owoneroClient';

export function OwoneroDashboard() {
  const [host, setHost] = useState('owonero.yabai.buzz');
  const [port, setPort] = useState(6969);
  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(false);

  async function runCommand(command: string, payload?: any) {
    setLoading(true);
    setOutput('');
    const res = await sendTcpCommand(command, payload, host, Number(port));
    if (res.ok) setOutput(res.adjusted ?? res.raw ?? '');
    else setOutput('Error: ' + (res.error ?? 'unknown'));
    setLoading(false);
  }

  return (
    <div className="max-w-4xl mx-auto mt-8 p-6 bg-[#0b1220]/60 rounded-xl border border-[#2b3948] text-left">
      <h2 className="text-2xl font-bold mb-3">Owonero Dashboard</h2>
      <div className="flex gap-2 items-center mb-4">
        <label className="font-mono text-sm">Host</label>
        <input className="px-2 py-1 rounded bg-transparent border" value={host} onChange={e=>setHost(e.target.value)} />
        <label className="font-mono text-sm">Port</label>
        <input className="w-20 px-2 py-1 rounded bg-transparent border" value={String(port)} onChange={e=>setPort(Number(e.target.value))} />
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        <button className="btn" onClick={()=>runCommand('getheight')}>Get Height</button>
  <button className="btn" onClick={()=>runCommand('getpeers')}>Get Peers</button>
        <button className="btn" onClick={()=>runCommand('mineractive')}>Miner Active</button>
        <button className="btn" onClick={()=>runCommand('sync')}>Sync</button>
      </div>

      <div className="mb-4">
        <label className="block mb-1 font-mono">Custom command</label>
        <div className="flex gap-2">
          <input id="cmd" className="flex-1 px-2 py-1 bg-transparent border rounded" defaultValue="getheight" />
          <button className="btn" onClick={()=>{
            const cmd = (document.getElementById('cmd') as HTMLInputElement).value;
            runCommand(cmd);
          }}>Send</button>
        </div>
      </div>

      <div>
        <label className="block mb-1 font-mono">Output</label>
        <pre className="whitespace-pre-wrap bg-[#05060a] border p-3 rounded min-h-[140px]">{loading ? 'Loading...' : output}</pre>
      </div>

      <style>{`
        .btn{ background:#fbf0df;color:#111;padding:6px 12px;border-radius:8px;font-weight:700 }
        .btn:hover{ transform:translateY(-2px) }
      `}</style>
    </div>
  );
}

export default OwoneroDashboard;
