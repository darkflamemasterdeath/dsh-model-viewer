import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { fetchViewerConfig, saveViewerConfig } from "../api";
import { logPerf } from "../perf";
import { acquireRenderer, releaseRenderer } from "./renderer-pool";
import { LoadingAnime } from "./loading";
import { buildDisplay, loadModelSource, modelExtensions } from "./load-model";
import { openSidebarFile, useSidebarPreview } from "./sidebar";

const page: CSSProperties = {
  boxSizing: "border-box",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: "28px 32px 40px",
  color: "var(--dsw-alias-label-primary)",
  font: "13px/20px inherit",
};

const bar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
  marginBottom: 16,
};

const title: CSSProperties = {
  margin: "0 16px 0 0",
  fontSize: 20,
  lineHeight: "28px",
  fontWeight: 500,
};

const notice: CSSProperties = {
  margin: 0,
  color: "var(--dsw-alias-label-secondary)",
};

const settingsPanel: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
  marginBottom: 16,
  padding: "12px 16px",
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: "var(--dsw-radius-lg)",
  background: "var(--dsw-alias-bg-layer-1)",
};

const settingsField: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "var(--dsw-alias-label-secondary)",
};

const settingsInput: CSSProperties = {
  width: 88,
  padding: "6px 10px",
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: 8,
  background: "transparent",
  color: "var(--dsw-alias-label-primary)",
  font: "13px/20px inherit",
};

const stageWrap: CSSProperties = {
  position: "relative",
  // Fill the remaining panel height so no blank is left below; floor at 360 for stacked turn previews.
  flex: "1 1 auto",
  minHeight: 360,
};

const stage: CSSProperties = {
  position: "absolute",
  inset: 0,
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: "var(--dsw-radius-lg)",
  overflow: "hidden",
  background: "var(--dsw-alias-bg-layer-1)",
};

const accept = modelExtensions.join(",");

/** Gradient sky backdrop: light blue on top to warm white below, painted once to replace a flat color. */
function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    // Doomsday dusk: ashen green sky -> burnt ember horizon -> scorched dark base.
    gradient.addColorStop(0, "#2b383a");
    gradient.addColorStop(0.5, "#4b4632");
    gradient.addColorStop(0.78, "#a05a2e");
    gradient.addColorStop(1, "#2e231c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Blood sun: a radial-gradient disc with glow, painted into the sky. */
function sunTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const glow = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    glow.addColorStop(0, "rgba(255, 202, 140, 1)");
    glow.addColorStop(0.22, "rgba(255, 138, 76, 0.92)");
    glow.addColorStop(0.55, "rgba(214, 92, 52, 0.32)");
    glow.addColorStop(1, "rgba(180, 70, 40, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Pick a model file, parse it, and orbit the result.
 */
export function Viewer({ file }: { file?: File }) {
  const sidebar = useSidebarPreview();
  const stageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState(
    file === undefined ? "选择一个模型文件" : file.name,
  );
  const [model, setModel] = useState<THREE.Object3D | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cacheCount, setCacheCount] = useState("4");
  const [cacheSizeMB, setCacheSizeMB] = useState("25");
  const [settingsNote, setSettingsNote] = useState("");

  function openSettings() {
    setSettingsNote("");
    setSettingsOpen((open) => !open);
    void fetchViewerConfig().then(
      (config) => {
        setCacheCount(String(config.cacheCount));
        setCacheSizeMB(String(config.cacheMinSizeMB));
      },
      () => setSettingsNote("配置读取失败"),
    );
  }

  function saveSettings() {
    const count = Number(cacheCount);
    const sizeMB = Number(cacheSizeMB);
    if (!Number.isInteger(count) || count < 0 || !Number.isFinite(sizeMB) || sizeMB < 0) {
      setSettingsNote("请输入非负数字");
      return;
    }
    void saveViewerConfig({ cacheCount: count, cacheMinSizeMB: sizeMB }).then(
      () => setSettingsNote("已保存，重启后生效"),
      () => setSettingsNote("保存失败"),
    );
  }

  function openFile(next: File) {
    setStatus("正在解析…");
    setModel(null);
    void loadModelSource(next).then(
      (source) => {
        setModel(buildDisplay(source));
        setStatus(next.name);
      },
      (error: unknown) => {
        setStatus(error instanceof Error ? error.message : "解析失败");
      },
    );
  }

  useEffect(() => {
    if (file === undefined) return;
    openFile(file);
  }, [file]);

  useEffect(() => {
    if (file !== undefined) return;
    if (sidebar?.source !== null && sidebar?.source !== undefined) {
      setModel(buildDisplay(sidebar.source));
      setStatus(sidebar.status);
      return;
    }
    setModel(null);
    setStatus(sidebar?.status ?? "选择一个模型文件");
  }, [file, sidebar]);

  useEffect(() => {
    const stageNode = stageRef.current;
    if (stageNode === null || model === null) return undefined;
    const setupStart = performance.now();
    const renderer = acquireRenderer();
    const scene = new THREE.Scene();
    const sky = skyTexture();
    scene.background = sky;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xfff4e8, 1.3);
    key.position.set(10, 10, 10);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xcdd6ea, 0.6);
    fill.position.set(-10, 5, -10);
    scene.add(fill);
    scene.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const center = box.getCenter(new THREE.Vector3());
    // Scale the clip planes with the model. Fixed 0.1/5000 only suits
    // hand-sized models: larger ones get cut by the far plane, tiny ones
    // vanish into the near plane.
    camera.near = maxDim * 0.005;
    camera.far = maxDim * 50;
    camera.updateProjectionMatrix();
    // Keep user zooming inside the valid depth range.
    controls.minDistance = maxDim * 0.02;
    controls.maxDistance = maxDim * 25;
    controls.target.copy(center);
    camera.position.set(
      center.x + maxDim * 1.5,
      center.y + maxDim,
      center.z + maxDim * 1.5,
    );
    const grid = new THREE.GridHelper(maxDim * 4, 40, 0x7a5238, 0x4a3a2c);
    grid.position.y = box.min.y - maxDim * 0.05;
    scene.add(grid);
    // Dust haze: distant objects fade into ash, pulling depth into the wasteland air.
    scene.fog = new THREE.Fog(0x241e18, maxDim * 3, maxDim * 12);
    // The blood sun hangs behind the model. A Sprite always faces the camera and opts out of fog.
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunTexture(),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    sun.scale.setScalar(maxDim * 3.2);
    sun.position.set(
      center.x - maxDim * 5,
      center.y + maxDim * 1.4,
      center.z - maxDim * 5,
    );
    scene.add(sun);
    stageNode.appendChild(renderer.domElement);

    let drawnWidth = 0;
    let drawnHeight = 0;
    const resize = () => {
      const width = stageNode.clientWidth;
      const height = stageNode.clientHeight;
      if (
        width === 0 ||
        height === 0 ||
        (width === drawnWidth && height === drawnHeight)
      )
        return;
      drawnWidth = width;
      drawnHeight = height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(window.devicePixelRatio);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stageNode);
    logPerf("webgl-setup (renderer + scene + camera + lights)", setupStart);
    let frame = 0;
    let firstFrame = true;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      const renderStart = firstFrame ? performance.now() : 0;
      renderer.render(scene, camera);
      if (firstFrame) {
        firstFrame = false;
        // First render does the one-time GPU buffer upload and shader compile.
        logPerf("webgl-first-render (upload + shader compile)", renderStart);
      }
    };
    animate();
    return () => {
      const disposeStart = performance.now();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.remove();
      releaseRenderer(renderer);
      sky.dispose();
      if (sun.material.map !== null) sun.material.map.dispose();
      sun.material.dispose();
      scene.remove(model);
      logPerf("webgl-teardown (dispose)", disposeStart);
    };
  }, [model]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (picked !== undefined) openSidebarFile(picked);
  }

  return (
    <div style={page}>
      <div style={bar}>
        <h1 style={title}>模型预览</h1>
        {file === undefined ? (
          <>
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              选择文件
            </Button>
            <Button variant="outline" onClick={openSettings}>
              缓存设置
            </Button>
          </>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={chooseFile}
        />
        <p style={notice}>{status}</p>
      </div>
      {settingsOpen && file === undefined ? (
        <div style={settingsPanel}>
          <label style={settingsField}>
            缓存个数
            <input
              style={settingsInput}
              type="number"
              min={0}
              value={cacheCount}
              onChange={(event) => setCacheCount(event.target.value)}
            />
          </label>
          <label style={settingsField}>
            超过该大小才缓存 (MB)
            <input
              style={settingsInput}
              type="number"
              min={0}
              value={cacheSizeMB}
              onChange={(event) => setCacheSizeMB(event.target.value)}
            />
          </label>
          <Button variant="outline" onClick={saveSettings}>
            保存
          </Button>
          <p style={notice}>{settingsNote || "修改后重启生效"}</p>
        </div>
      ) : null}
      <div style={stageWrap}>
        <div ref={stageRef} style={stage} />
        {status === "正在解析…" ? <LoadingAnime /> : null}
      </div>
    </div>
  );
}
