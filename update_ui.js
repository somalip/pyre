const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1. Update CSS tokens
html = html.replace(
  /:root {([\s\S]*?)}/,
  `:root {
    --bg:       #000000;
    --surface:  #0a0a0c;
    --border:   #333333;
    --accent:   #ff5f2e;
    --accent2:  #ff9f1a;
    --text:     #e0e0e0;
    --dim:      #888888;
    --dimmer:   #555555;
    --ok:       #00ff00;
    --mono:     'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }`
);

// 2. Wrap the wizard in a window-like container
html = html.replace(
  /#wizard { opacity: 0; transition: opacity \.4s ease \.1s; flex: 1; display: flex; flex-direction: column; }/,
  `#wizard-container {
    opacity: 0; transition: opacity .4s ease .1s; 
    flex: 1; display: flex; flex-direction: column; 
    align-items: center; padding: 40px 20px;
  }
  #wizard-container.show { opacity: 1; }
  #wizard { 
    flex: 1; display: flex; flex-direction: column; 
    width: 100%; max-width: 720px;
    border: 1px solid var(--dimmer);
    box-shadow: 8px 8px 0px rgba(255, 95, 46, 0.2);
    background: var(--surface);
    position: relative;
  }
  #wizard::before {
    content: '';
    position: absolute; top: -1px; left: -1px; right: -1px; bottom: -1px;
    border: 1px solid var(--dimmer); pointer-events: none;
  }`
);

// Update enterBtn logic to toggle show on #wizard-container instead of #wizard
html = html.replace(
  /wizard\.classList\.add\('show'\);/g,
  `document.getElementById('wizard-container').classList.add('show');`
);

// Wrap <div id="wizard"> in <div id="wizard-container">
html = html.replace(
  /<div id="wizard">/,
  `<div id="wizard-container">\n  <div id="wizard">`
);

// Close the container before footer? The footer is inside the wizard. Wait, let's keep footer inside the wizard or outside.
// Let's close it at the end of <div id="wizard">
html = html.replace(
  /<\/div>\n\n<!-- ═══════════════════ SCRIPTS ═══════════════════ -->/,
  `  </div>\n</div>\n\n<!-- ═══════════════════ SCRIPTS ═══════════════════ -->`
);

// 3. TUI Tabs
html = html.replace(
  /\.tab {[\s\S]*?text-transform: uppercase;\n  }/,
  `.tab {
    font-size: 11px;
    letter-spacing: 0.04em;
    padding: 8px 16px;
    color: var(--dimmer);
    cursor: pointer;
    border-right: 1px solid var(--border);
    transition: all .15s;
    white-space: nowrap;
    user-select: none;
    text-transform: uppercase;
  }`
);

html = html.replace(
  /\.tab\.active {[\s\S]*?background: var\(--surface\);\n  }/,
  `.tab.active {
    color: var(--bg);
    background: var(--accent);
    border-right-color: var(--accent);
  }`
);

html = html.replace(
  /\.tab \.idx {[\s\S]*?font-weight: 300;\n  }/,
  `.tab .idx {
    color: var(--dim);
    margin-right: 6px;
    font-weight: bold;
  }`
);

html = html.replace(
  /\.tab\.active \.idx { color: var\(--accent\); opacity: \.6; }/,
  `.tab.active .idx { color: var(--bg); opacity: 0.8; }`
);

// Adjust formatting of tabs in html to look like [ 1 theme ]
html = html.replace(
  /<div class="tab" data-step="0"><span class="idx">0<\/span>readme<\/div>/,
  `<div class="tab" data-step="0"><span class="idx">[0]</span>readme</div>`
);
html = html.replace(
  /<div class="tab" data-step="1"><span class="idx">1<\/span>theme<\/div>/,
  `<div class="tab" data-step="1"><span class="idx">[1]</span>theme</div>`
);
html = html.replace(
  /<div class="tab" data-step="2"><span class="idx">2<\/span>config<\/div>/,
  `<div class="tab" data-step="2"><span class="idx">[2]</span>config</div>`
);
html = html.replace(
  /<div class="tab" data-step="3"><span class="idx">3<\/span>p2p<\/div>/,
  `<div class="tab" data-step="3"><span class="idx">[3]</span>p2p</div>`
);
html = html.replace(
  /<div class="tab" data-step="4"><span class="idx">4<\/span>launch<\/div>/,
  `<div class="tab" data-step="4"><span class="idx">[4]</span>launch</div>`
);


// 4. Form inputs (text, password, number)
html = html.replace(
  /input\[type="text"\],[\s\S]*?padding: 8px 10px;\n  }/,
  `input[type="text"],
  input[type="password"],
  input[type="number"] {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--dimmer);
    color: var(--accent2);
    font-family: var(--mono);
    font-size: 12px;
    padding: 8px 10px 8px 24px;
    position: relative;
  }`
);

html = html.replace(
  /input:focus { outline: none; border-color: var\(--accent\); }/,
  `input:focus { outline: none; border-color: var(--accent); background: rgba(255, 95, 46, 0.05); }
  
  .input-wrap {
    position: relative;
    width: 100%;
  }
  .input-wrap::before {
    content: '>';
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--dim);
    font-size: 12px;
    pointer-events: none;
    font-weight: bold;
  }`
);

// Wrap inputs in .input-wrap
html = html.replace(
  /<input type="text" id="exportDir"([^>]+)>/g,
  `<div class="input-wrap"><input type="text" id="exportDir"$1></div>`
);
html = html.replace(
  /<input type="password" id="p2pPassword"([^>]+)>/g,
  `<div class="input-wrap"><input type="password" id="p2pPassword"$1></div>`
);
html = html.replace(
  /<input type="text" id="p2pHost"([^>]+)>/g,
  `<div class="input-wrap"><input type="text" id="p2pHost"$1></div>`
);
html = html.replace(
  /<input type="number" id="p2pPort"([^>]+)>/g,
  `<div class="input-wrap"><input type="number" id="p2pPort"$1></div>`
);

// 5. Toggle switch replacements
html = html.replace(
  /\.switch {[\s\S]*?\.switch\.on::after { left: 18px; background: var\(--accent\); }/,
  `.switch {
    font-size: 14px;
    color: var(--dim);
    cursor: pointer;
    user-select: none;
    font-weight: bold;
  }
  .switch::before {
    content: '[ ]';
  }
  .switch.on {
    color: var(--accent);
  }
  .switch.on::before {
    content: '[x]';
  }`
);
html = html.replace(/<div class="switch"/g, '<div class="switch"'); // same, handled by css

// 6. TUI Progress Bar (Range slider)
html = html.replace(
  /input\[type="range"\] {[\s\S]*?height: 2px;\n  }/,
  `input[type="range"] {
    -webkit-appearance: none;
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--dimmer);
    height: 12px;
    outline: none;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--accent);
    cursor: pointer;
  }`
);

// 7. Cards / Boxes
html = html.replace(
  /\.card {[\s\S]*?background: var\(--surface\);\n  }/,
  `.card {
    border: 1px solid var(--dimmer);
    margin-bottom: 16px;
    background: var(--bg);
    position: relative;
  }
  .card::before {
    content: '';
    position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px;
    border: 1px dashed var(--dimmer);
    pointer-events: none;
  }`
);

html = html.replace(
  /\.card-title {[\s\S]*?background: rgba\(255,255,255,0\.01\);\n  }/,
  `.card-title {
    font-size: 10px;
    color: var(--accent2);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 8px 14px;
    border-bottom: 1px dashed var(--dimmer);
    background: transparent;
    font-weight: bold;
  }`
);

html = html.replace(
  /\.code-box {[\s\S]*?margin-bottom: 4px;\n  }/,
  `.code-box {
    background: var(--bg);
    border: 1px solid var(--dimmer);
    border-left: 2px solid var(--accent);
    padding: 12px 14px;
    position: relative;
    margin-bottom: 4px;
  }`
);


// 8. Buttons
html = html.replace(
  /\.btn {[\s\S]*?\.btn:disabled { opacity: 0\.2; cursor: default; }/,
  `.btn {
    font-family: var(--mono);
    font-size: 11px;
    padding: 8px 20px;
    cursor: pointer;
    border: 1px solid var(--dimmer);
    background: transparent;
    color: var(--text);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition: all .15s;
    font-weight: bold;
  }
  .btn:hover { color: var(--bg); background: var(--text); border-color: var(--text); }
  .btn.primary {
    border-color: var(--accent);
    color: var(--accent);
  }
  .btn.primary:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .btn:disabled { opacity: 0.2; cursor: default; }`
);

// 9. Splash Logo adjustments
html = html.replace(
  /color: var\(--dim\);/,
  `color: var(--text);` // in splash-logo
);

// 10. Fix body background
html = html.replace(
  /body {\n    background: var\(--bg\);/,
  `body {\n    background: var(--bg);` // wait, it's already using bg. Let's make it radial gradient to look like a CRT? Or maybe not.
);
html = html.replace(
  /body::after {[\s\S]*?z-index: 9999;\n  }/,
  `body::after {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,255,0,0.015) 2px,
      rgba(0,255,0,0.015) 4px
    );
    pointer-events: none;
    z-index: 9999;
  }`
);

fs.writeFileSync('index.html', html);
console.log('updated index.html');
