import {
  CURL_SQUASH,
  DEFAULT_CURL_ANGLE,
  clampPeel,
  curlMetrics,
  curlRollRadius,
  entryPeelOffset,
  foldCurl,
  foldProgress,
  foldReflection,
  foldSpan,
  isSpringAtRest,
  SIGNIN_CURL_PAINT,
  stepSpring,
  type Spring,
} from "./curl-logic";

function hexToUnitRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

const SIGNIN_FRONT_RGB = hexToUnitRgb(SIGNIN_CURL_PAINT.face);
const SIGNIN_UNDER_RGB = hexToUnitRgb(SIGNIN_CURL_PAINT.underside);
const SIGNIN_RECESS_RGB = hexToUnitRgb(SIGNIN_CURL_PAINT.recessMid);

/*
 * The fold is drawn in two passes over the same little square of canvas.
 *
 * Pass 0 is the plane of the page: the recess the lifted corner has uncovered,
 * and the shadow the arch casts back onto the page beside it.
 *
 * Pass 1 is the flap itself — a strip of mesh laid across the corner triangle,
 * rolled through a half turn on a flattened cylinder tangent to the crease and
 * then run out flat across the page. Because the arc never passes half a turn
 * and the tail beyond it is level, the strip is already in painter's order from
 * crease to tip, so the piece that curls over correctly covers the piece
 * beneath it with no depth buffer at all.
 *
 * The flap's outline is therefore the corner triangle mirrored in the crease —
 * the same three points the drawn SVG fold joins up, so the two paths agree on
 * the silhouette rather than each approximating it separately.
 */

const VERTEX_SHADER = `
  attribute vec2 aUV;

  uniform vec2 uSize;
  uniform vec2 uFold;
  uniform vec2 uNormal;
  uniform vec2 uSpan;
  uniform float uPeel;
  uniform float uRoll;
  uniform float uSquash;
  uniform float uPass;

  varying vec2 vFlat;
  varying vec3 vNormal;
  varying vec3 vPoint;
  varying float vArc;
  varying float vEdge;

  const float PI = 3.14159265;

  void main() {
    vec2 tangent = vec2(-uNormal.y, uNormal.x);
    vec2 flatPoint;
    vec3 point;
    vec3 normal;
    float arc = 0.0;
    float edge = 64.0;

    if (uPass < 0.5) {
      flatPoint = aUV * uSize;
      point = vec3(flatPoint, 0.0);
      normal = vec3(0.0, 0.0, 1.0);
    } else {
      float depth = aUV.y * uPeel;
      float remaining = uPeel - depth;
      float low = uSpan.x * remaining;
      float high = uSpan.y * remaining;
      float lateral = mix(low - 0.75, high + 0.75, aUV.x);
      edge = min(lateral - low, high - lateral);

      flatPoint = uFold + tangent * lateral + uNormal * depth;

      /*
       * The sheet spends its curvature turning through a half circle at the
       * crease and then has none left, so it runs straight on from there and
       * lies back across the page. The tail is what carries the tip past the
       * crease and onto the corner's mirror image; uRoll is solved from the
       * fold so that lands exactly where the reflection says it should.
       *
       * The previous version rolled on a radius fixed in advance. At the
       * approved settings that ran the arc to 224 degrees: the tip swept
       * forward, came back round to the crease, and then stopped moving at all
       * while the outer fifth of the flap piled up on the crease behind it.
       *
       * Kept to plain ASCII: this string is handed straight to the driver.
       */
      arc = min(depth / uRoll, PI);
      float sine = sin(arc);
      float cosine = cos(arc);
      float tail = max(depth - PI * uRoll, 0.0);

      point = vec3(
        uFold + tangent * lateral + uNormal * (uRoll * sine - tail),
        uRoll * uSquash * (1.0 - cosine)
      );

      vec2 rolled = normalize(vec2(-uSquash * sine, cosine));
      normal = vec3(uNormal * rolled.x, rolled.y);
    }

    vec2 lifted = point.xy + vec2(-0.11, 0.09) * point.z;
    vec2 clip = vec2(
      lifted.x / uSize.x * 2.0 - 1.0,
      1.0 - lifted.y / uSize.y * 2.0
    );

    vFlat = flatPoint;
    vNormal = normal;
    vPoint = point;
    vArc = arc;
    vEdge = edge;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2 uSize;
  uniform vec2 uFold;
  uniform vec2 uNormal;
  uniform float uRadius;
  uniform float uPass;
  uniform vec3 uFrontColor;
  uniform vec3 uUnderColor;
  uniform vec3 uRecessColor;

  varying vec2 vFlat;
  varying vec3 vNormal;
  varying vec3 vPoint;
  varying float vArc;
  varying float vEdge;

  float hairline(float coordinate, float spacing) {
    float wave = abs(fract(coordinate / spacing) - 0.5);
    return smoothstep(0.5 - 1.2 / spacing, 0.5, wave);
  }

  void main() {
    vec3 light = normalize(vec3(-0.42, -0.55, 0.72));

    if (uPass < 0.5) {
      float depth = dot(vFlat - uFold, uNormal);

      float centre = uRadius * 0.52 - 5.0;
      float spread = uRadius * 0.80;
      float offset = (depth - centre) / spread;
      float cast = exp(-offset * offset);

      if (depth <= 0.0) {
        float alpha = cast * 0.40;
        gl_FragColor = vec4(vec3(0.004, 0.006, 0.026) * alpha, alpha);
        return;
      }

      float exposure = smoothstep(0.0, uRadius * 1.3, depth - uRadius * 0.5);
      float grid = max(hairline(vFlat.x, 13.0), hairline(vFlat.y, 13.0));

      vec3 colour = mix(vec3(0.012, 0.016, 0.052), uRecessColor, exposure);
      colour += vec3(0.52, 0.60, 0.94) * grid * 0.05 * exposure;
      colour += uUnderColor * (1.0 - exposure) * 0.11;
      colour *= 1.0 - cast * 0.42;

      float trim = clamp(min(uSize.x - vFlat.x, vFlat.y), 0.0, 1.0);
      gl_FragColor = vec4(colour * trim, trim);
      return;
    }

    vec3 normal = normalize(vNormal);
    vec3 view = normalize(vec3(-60.0, 60.0, 320.0) - vPoint);
    float facing = normal.z;
    vec3 colour;

    if (facing >= 0.0) {
      float diffuse = clamp(dot(normal, light), 0.0, 1.0);
      colour = uFrontColor * (0.62 + diffuse * 0.95);

      float bend = (vArc - 1.15) / 0.62;
      colour += uUnderColor * exp(-bend * bend) * 0.09;

      float sheen = pow(clamp(dot(reflect(-light, normal), view), 0.0, 1.0), 44.0);
      colour += vec3(0.60, 0.66, 0.86) * sheen * 0.20;
    } else {
      vec3 back = -normal;
      float diffuse = clamp(dot(back, light), 0.0, 1.0);
      float wrapped = clamp(dot(back, light) * 0.5 + 0.5, 0.0, 1.0);
      colour = uUnderColor * (0.20 + diffuse * 0.78 + wrapped * 0.22);

      float sheen = pow(clamp(dot(reflect(-light, back), view), 0.0, 1.0), 26.0);
      colour += vec3(1.0, 0.86, 0.58) * sheen * 0.22;
      colour *= 1.0 + sin((vFlat.x + vFlat.y) * 0.9) * 0.012;
    }

    float rim = pow(1.0 - abs(facing), 4.0);
    colour += vec3(0.30, 0.34, 0.48) * rim * 0.10;

    vec3 lipColour = facing >= 0.0
      ? vec3(0.80, 0.83, 0.94)
      : vec3(1.0, 0.92, 0.72);
    colour = mix(colour, lipColour, smoothstep(2.4, 0.0, vEdge) * 0.55);

    float alpha = clamp(vEdge + 0.75, 0.0, 1.0);
    gl_FragColor = vec4(colour * alpha, alpha);
  }
`;

/** Along the crease the flap is straight, so it needs very few columns. */
const FLAP_COLUMNS = 12;
/** Around the roll it is not, and this is where the silhouette is judged. */
const FLAP_ROWS = 44;

const DEFAULT_DPR_CAP = 1.75;
const ENTRY_DURATION = 1150;

export interface CurlRendererOptions {
  dprCap?: number;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface CurlRenderer {
  setTarget(peel: number, angle: number): void;
  startEntry(): void;
  resize(width: number, height: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

interface Mesh {
  vertices: WebGLBuffer;
  indices: WebGLBuffer;
  count: number;
}

interface Resources {
  program: WebGLProgram;
  flap: Mesh;
  plane: Mesh;
  aUV: number;
  uniforms: {
    size: WebGLUniformLocation;
    fold: WebGLUniformLocation;
    normal: WebGLUniformLocation;
    span: WebGLUniformLocation;
    peel: WebGLUniformLocation;
    roll: WebGLUniformLocation;
    radius: WebGLUniformLocation;
    squash: WebGLUniformLocation;
    pass: WebGLUniformLocation;
    frontColor: WebGLUniformLocation;
    underColor: WebGLUniformLocation;
    recessColor: WebGLUniformLocation;
  };
}

function requiredUniform(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    throw new Error(`CurlCorner shader uniform not found: ${name}`);
  }
  return location;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("CurlCorner could not allocate a shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`CurlCorner shader compilation failed: ${message}`);
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("CurlCorner could not allocate a shader program.");
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aUV");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown link error";
    gl.deleteProgram(program);
    throw new Error(`CurlCorner shader link failed: ${message}`);
  }

  return program;
}

function createGrid(
  gl: WebGLRenderingContext,
  columns: number,
  rows: number,
): Mesh {
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);
  let cursor = 0;
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      uvs[cursor++] = column / columns;
      uvs[cursor++] = row / rows;
    }
  }

  const indices = new Uint16Array(columns * rows * 6);
  cursor = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns + 1;
      const bottomRight = bottomLeft + 1;
      indices[cursor++] = topLeft;
      indices[cursor++] = bottomLeft;
      indices[cursor++] = topRight;
      indices[cursor++] = topRight;
      indices[cursor++] = bottomLeft;
      indices[cursor++] = bottomRight;
    }
  }

  const vertices = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (!vertices || !indexBuffer) {
    throw new Error("CurlCorner could not allocate mesh buffers.");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  return { vertices, indices: indexBuffer, count: indices.length };
}

function deleteMesh(gl: WebGLRenderingContext, mesh: Mesh) {
  gl.deleteBuffer(mesh.vertices);
  gl.deleteBuffer(mesh.indices);
}

function createResources(gl: WebGLRenderingContext): Resources {
  const program = createProgram(gl);
  let flap: Mesh | null = null;
  let plane: Mesh | null = null;

  try {
    flap = createGrid(gl, FLAP_COLUMNS, FLAP_ROWS);
    plane = createGrid(gl, 1, 1);
  } catch (failure) {
    if (flap) {
      deleteMesh(gl, flap);
    }
    if (plane) {
      deleteMesh(gl, plane);
    }
    gl.deleteProgram(program);
    throw failure;
  }

  return {
    program,
    flap,
    plane,
    aUV: gl.getAttribLocation(program, "aUV"),
    uniforms: {
      size: requiredUniform(gl, program, "uSize"),
      fold: requiredUniform(gl, program, "uFold"),
      normal: requiredUniform(gl, program, "uNormal"),
      span: requiredUniform(gl, program, "uSpan"),
      peel: requiredUniform(gl, program, "uPeel"),
      roll: requiredUniform(gl, program, "uRoll"),
      radius: requiredUniform(gl, program, "uRadius"),
      squash: requiredUniform(gl, program, "uSquash"),
      pass: requiredUniform(gl, program, "uPass"),
      frontColor: requiredUniform(gl, program, "uFrontColor"),
      underColor: requiredUniform(gl, program, "uUnderColor"),
      recessColor: requiredUniform(gl, program, "uRecessColor"),
    },
  };
}

export function createCurlRenderer(
  canvas: HTMLCanvasElement,
  options: CurlRendererOptions = {},
): CurlRenderer | null {
  // Annotated, not inferred. Handed a bare object literal, `getContext` misses
  // its "webgl"/"webgl2" overloads and falls through to the `(string, any)`
  // one, which hands back the whole RenderingContext union — canvas 2D and
  // bitmap contexts included — and every gl call below then fails to compile.
  const attributes: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  };

  const gl: WebGL2RenderingContext | WebGLRenderingContext | null =
    canvas.getContext("webgl2", attributes) ??
    canvas.getContext("webgl", attributes);

  if (!gl) {
    return null;
  }

  let resources: Resources | null = null;
  let disposed = false;
  let paused = false;
  let contextLost = false;
  let frameRequest: number | null = null;
  let lastTimestamp: number | null = null;
  let width = 200;
  let height = 200;
  let metrics = curlMetrics(200);

  let peel: Spring = { value: metrics.restPeel, velocity: 0 };
  let angle: Spring = { value: DEFAULT_CURL_ANGLE, velocity: 0 };
  let targetPeel = metrics.restPeel;
  let targetAngle = DEFAULT_CURL_ANGLE;
  let entryStartedAt: number | null = null;

  const dprCap = options.dprCap ?? DEFAULT_DPR_CAP;

  const disposeResources = () => {
    if (!resources || contextLost) {
      resources = null;
      return;
    }

    deleteMesh(gl, resources.flap);
    deleteMesh(gl, resources.plane);
    gl.deleteProgram(resources.program);
    resources = null;
  };

  const initialize = () => {
    disposeResources();
    resources = createResources(gl);
  };

  const drawMesh = (mesh: Mesh, aUV: number) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertices);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  };

  const draw = () => {
    if (!resources || disposed || contextLost) {
      return;
    }

    /*
     * The fold is placed by reflection, from the same helper the drawn fold
     * uses: the crease normal, the perpendicular foot the mesh is built from,
     * and the roll radius that lands the tip on the corner's mirror image.
     * Sharing the arithmetic is the point — the two paths drew measurably
     * different silhouettes while each computed its own.
     */
    const curl = foldCurl(foldProgress(peel.value, metrics));
    const reflection = foldReflection(
      width,
      0,
      peel.value,
      angle.value,
      curl,
      height,
    );
    const span = foldSpan(angle.value);
    const roll = curlRollRadius(peel.value, curl);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const { uniforms } = resources;
    gl.useProgram(resources.program);
    gl.uniform2f(uniforms.size, width, height);
    gl.uniform2f(uniforms.fold, reflection.footX, reflection.footY);
    gl.uniform2f(uniforms.normal, reflection.normalX, reflection.normalY);
    gl.uniform2f(uniforms.span, span.min, span.max);
    gl.uniform1f(uniforms.peel, peel.value);
    gl.uniform1f(uniforms.roll, roll);
    gl.uniform1f(uniforms.radius, metrics.radius);
    gl.uniform1f(uniforms.squash, CURL_SQUASH);
    // The BUILD_SPEC tokens, normalised to WebGL's 0–1 range. The underside is
    // a muted paper amber rather than the full accent: the accent only appears
    // where the light actually hits it.
    gl.uniform3f(uniforms.frontColor, ...SIGNIN_FRONT_RGB);
    gl.uniform3f(uniforms.underColor, ...SIGNIN_UNDER_RGB);
    gl.uniform3f(uniforms.recessColor, ...SIGNIN_RECESS_RGB);

    gl.uniform1f(uniforms.pass, 0);
    drawMesh(resources.plane, resources.aUV);

    gl.uniform1f(uniforms.pass, 1);
    drawMesh(resources.flap, resources.aUV);
  };

  const requestFrame = () => {
    if (
      frameRequest !== null ||
      paused ||
      disposed ||
      contextLost ||
      !resources
    ) {
      return;
    }

    frameRequest = window.requestAnimationFrame(frame);
  };

  const frame = (timestamp: number) => {
    frameRequest = null;
    if (paused || disposed || contextLost || !resources) {
      return;
    }

    const delta =
      lastTimestamp === null ? 1 / 60 : (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    const entryStart = entryStartedAt;
    let entryOffset = 0;
    if (entryStart !== null) {
      const elapsed = timestamp - entryStart;
      entryOffset = entryPeelOffset(
        elapsed,
        ENTRY_DURATION,
        metrics.restPeel * 0.34,
      );
      if (elapsed >= ENTRY_DURATION) {
        entryStartedAt = null;
      }
    }

    const reach = Math.min(metrics.maxPeel, targetPeel + entryOffset);
    peel = stepSpring(peel, reach, delta);
    angle = stepSpring(angle, targetAngle, delta, 120, 20);
    draw();

    if (
      entryStartedAt !== null ||
      !isSpringAtRest(peel, reach, 0.06, 0.9) ||
      !isSpringAtRest(angle, targetAngle, 0.0008, 0.006)
    ) {
      requestFrame();
      return;
    }

    // Snap the last fraction of a pixel away and stop asking for frames.
    peel = { value: reach, velocity: 0 };
    angle = { value: targetAngle, velocity: 0 };
    lastTimestamp = null;
    draw();
  };

  const resize = (nextWidth: number, nextHeight: number) => {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    // The box has changed size, so every depth measured from it has too. The
    // live spring is pulled back into range as well as the target, or a fold
    // caught mid-peel would sit outside the new box until the pointer moved.
    metrics = curlMetrics(Math.min(width, height));
    targetPeel = clampPeel(targetPeel, metrics);
    peel = { value: clampPeel(peel.value, metrics), velocity: peel.velocity };

    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    draw();
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    if (frameRequest !== null) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = null;
    }
    resources = null;
    options.onContextLost?.();
  };

  const onContextRestored = () => {
    if (disposed) {
      return;
    }

    contextLost = false;
    try {
      initialize();
      resize(width, height);
      options.onContextRestored?.();
      requestFrame();
    } catch {
      contextLost = true;
      options.onContextLost?.();
    }
  };

  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  try {
    initialize();
  } catch {
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    return null;
  }

  return {
    setTarget(nextPeel, nextAngle) {
      targetPeel = clampPeel(nextPeel, metrics);
      targetAngle = nextAngle;
      requestFrame();
    },

    startEntry() {
      entryStartedAt = performance.now();
      lastTimestamp = null;
      requestFrame();
    },

    resize,

    pause() {
      paused = true;
      lastTimestamp = null;
      if (frameRequest !== null) {
        window.cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
    },

    resume() {
      if (disposed || contextLost) {
        return;
      }
      paused = false;
      lastTimestamp = null;
      draw();
      requestFrame();
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (frameRequest !== null) {
        window.cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      disposeResources();
    },
  };
}
