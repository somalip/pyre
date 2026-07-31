import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    
    func applicationDidFinishLaunching(_ aNotification: Notification) {
        let rect = NSRect(x: 0, y: 0, width: 800, height: 600)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.center()
        window.title = "Pyre UI Test"
        
        let webView = WKWebView(frame: rect)
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
        <style>
          :root {
            --bg: #000;
            --fg: #fff;
            --dim: #888;
            --line: #333;
            --font: 'Menlo', 'Monaco', 'Courier New', monospace;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: var(--bg);
            color: var(--fg);
            font-family: var(--font);
            overflow: hidden;
          }
          .scroll-container {
            height: 100vh;
            overflow-y: scroll;
            scroll-snap-type: y mandatory;
            scroll-behavior: smooth;
          }
          .panel {
            height: 100vh;
            scroll-snap-align: start;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            border-bottom: 1px solid var(--line);
            padding: 2rem;
            position: relative;
          }
          .tui-box {
            border: 1px solid var(--dim);
            padding: 2rem;
            width: 80%;
            max-width: 800px;
            background: rgba(20, 20, 20, 0.8);
            backdrop-filter: blur(10px);
            box-shadow: 0 0 20px rgba(255,255,255,0.05);
          }
          h1, h2 { text-transform: uppercase; letter-spacing: 2px; margin-bottom: 1rem; }
          p { color: var(--dim); line-height: 1.6; margin-bottom: 1rem; }
          .ascii { white-space: pre; font-size: 0.8rem; margin-bottom: 2rem; color: var(--fg); text-align: center; }
          .data-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-top: 2rem;
            border-top: 1px solid var(--line);
            padding-top: 1rem;
          }
          .data-item { font-size: 0.9rem; }
          .data-label { color: var(--dim); }
          .data-value { float: right; font-weight: bold; }
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: var(--bg); }
          ::-webkit-scrollbar-thumb { background: var(--line); }
        </style>
        </head>
        <body>
          <div class="scroll-container">
            <div class="panel" id="step1">
              <div class="tui-box">
                <div class="ascii">
          ┌───────────────────────┐
          │   P Y R E   S E T U P │
          └───────────────────────┘
                </div>
                <h2>System Initialization</h2>
                <p>Welcome to the Pyre macOS TUI interface. This wizard will configure your local daemon and establish P2P routing rules.</p>
                <div class="data-grid">
                  <div class="data-item"><span class="data-label">Kernel:</span><span class="data-value">Darwin 23.4.0</span></div>
                  <div class="data-item"><span class="data-label">Arch:</span><span class="data-value">arm64</span></div>
                  <div class="data-item"><span class="data-label">Memory:</span><span class="data-value">32 GB</span></div>
                  <div class="data-item"><span class="data-label">Status:</span><span class="data-value">OK</span></div>
                </div>
              </div>
            </div>
            
            <div class="panel" id="step2">
              <div class="tui-box">
                <h2>Daemon Configuration</h2>
                <p>Adjust the polling interval for the local sensor daemon. A lower polling interval provides more granular telemetry at the cost of higher CPU utilization.</p>
                <div class="data-grid">
                  <div class="data-item"><span class="data-label">Polling Rate:</span><span class="data-value">2.0s</span></div>
                  <div class="data-item"><span class="data-label">Log Rotation:</span><span class="data-value">24h</span></div>
                  <div class="data-item"><span class="data-label">Export Path:</span><span class="data-value">/var/log/pyre/</span></div>
                  <div class="data-item"><span class="data-label">SMC Access:</span><span class="data-value">Granted</span></div>
                </div>
              </div>
            </div>
            
            <div class="panel" id="step3">
              <div class="tui-box">
                <h2>Network & P2P</h2>
                <p>Configure the P2P swarm settings for remote telemetry syncing. All traffic is encrypted using AES-256-GCM. Ensure your firewall permits inbound traffic on the selected port.</p>
                <div class="data-grid">
                  <div class="data-item"><span class="data-label">Bind Address:</span><span class="data-value">0.0.0.0</span></div>
                  <div class="data-item"><span class="data-label">Port:</span><span class="data-value">9876</span></div>
                  <div class="data-item"><span class="data-label">Encryption:</span><span class="data-value">Enabled</span></div>
                  <div class="data-item"><span class="data-label">Peers:</span><span class="data-value">0 Connected</span></div>
                </div>
              </div>
            </div>
          </div>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
        
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
