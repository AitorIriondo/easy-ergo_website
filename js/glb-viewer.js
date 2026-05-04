/* ============================================================
   EasyErgo — standalone GLB viewer
   Adapted from EE.Dashboard/wwwroot/js/fastsam3d-viewer.module.js
   so the marketing site can show the same animated body model.

   The dashboard's GLBs are *morph-target* animated (vertex deltas
   per frame), commonly with EXT_meshopt_compression. Google's
   <model-viewer> can't drive them out of the box, hence this
   bespoke viewer.

   Requirements (loaded by the page):
     - window.THREE             (three.min.js)
     - THREE.OrbitControls      (OrbitControls.js)
     - window.MeshoptDecoder    (meshopt_decoder.module.js, awaited)

   Public API exposed as window.EasyErgoGlbViewer:
     mount(container, opts) -> session
       opts: {
         src: '/path/to.glb',
         autoplay?: true,        // start animation immediately
         loop?: true,
         autoOrbit?: true,       // slowly orbit the camera
         orbitSpeed?: 0.3,       // rad/s
         interactive?: false,    // user can drag-orbit
         background?: 0x0f1f3d,  // hex color
         onProgress?: (pct) => {},
         onReady?: (state) => {},
         onError?: (err) => {},
       }
     session: { play(), pause(), reset(), dispose(), state() }
   ============================================================ */
(() => {
  'use strict';

  // ── GLB parsing ────────────────────────────────────────────
  const CT = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
    5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
  };
  const TS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};

  function parseGLB(buf) {
    const v = new DataView(buf);
    if (v.getUint32(0, true) !== 0x46546C67) throw new Error('Not a GLB');
    const jsonLen = v.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    return {gltf, binData: buf.slice(20 + jsonLen + 8)};
  }

  async function decompress(gltf, bin) {
    if (!gltf.extensionsUsed?.includes('EXT_meshopt_compression')) return bin;
    const M = await waitForMeshopt();
    if (!M) throw new Error('MeshoptDecoder not available');
    const views = gltf.bufferViews;
    const sizes = views.map((bv) => {
      const e = bv.extensions?.EXT_meshopt_compression;
      return e ? e.count * e.byteStride : bv.byteLength;
    });
    const offs = sizes.reduce((a, s) => {a.push(a[a.length - 1] + s); return a;}, [0]);
    const out = new Uint8Array(new ArrayBuffer(offs[views.length]));
    for (let i = 0; i < views.length; i++) {
      const bv = views[i];
      const e = bv.extensions?.EXT_meshopt_compression;
      if (e) {
        const src = new Uint8Array(bin, e.byteOffset ?? 0, e.byteLength);
        const dst = new Uint8Array(e.count * e.byteStride);
        if (e.mode === 'TRIANGLES') M.decodeIndexBuffer(dst, e.count, e.byteStride, src);
        else if (e.mode === 'INDICES') M.decodeIndexSequence(dst, e.count, e.byteStride, src);
        else {
          M.decodeVertexBuffer(dst, e.count, e.byteStride, src);
          if (e.filter === 'EXPONENTIAL') M.decodeFilterExp(dst, e.count, e.byteStride);
          else if (e.filter === 'OCTAHEDRAL') M.decodeFilterOct(dst, e.count, e.byteStride);
          else if (e.filter === 'QUATERNION') M.decodeFilterQuat(dst, e.count, e.byteStride);
        }
        out.set(dst, offs[i]);
        bv.byteOffset = offs[i]; bv.byteLength = e.count * e.byteStride;
        bv.byteStride = e.byteStride > 0 ? e.byteStride : undefined;
        delete bv.extensions;
      } else {
        out.set(new Uint8Array(bin, bv.byteOffset ?? 0, bv.byteLength), offs[i]);
        bv.byteOffset = offs[i];
      }
    }
    return out.buffer;
  }

  function waitForMeshopt() {
    if (window.MeshoptDecoder) return Promise.resolve(window.MeshoptDecoder);
    return new Promise((resolve) => {
      let n = 0;
      const tick = () => {
        n += 1;
        if (window.MeshoptDecoder || n > 80) {
          resolve(window.MeshoptDecoder ?? null);
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  function readF32(gltf, bin, idx) {
    const acc = gltf.accessors[idx], bv = gltf.bufferViews[acc.bufferView];
    const T = CT[acc.componentType], nc = TS[acc.type];
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const len = acc.count * nc * T.BYTES_PER_ELEMENT;
    const tmp = new Uint8Array(len); tmp.set(new Uint8Array(bin, off, len));
    const raw = new T(tmp.buffer);
    if (T === Float32Array) return raw;
    const ns = acc.normalized
      ? {5120: 1/127, 5121: 1/255, 5122: 1/32767, 5123: 1/65535}[acc.componentType] ?? 1
      : 1;
    const out = new Float32Array(acc.count * nc);
    for (let i = 0; i < out.length; i++) out[i] = raw[i] * ns;
    if (acc.normalized && acc.min && acc.max) {
      for (let j = 0; j < nc; j++) {
        const s = Math.max(Math.abs(acc.min[j]), Math.abs(acc.max[j]));
        if (s > 0) for (let i = 0; i < acc.count; i++) out[i * nc + j] *= s;
      }
    }
    return out;
  }

  function readRaw(gltf, bin, idx) {
    const acc = gltf.accessors[idx], bv = gltf.bufferViews[acc.bufferView];
    const T = CT[acc.componentType], nc = TS[acc.type];
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const len = acc.count * nc * T.BYTES_PER_ELEMENT;
    const tmp = new Uint8Array(len); tmp.set(new Uint8Array(bin, off, len));
    return new T(tmp.buffer);
  }

  // Shared buffer cache: key = src URL, value = Promise<ArrayBuffer>
  const bufferCache = new Map();
  // Per-src list of progress subscribers so multiple mounts of the same
  // src all see the bytes-arriving progress as the single in-flight fetch
  // streams in.
  const progressSubs = new Map();

  function fetchSharedBuffer(src, onProgress) {
    if (onProgress) {
      if (!progressSubs.has(src)) progressSubs.set(src, []);
      progressSubs.get(src).push(onProgress);
    }
    if (bufferCache.has(src)) {
      // Already fetched (or in flight). If it's done, fire 100 immediately.
      bufferCache.get(src).then(() => onProgress?.(100)).catch(() => {});
      return bufferCache.get(src);
    }

    const promise = (async () => {
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`GLB fetch failed: ${resp.status}`);
      const total = parseInt(resp.headers.get('Content-Length') || '0', 10);

      const fire = (pct) => {
        const subs = progressSubs.get(src) || [];
        subs.forEach((fn) => {try {fn(pct);} catch (_) {}});
      };

      let buf;
      if (total > 0 && resp.body) {
        const reader = resp.body.getReader();
        const chunks = []; let recv = 0;
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          chunks.push(value); recv += value.length;
          fire(Math.min(99, Math.round(recv / total * 100)));
        }
        buf = new Uint8Array(recv);
        let pos = 0; for (const c of chunks) {buf.set(c, pos); pos += c.length;}
        buf = buf.buffer;
      } else {
        buf = await resp.arrayBuffer();
      }
      fire(100);
      progressSubs.delete(src);
      return buf;
    })();
    bufferCache.set(src, promise);
    return promise;
  }

  function findFrame(timestamps, t) {
    const n = timestamps.length;
    if (t <= timestamps[0]) return 0;
    if (t >= timestamps[n - 1]) return n - 1;
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1;
      if (timestamps[m] <= t) lo = m; else hi = m;
    }
    return lo;
  }

  // ── Mount ──────────────────────────────────────────────────
  function mount(container, opts = {}) {
    const THREE = window.THREE;
    if (!THREE) throw new Error('THREE not loaded');
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) throw new Error('container not found');

    const o = Object.assign({
      autoplay: true,
      loop: true,
      autoOrbit: true,
      orbitSpeed: 0.3,
      interactive: false,
      background: 0x0F1F3D,
      // Camera placement around the body (in degrees).
      // yaw = 0   → camera at +Z (front)
      // yaw = 90  → camera at +X (right side)
      // yaw = 180 → camera at -Z (back)
      // yaw = 45  → 3/4 front-right (default — matches the original behaviour)
      // pitch     → vertical tilt; +ve looks down at the model.
      cameraYaw: 45,
      cameraPitch: 0,
      // Optional HTMLVideoElement to drive the GLB time. When provided,
      // we ignore our internal dt clock and map the GLB animation's
      // currentTime to (video.currentTime / video.duration) * glbDur.
      // This keeps the source video and the 3D model locked in sync
      // even across loop boundaries — drift is impossible because
      // there's a single source of truth for "where in the take we are".
      syncVideo: null,
    }, opts);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(o.background);

    // Camera
    let w = container.clientWidth || 1, h = container.clientHeight || 1;
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 200);
    camera.position.set(2.2, 1.4, 2.6);

    // Renderer
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
    container.replaceChildren(renderer.domElement);

    // Lights — borrowed from dashboard's easyai3d
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const hemi = new THREE.HemisphereLight(0xffffff, 0x111827, 0.55);
    hemi.position.set(0, 2, 0); scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2.5, 4.0, 2.5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-3.5, 1.8, 2.0); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.75);
    rim.position.set(-1.0, 4.5, -3.0); scene.add(rim);

    // Optional orbit controls
    let controls = null;
    if (o.interactive && THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.target.set(0, 0.9, 0);
      controls.update();
    }

    // Resize: re-frame the model so width changes don't cut off limbs.
    let rootGroup = null;
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => {
      w = container.clientWidth || 1; h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (rootGroup) frameModel(rootGroup);
    }) : null;
    ro?.observe(container);

    // Pause RAF when off-screen — keeps multiple viewers from saturating
    // the main thread + competing for video decode bandwidth.
    let inView = true;
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        inView = entries.some((e) => e.isIntersecting);
      }, {threshold: 0.01});
      io.observe(container);
    }

    // Animation state
    let posAttr = null;
    let bodyMesh = null;
    let overlays = [];
    let anim = null; // {timestamps, basePos, morphDeltas, nVerts3}
    let duration = 0;
    let curT = 0;
    let isPlaying = false;
    let isLooping = !!o.loop;
    let lastTs = 0;
    let frameId = 0;
    let disposed = false;

    // Auto-orbit state (used when controls is null OR user hasn't touched it)
    const lookTarget = new THREE.Vector3(0, 0.9, 0);
    let orbitAngle = Math.atan2(camera.position.z, camera.position.x);
    let orbitRadius = Math.hypot(camera.position.x, camera.position.z);
    let orbitY = camera.position.y;

    function applyFrameAt(t) {
      if (!anim) return;
      const {timestamps, basePos, morphDeltas, nVerts3} = anim;
      const dur = timestamps[timestamps.length - 1];
      const tt = isLooping && dur > 0 ? ((t % dur) + dur) % dur : Math.min(Math.max(t, 0), dur);
      const f = findFrame(timestamps, tt);
      const dst = posAttr.array;
      if (f === 0) {
        dst.set(basePos);
      } else {
        const off = (f - 1) * nVerts3;
        for (let i = 0; i < nVerts3; i++) dst[i] = basePos[i] + morphDeltas[off + i];
      }
      posAttr.needsUpdate = true;

      const q = new THREE.Quaternion();
      for (const ov of overlays) {
        if (ov.trans) {
          const i3 = f * 3;
          ov.mesh.position.set(ov.trans[i3], ov.trans[i3 + 1], ov.trans[i3 + 2]);
        }
        if (ov.rot) {
          const i4 = f * 4;
          q.set(ov.rot[i4], ov.rot[i4 + 1], ov.rot[i4 + 2], ov.rot[i4 + 3]);
          ov.mesh.quaternion.copy(q);
        }
        if (ov.scl) {
          const i3 = f * 3;
          ov.mesh.scale.set(ov.scl[i3], ov.scl[i3 + 1], ov.scl[i3 + 2]);
        }
      }
    }

    function frameModel(group) {
      // Stand the model up: the EasyErgo GLBs are Z-up; rotate so the
      // long axis (height) is along Y.
      group.position.set(0, 0, 0);
      group.rotation.set(0, 0, 0);
      group.scale.set(1, 1, 1);

      const pre = new THREE.Box3().setFromObject(group);
      const preSize = new THREE.Vector3(); pre.getSize(preSize);
      if (preSize.z >= preSize.x && preSize.z >= preSize.y) {
        group.rotation.x = -Math.PI / 2;
      }

      let box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3(); box.getSize(size);
      const targetH = 1.7; // m
      const s = Math.min(1e4, Math.max(1e-4, targetH / Math.max(size.y, 1e-6)));
      group.scale.multiplyScalar(s);

      // Re-centre: feet on Y=0, X/Z centred at origin.
      box = new THREE.Box3().setFromObject(group);
      const c = new THREE.Vector3(); box.getCenter(c);
      group.position.set(-c.x, -box.min.y, -c.z);

      // Final bounding box → frame so the WHOLE body is in view.
      box = new THREE.Box3().setFromObject(group);
      const bodyH = box.max.y - box.min.y;
      const fc = new THREE.Vector3(); box.getCenter(fc);

      // Aim straight at the body's vertical centre (head AND feet visible).
      lookTarget.set(fc.x, fc.y, fc.z);

      // Distance: pick whatever covers both width AND height with margin.
      // Half-vertical FoV in radians:
      const aspect = camera.aspect || 1;
      const vFovRad = camera.fov * Math.PI / 180;
      const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
      const halfW = (box.max.x - box.min.x) / 2;
      const distForH = bodyH / 2 / Math.tan(vFovRad / 2);
      const distForW = halfW / Math.tan(hFovRad / 2);
      const dist = Math.max(distForH, distForW) * 1.35; // margin

      // Convert yaw/pitch (deg) to camera position around the look target.
      const yawRad = (o.cameraYaw * Math.PI) / 180;
      const pitchRad = (o.cameraPitch * Math.PI) / 180;
      const horizDist = dist * Math.cos(pitchRad);
      const vertOffset = dist * Math.sin(pitchRad);
      camera.position.set(
        fc.x + horizDist * Math.sin(yawRad),
        fc.y + vertOffset,
        fc.z + horizDist * Math.cos(yawRad),
      );
      camera.lookAt(lookTarget);
      camera.near = Math.max(0.01, dist / 100);
      camera.far = Math.max(200, dist * 100);
      camera.updateProjectionMatrix();

      // Orbit state in sync with the new camera placement.
      orbitAngle = Math.atan2(camera.position.z - lookTarget.z, camera.position.x - lookTarget.x);
      orbitRadius = Math.hypot(camera.position.x - lookTarget.x, camera.position.z - lookTarget.z);
      orbitY = camera.position.y;

      if (controls) {controls.target.copy(lookTarget); controls.update();}
    }

    function buildFromGltf(gltf, bin) {
      const group = new THREE.Group();

      const prim = gltf.meshes[0].primitives[0];
      const targets = prim.targets ?? [];
      const nMorphs = targets.length;
      const nFrames = nMorphs + 1;

      const basePos = new Float32Array(readF32(gltf, bin, prim.attributes.POSITION));
      const rawIdx = readRaw(gltf, bin, prim.indices);
      const indices = rawIdx instanceof Uint32Array ? rawIdx : new Uint32Array(rawIdx);
      const nVerts3 = basePos.length;

      const morphDeltas = new Float32Array(nMorphs * nVerts3);
      for (let m = 0; m < nMorphs; m++) {
        const d = readF32(gltf, bin, targets[m].POSITION);
        morphDeltas.set(d, m * nVerts3);
      }

      const geo = new THREE.BufferGeometry();
      posAttr = new THREE.BufferAttribute(new Float32Array(basePos), 3);
      geo.setAttribute('position', posAttr);
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();

      const pbr = gltf.materials?.[prim.material]?.pbrMetallicRoughness ?? {};
      const [r, g, b, a] = pbr.baseColorFactor ?? [0.45, 0.62, 0.82, 0.85];
      const bodyMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(r, g, b),
        transparent: true,
        opacity: Math.max(a, 0.7),
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      bodyMesh = new THREE.Mesh(geo, bodyMat);
      group.add(bodyMesh);

      // Animation timestamps
      const animDef = gltf.animations?.[0];
      let timestamps = null;
      if (animDef) {
        const wCh = animDef.channels.find((c) => c.target.path === 'weights');
        if (wCh) timestamps = Array.from(readF32(gltf, bin, animDef.samplers[wCh.sampler].input));
      }
      if (!timestamps || timestamps.length !== nFrames) {
        timestamps = Array.from({length: nFrames}, (_, i) => i / 30);
      }

      // Joint / bone overlay
      const sphG = new THREE.SphereGeometry(1, 8, 5);
      const cylG = new THREE.CylinderGeometry(1, 1, 1, 6);
      const nodeData = {};
      if (animDef) {
        for (const ch of animDef.channels) {
          if (ch.target.node === 0) continue;
          const n = ch.target.node;
          if (!nodeData[n]) nodeData[n] = {};
          nodeData[n][ch.target.path] = readF32(gltf, bin, animDef.samplers[ch.sampler].output);
        }
      }
      for (const [nIdxStr, ch] of Object.entries(nodeData)) {
        const nIdx = +nIdxStr;
        const node = gltf.nodes?.[nIdx];
        const mIdx = node?.mesh;
        const mPrim = mIdx != null ? gltf.meshes?.[mIdx]?.primitives?.[0] : null;
        const npbr = gltf.materials?.[mPrim?.material]?.pbrMetallicRoughness ?? {};
        const [nr, ng, nb] = npbr.baseColorFactor ?? [1, 1, 1, 1];
        const mat = new THREE.MeshPhongMaterial({color: new THREE.Color(nr, ng, nb)});
        const isBone = ch.translation && ch.rotation && ch.scale;
        const mesh = new THREE.Mesh(isBone ? cylG : sphG, mat);
        if (!isBone) {const s = node?.scale ?? [0.012, 0.012, 0.012]; mesh.scale.set(s[0], s[1], s[2]);}
        group.add(mesh);
        overlays.push({mesh, trans: ch.translation, rot: ch.rotation, scl: ch.scale});
      }

      anim = {nFrames, nVerts3, basePos, morphDeltas, timestamps};
      duration = timestamps[timestamps.length - 1];
      curT = 0;
      applyFrameAt(0);

      scene.add(group);
      rootGroup = group;
      frameModel(group);
    }

    async function load(src) {
      // Buffer cache shared across all mounts so the hero + demo viewers
      // don't fetch the same 56 MB GLB twice.
      const buf = await fetchSharedBuffer(src, opts.onProgress);

      // Parse + decompress is per-mount (each viewer mutates the gltf
      // bufferViews when decompressing, so we can't share a parsed gltf).
      const {gltf, binData: rawBin} = parseGLB(buf.slice(0));
      const bin = await decompress(gltf, rawBin);
      buildFromGltf(gltf, bin);
    }

    function tick(ts) {
      if (disposed) return;
      frameId = requestAnimationFrame(tick);

      // When off-screen, skip everything except the RAF schedule. This
      // keeps multiple viewers from competing with each other and with
      // video decode for main-thread time.
      if (!inView) {lastTs = 0; return;}

      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
      lastTs = ts;

      if (anim) {
        const v = o.syncVideo;
        if (
          v &&
          Number.isFinite(v.duration) &&
          v.duration > 0 &&
          Number.isFinite(v.currentTime)
        ) {
          // Lock GLB time to the source video — same loop boundaries,
          // no drift. Map [0..videoDuration] → [0..glbDuration] so the
          // pose advances proportionally even if the two clips have
          // slightly different durations.
          const ratio = v.currentTime / v.duration;
          curT = ratio * duration;
          applyFrameAt(curT);
        } else if (isPlaying) {
          // Fallback: internal clock (used before the video has loaded
          // its metadata, or when no syncVideo is supplied).
          curT += dt;
          if (curT >= duration) {
            if (isLooping) curT = curT % duration;
            else {curT = duration; isPlaying = false;}
          }
          applyFrameAt(curT);
        }
      }

      if (o.autoOrbit && (!controls || !controls._userInteracted)) {
        orbitAngle += o.orbitSpeed * dt;
        camera.position.x = lookTarget.x + orbitRadius * Math.cos(orbitAngle);
        camera.position.z = lookTarget.z + orbitRadius * Math.sin(orbitAngle);
        camera.position.y = orbitY;
        camera.lookAt(lookTarget);
      }

      if (controls) controls.update();
      renderer.render(scene, camera);
    }

    if (controls) {
      controls.addEventListener('start', () => {controls._userInteracted = true;});
    }

    // Boot
    frameId = requestAnimationFrame(tick);
    load(o.src)
      .then(() => {
        if (o.autoplay) {isPlaying = true; lastTs = 0;}
        opts.onReady?.(state());
      })
      .catch((err) => {
        opts.onError?.(err);
      });

    function state() {
      return {
        isPlaying, isLooping, currentTime: curT, duration,
        hasModel: bodyMesh !== null,
      };
    }

    function dispose() {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      ro?.disconnect?.();
      io?.disconnect?.();
      controls?.dispose?.();
      bodyMesh?.geometry?.dispose?.();
      bodyMesh?.material?.dispose?.();
      overlays.forEach((ov) => {ov.mesh.geometry?.dispose?.(); ov.mesh.material?.dispose?.();});
      overlays = [];
      renderer.dispose?.();
      container.replaceChildren?.();
    }

    return {
      play() {if (anim) {isPlaying = true; lastTs = 0;}},
      pause() {isPlaying = false;},
      reset() {curT = 0; lastTs = 0; if (anim) applyFrameAt(0);},
      state,
      dispose,
    };
  }

  window.EasyErgoGlbViewer = {mount};
})();
