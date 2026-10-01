#!/usr/bin/env python3
"""
Replaces the Three.js "liquid glass" hero icon with a cleaner liquid-glass app
icon (flame mark) built from pure CSS 3D layers: no WebGL, no three.js, no
transparent meshes to z-sort, so nothing flickers.

Usage:  python3 install_glass_icon.py path/to/index.html
Works on your original file, or on one already run through fix_liquid_glass.py.
Writes <file>.bak first, then edits in place.
"""
import re, sys, shutil, pathlib

path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "index.html")
orig = path.read_text(encoding="utf-8")
s = orig

FLAME = ("M50 5C53 22 79 35 79 60C79 79 67 93 50 93C33 93 21 79 21 60C21 48 27 40 33 32"
         "C35 42 40 47 45 47C42 30 44 16 50 5ZM50 50C58 60 64 67 64 74C64 82 58 87 50 87"
         "C42 87 36 82 36 74C36 67 42 60 50 50Z")

HTML = f"""<div class="pi-stage" id="piStage" role="img" aria-label="Pyre app icon">
   <div class="pi-shadow"></div>
   <div class="pi">
    <div class="pi-base"></div>
    <svg class="pi-logo" viewBox="0 0 100 100" aria-hidden="true">
     <defs><linearGradient id="pi-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#9aa3b2"/></linearGradient></defs>
     <path fill="url(#pi-g)" fill-rule="evenodd" d="{FLAME}"/>
    </svg>
    <div class="pi-glass"></div>
   </div>
  </div>"""

CSS = """/* Liquid glass app icon: pure CSS, one 3D plane per layer (no WebGL, nothing to z-sort) */
.pi-stage{position:relative;width:min(240px,60vw);aspect-ratio:1;margin:40px auto 64px;perspective:900px}
.pi{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .35s cubic-bezier(.2,.7,.2,1),scale .3s cubic-bezier(.2,.7,.2,1);animation:pi-float 7s ease-in-out infinite alternate}
@keyframes pi-float{from{translate:0 -4px}to{translate:0 6px}}
.pi-stage:active .pi{scale:.965}
.pi>*{position:absolute;inset:0;border-radius:22.5%}
.pi-base{transform:translateZ(-24px);background:radial-gradient(80% 80% at 50% 36%,#1d222d,#0a0b0f 72%)}
.pi-logo{inset:auto;left:16%;top:16%;width:68%;height:68%;border-radius:0}
.pi-logo{transform:translateZ(-8px)}
.pi-glass{transform:translateZ(0);background:
 radial-gradient(120% 80% at 50% 0%,rgba(255,255,255,.22),rgba(255,255,255,0) 55%),
 radial-gradient(90% 60% at 50% 115%,rgba(180,210,255,.30),rgba(255,255,255,0) 60%),
 linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,.03) 45%,rgba(255,255,255,.08));
 box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(255,255,255,.14),inset 0 0 26px rgba(255,255,255,.08),inset 0 -16px 28px -14px rgba(160,200,255,.28)}
.pi-glass::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1.5px;background:linear-gradient(145deg,rgba(255,255,255,.9),rgba(255,255,255,.06) 34%,rgba(255,255,255,.06) 66%,rgba(180,210,255,.65));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
.pi-shadow{position:absolute;left:14%;right:14%;bottom:-8%;height:12%;border-radius:50%;background:radial-gradient(ellipse at center,rgba(255,255,255,.16),rgba(0,0,0,0) 70%);filter:blur(12px)}
@media(prefers-reduced-motion:reduce){.pi{animation:none;transition:none}}
"""

JS = """// Liquid glass icon: tilt follows the pointer (CSS vars only; no render loop)
(function(){
  var stage=document.getElementById('piStage');
  if(!stage||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var vis=true,raf=0,px=0,py=0,st=stage.style;
  new IntersectionObserver(function(e){vis=e[0].isIntersecting},{threshold:.05}).observe(stage);
  function apply(){
    raf=0;
    var r=stage.getBoundingClientRect(),
        nx=Math.max(-1,Math.min(1,(px-r.left-r.width/2)/(innerWidth/2))),
        ny=Math.max(-1,Math.min(1,(py-r.top-r.height/2)/(innerHeight/2)));
    st.setProperty('--ry',(nx*14).toFixed(2)+'deg');
    st.setProperty('--rx',(-ny*12).toFixed(2)+'deg');
  }
  addEventListener('pointermove',function(e){if(!vis)return;px=e.clientX;py=e.clientY;if(!raf)raf=requestAnimationFrame(apply)},{passive:true});
  document.addEventListener('mouseleave',function(){['--rx','--ry'].forEach(function(k){st.removeProperty(k)})});
})();
"""

log = []
def step(label, pattern, repl, flags=re.S):
    global s
    new, n = re.subn(pattern, lambda m: repl, s, count=1, flags=flags)
    log.append(f"  [{'ok' if n else 'skip'}]   {label}")
    if n: s = new
    return n

# --- remove the old three.js icon (original file) ---
step("remove three.js <script> tag",
     r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/three\.js/[^"]*"></script>\s*', "")
step("remove old Three.js icon script",
     r"// ═+[^\n]*\n// Three\.js.*?(?=</script>\s*</body>)", "")

# --- swap the markup: original canvas stage OR the terminal from fix_liquid_glass.py ---
if not step("replace canvas stage with new icon",
            r'<div class="hero-icon-stage" id="heroIconStage">.*?</canvas>\s*</div>', HTML):
    step("replace terminal window with new icon",
         r'<div class="herowin"><div class="win" data-slot="Silicon view[^"]*"></div></div>', HTML)

# --- swap the CSS ---
if not step("replace old 3D stage CSS",
            r"/\* 3D App Icon Stage.*?(?=</style>)", CSS):
    if not step("replace terminal-window CSS",
                r"/\* Hero terminal window \(replaces the 3D glass icon\) \*/.*?(?=</style>)", CSS):
        step("append icon CSS", r"</style>", CSS + "</style>")

# --- add the pointer script (end of the last <script>) ---
step("add icon pointer script", r"(?=</script>\s*</body>)", JS)

print("\n".join(log))
if "pi-stage" not in s or "piStage');" not in s:
    sys.exit("Icon markup or script did not land - nothing written. Send me the file and I'll look.")
shutil.copy(path, str(path) + ".bak")
path.write_text(s, encoding="utf-8")
left = [k for k in ("THREE", "three.min", "hero-icon") if k in s]
print(f"\nDone. Backup: {path}.bak   Leftover three.js references: {left or 'none'}")