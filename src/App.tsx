import { APITester } from "./APITester";
import "./index.css";

import logo from "./logo.svg";
import reactLogo from "./react.svg";
import OwoneroDashboard from "./OwoneroDashboard";

export function App() {
  return (
    <div className="max-w-7xl mx-auto p-8 text-center relative z-10">
      <div className="flex justify-center items-center gap-8 mb-8">
        <img
          src={logo}
          alt="Bun Logo"
          className="h-24 p-6 transition-all duration-300 hover:drop-shadow-[0_0_2em_#646cffaa] scale-120"
        />
        <img
          src={reactLogo}
          alt="React Logo"
          className="h-24 p-6 transition-all duration-300 hover:drop-shadow-[0_0_2em_#61dafbaa] animate-[spin_20s_linear_infinite]"
        />
      </div>

      <h1 className="text-5xl font-bold my-4 leading-tight">Owonero Web UI</h1>
      <p className="mb-6">
        A small frontend to interact with an Owonero daemon. Start the proxy with <code className="font-mono">npm run start:proxy</code> and the dev server with <code className="font-mono">bun dev</code>.
      </p>

      <OwoneroDashboard />

      <div className="mt-8">
        <APITester />
      </div>
    </div>
  );
}

export default App;
