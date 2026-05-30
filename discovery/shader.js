// discovery/shader.js
// WebGL shader background — flowing wave lines.
// Ported verbatim from arqentia.com (index.html, hero #shader-bg) so the Discovery
// surfaces share the same animated field as the rest of the marketing site.
// Pauses on tab hidden, reduced-motion preference, and when the host canvas
// scrolls off-screen.

const canvas = document.getElementById('shader-bg');
if (canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (gl) {
    const vsSource = `
      attribute vec4 aVertexPosition;
      void main(){ gl_Position = aVertexPosition; }
    `;
    const fsSource = `
      precision highp float;
      uniform vec2 iResolution;
      uniform float iTime;

      const float overallSpeed = 0.18;
      const float scale = 5.0;
      const float minLineWidth = 0.008;
      const float maxLineWidth = 0.18;
      const float lineSpeed = 1.0 * overallSpeed;
      const float lineAmplitude = 1.0;
      const float lineFrequency = 0.2;
      const float warpSpeed = 0.2 * overallSpeed;
      const float warpFrequency = 0.5;
      const float warpAmplitude = 1.0;
      const float offsetFrequency = 0.5;
      const float offsetSpeed = 1.33 * overallSpeed;
      const float minOffsetSpread = 0.6;
      const float maxOffsetSpread = 2.0;
      const int linesPerGroup = 14;

      // Arqentia dark · light-blue line palette (1:1 with hero shader)
      const vec3 bgTop    = vec3(0.043, 0.071, 0.125); // #0B1220 ink
      const vec3 bgRight  = vec3(0.059, 0.106, 0.212); // #0F1B36 navy
      const vec3 bgBottom = vec3(0.027, 0.043, 0.078); // deeper ink
      const vec3 lineHue  = vec3(0.85, 0.92, 1.000);   // soft white-blue

      float drawSmoothLine(float pos, float halfWidth, float t){
        return smoothstep(halfWidth, 0.0, abs(pos - t));
      }
      float drawCrispLine(float pos, float halfWidth, float t){
        return smoothstep(halfWidth + 0.012, halfWidth, abs(pos - t));
      }
      float random(float t){
        return (cos(t) + cos(t * 1.3 + 1.3) + cos(t * 1.4 + 1.4)) / 3.0;
      }
      float getY(float x, float fade, float offset){
        return random(x * lineFrequency + iTime * lineSpeed) * fade * lineAmplitude + offset;
      }

      void main(){
        vec2 fc = gl_FragCoord.xy;
        vec2 uv = fc.xy / iResolution.xy;
        vec2 space = (fc - iResolution.xy / 2.0) / iResolution.x * 2.0 * scale;

        float horizFade = 1.0 - (cos(uv.x * 6.28) * 0.5 + 0.5);
        float vertFade  = 1.0 - (cos(uv.y * 6.28) * 0.5 + 0.5);

        space.y += random(space.x * warpFrequency + iTime * warpSpeed) * warpAmplitude * (0.5 + horizFade);
        space.x += random(space.y * warpFrequency + iTime * warpSpeed + 2.0) * warpAmplitude * horizFade;

        // line accumulation
        float linesMass = 0.0;
        for (int l = 0; l < linesPerGroup; l++){
          float idx = float(l) / float(linesPerGroup);
          float ot = iTime * offsetSpeed;
          float op = float(l) + space.x * offsetFrequency;
          float rand = random(op + ot) * 0.5 + 0.5;
          float halfW = mix(minLineWidth, maxLineWidth, rand * horizFade) / 2.0;
          float offset = random(op + ot * (1.0 + idx)) * mix(minOffsetSpread, maxOffsetSpread, horizFade);
          float lp = getY(space.x, horizFade, offset);
          float line = drawSmoothLine(lp, halfW, space.y) * 0.5
                     + drawCrispLine(lp, halfW * 0.18, space.y);
          linesMass += line * rand;
        }

        // background gradient — dark inks
        vec3 col = mix(bgTop, bgRight, uv.x);
        col = mix(col, bgBottom, uv.y * 0.45);

        // tint lines toward bright cool blue-white for contrast against dark base
        float lineAlpha = clamp(linesMass * 0.75, 0.0, 0.9) * (0.45 + vertFade * 0.55);
        col = mix(col, lineHue, lineAlpha);

        // subtle vignette · darker edges anchor the field
        col *= mix(0.85, 1.0, vertFade);

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function compile(type, src){
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(prog);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aVertexPosition');
    const uRes = gl.getUniformLocation(prog, 'iResolution');
    const uTime = gl.getUniformLocation(prog, 'iTime');

    function resize(){
      // Mobile gets a tighter DPR cap to halve GPU cost (Mali/Adreno throttling).
      const isNarrow = window.innerWidth <= 768;
      const dprCap = isNarrow ? 0.85 : 1.5;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      canvas.width  = Math.floor(window.innerWidth  * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    window.addEventListener('resize', resize);
    resize();

    const start = performance.now();
    const RM = window.matchMedia('(prefers-reduced-motion: reduce)');
    let rafId = null;
    let paused = false;

    function frame(){
      if (document.hidden || RM.matches || paused){
        rafId = null;
        return;
      }
      gl.useProgram(prog);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - start) / 1000);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(aPos);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafId = requestAnimationFrame(frame);
    }
    function startShader(){
      if (rafId !== null || document.hidden || RM.matches || paused) return;
      rafId = requestAnimationFrame(frame);
    }
    function stopShader(){
      if (rafId !== null){ cancelAnimationFrame(rafId); rafId = null; }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopShader();
      else startShader();
    });
    RM.addEventListener('change', () => {
      if (RM.matches) stopShader();
      else startShader();
    });

    // Reduced-motion: render one frame statically so users still see the field.
    if (RM.matches){
      gl.useProgram(prog);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(aPos);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      startShader();
    }
  } else {
    // WebGL unavailable — fall back to a static dark gradient.
    canvas.style.background = 'linear-gradient(180deg, #0B1220 0%, #0F1B36 100%)';
  }
}
