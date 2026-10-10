'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The hero's one piece of motion: sunlight on the floor of a shallow lagoon.
 *
 * Stand knee-deep at Belle Mare and look down — the surface ripples focus the sun into a slow,
 * shifting net of bright lines on the sand. This draws that net (and only that): white light, on a
 * transparent canvas, over the hero's pale water-coloured ground, fading out before the search field.
 * The ground itself is plain CSS, so with WebGL missing, or before the first frame, the hero is
 * simply the still gradient — never a blank or a broken box.
 *
 * How the net is made: scatter points on a plane, let each drift in a small loop, and light every
 * pixel by how close it sits to the BORDER between its two nearest points. Those borders always
 * join up into one continuous web — which is what makes it read as water rather than as scattered
 * sparkles — and a slow two-octave sine warp bends their straight edges into curves and gives the
 * whole sheet the sway of a swell. Lines are brightest where they are farthest from any point (the
 * junctions), as real ones are, and a second, finer and much fainter web sits behind the first.
 *
 * (A physically-derived version — lighting each pixel by how strongly a sum of sine ripples focuses
 * the light above it — was tried first. It is the "correct" model and it looked wrong: closed
 * blobs, not a net. Don't go back to it without rendering both side by side.)
 *
 * Cost is kept trivial on purpose: rendered at roughly a third of the CSS pixel count (soft light
 * wants no more), capped near 30fps, and stopped whenever the hero is off screen or the tab is hidden.
 * Under prefers-reduced-motion it draws one still frame and never animates.
 */

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;

vec2 hash2(vec2 p){
  return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
}

// x: distance to the nearest border between two points. y: distance to the nearest point.
vec2 cells(vec2 p,float t){
  vec2 i=floor(p),f=fract(p);
  float f1=9.,f2=9.;
  for(int y=-1;y<=1;y++){
    for(int x=-1;x<=1;x++){
      vec2 g=vec2(float(x),float(y));
      vec2 o=.5+.5*sin(t+6.2831*hash2(i+g));
      float d=length(g+o-f);
      if(d<f1){f2=f1;f1=d;}else if(d<f2){f2=d;}
    }
  }
  return vec2(f2-f1,f1);
}

float net(vec2 p,float t,float scale){
  vec2 w=p+.3*vec2(sin(p.y*2.3+t*.5),cos(p.x*2.1-t*.4))
        +.15*vec2(sin(p.y*5.1-t*.7+p.x*1.3),cos(p.x*4.7+t*.6-p.y*1.1));
  vec2 c=cells(w*scale,t*.8);
  float line=exp(-c.x*c.x/.00405);
  return line*(.45+.55*smoothstep(.25,.7,c.y))+.1*exp(-c.x/.22);
}

void main(){
  vec2 p=gl_FragCoord.xy/uRes.y;
  float light=net(p,uTime,3.)
    +.26*net(p+vec2(3.7+.06*sin(p.y*9.),1.9+.06*sin(p.x*8.)),uTime*1.2+5.,5.1);
  // Brightest under the header, gone by the bottom edge so it never meets the white page as a line.
  float alpha=min(light,1.)*smoothstep(.04,.78,gl_FragCoord.y/uRes.y)*.74;
  gl_FragColor=vec4(alpha);
}`;

export function LagoonLight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: true });
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vert = compile(gl.VERTEX_SHADER, VERT);
    const frag = compile(gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vert || !frag || !program) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // One triangle that covers the viewport.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');

    const resize = () => {
      const scale = 0.6;
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const draw = (seconds: number) => {
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, seconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The still frame (and the first one drawn): a moment chosen because the net composes well there.
    const OFFSET = 40;
    let raf = 0;
    let onScreen = true;
    let last = 0;
    let clock = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 32) return;
      // Clamp the step so returning to a backgrounded tab doesn't lurch the water forward.
      clock += Math.min(now - last, 64) / 1000;
      last = now;
      draw(OFFSET + clock * 0.34);
    };
    const start = () => {
      if (raf || still || !onScreen || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    draw(OFFSET);
    setLive(true);

    const observer = new IntersectionObserver(([entry]) => {
      onScreen = !!entry?.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    observer.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    const onResize = () => still && draw(OFFSET);
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      setLive(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    canvas.addEventListener('webglcontextlost', onLost);
    start();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onLost);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-[1400ms] ease-out ${
        live ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}
