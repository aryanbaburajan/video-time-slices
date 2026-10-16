import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';

const sceneHost = document.querySelector('#scene');
const status = document.querySelector('#status');
const timeSeekInput = document.querySelector('#time-seek');
const timeSeekOutput = document.querySelector('#time-seek-output');
const angleSeekInput = document.querySelector('#angle-seek');
const angleSeekOutput = document.querySelector('#angle-seek-output');
const videoName = document.querySelector('#video-name');
const demoButtons = document.querySelectorAll('[data-demo]');
const playSliceButton = document.querySelector('#play-slice');
const loadingMeter = document.querySelector('#loading-meter');
const loadingFill = document.querySelector('#loading-fill');
const loadingValue = document.querySelector('#loading-value');
const loadingDetail = document.querySelector('#loading-detail');
const sliceStorageKey = 'video-time-slices:plane';
const cameraStorageKey = 'video-time-slices:camera';
const defaultDemoUrl = 'https://raw.githubusercontent.com/aryanbaburajan/video-time-slices/main/public/sample-track-1.mp4';
const isMobile = navigator.userAgentData?.mobile ?? /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
const samplingProfile = isMobile
  ? { maxWidth: 854, maxHeight: 480, maxFrames: 60 }
  : { maxWidth: 1280, maxHeight: 720, maxFrames: 120 };

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
sceneHost.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101010);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
const volume = new THREE.Group();
scene.add(volume);
const volumeDepth = 1.6;
let volumeWidth = 1.6;
let volumeHeight = .9;
volume.position.x = -.58;
controls.target.copy(volume.position);
// A portrait viewport has a much narrower horizontal field of view, so start a
// little farther back to keep the complete volume comfortably in frame.
const initialCameraOffset = innerWidth <= 550 ? 4.2 : 2;
camera.position.copy(volume.position).add(new THREE.Vector3(initialCameraOffset, initialCameraOffset, -initialCameraOffset));

function persistCameraState() {
  try {
    localStorage.setItem(cameraStorageKey, JSON.stringify({
      position: camera.position.toArray(),
      target: controls.target.toArray()
    }));
  } catch { /* unavailable */ }
}

function restoreCameraState() {
  try {
    const savedCamera = JSON.parse(localStorage.getItem(cameraStorageKey));
    if (![savedCamera?.position, savedCamera?.target].every(value =>
      Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    )) return;
    camera.position.fromArray(savedCamera.position);
    controls.target.fromArray(savedCamera.target);
    controls.update();
  } catch { /* use default view */ }
}

controls.addEventListener('change', persistCameraState);

const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(volumeWidth, volumeHeight, volumeDepth)),
  new THREE.LineBasicMaterial({ color: 0xf5f5f0 })
);
volume.add(outline);

let video;
let videoObjectUrl;
let texture3d;
let loadController;
let playingSlice = false;
let sliceAnimation;
let videoDuration = 1;
let savedSliceSettings;
const sliceMaterial = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  toneMapped: false,
  uniforms: {
    volumeTexture: { value: null },
    volumeSize: { value: new THREE.Vector3(volumeWidth, volumeHeight, volumeDepth) }
  },
  vertexShader: `
    uniform vec3 volumeSize;
    varying vec3 vVolumeCoord;
    void main() {
      vVolumeCoord = vec3(position.x / volumeSize.x + .5, .5 - position.y / volumeSize.y, position.z / volumeSize.z + .5);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    precision highp float;
    precision highp sampler3D;
    uniform sampler3D volumeTexture;
    varying vec3 vVolumeCoord;
    void main() {
      vec4 pixel = texture(volumeTexture, clamp(vVolumeCoord, vec3(0.0), vec3(1.0)));
      gl_FragColor = vec4(pixel.rgb, 1.0);
    }`
});
const slice = new THREE.Mesh(new THREE.PlaneGeometry(volumeWidth, volumeHeight, 96, 54), sliceMaterial);
volume.add(slice);

function updateSlice() {
  const absoluteTime = Number(timeSeekInput.value);
  const angle = THREE.MathUtils.degToRad(Number(angleSeekInput.value));
  // At 45°, the slice runs from one temporal edge of the volume to the other.
  const offset = (videoDuration / 2) * Math.tan(angle);
  const leftTime = THREE.MathUtils.clamp(absoluteTime - offset, 0, videoDuration) / videoDuration;
  const rightTime = THREE.MathUtils.clamp(absoluteTime + offset, 0, videoDuration) / videoDuration;
  const positions = slice.geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const horizontal = positions.getX(index) / volumeWidth + .5;
    const time = THREE.MathUtils.lerp(leftTime, rightTime, horizontal);
    positions.setZ(index, THREE.MathUtils.lerp(-volumeDepth / 2, volumeDepth / 2, time));
  }
  positions.needsUpdate = true;
  slice.geometry.computeVertexNormals();
}

function persistSliceSettings() {
  try {
    localStorage.setItem(sliceStorageKey, JSON.stringify({
      absoluteTime: Number(timeSeekInput.value),
      angle: Number(angleSeekInput.value)
    }));
  } catch { /* unavailable */ }
}

function restoreSliceSettings() {
  try {
    savedSliceSettings = JSON.parse(localStorage.getItem(sliceStorageKey));
  } catch { /* use defaults */ }
}

function formatTime(time) {
  const minutes = Math.floor(time / 60);
  const seconds = (time % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}

function configureSeekers(duration) {
  videoDuration = duration;
  timeSeekInput.max = duration;
  timeSeekInput.value = THREE.MathUtils.clamp(Number(savedSliceSettings?.absoluteTime) || 0, 0, duration);
  const legacyAngle = Math.atan(
    ((Number(savedSliceSettings?.rightOffset) || 0) - (Number(savedSliceSettings?.leftOffset) || 0)) / duration
  ) * THREE.MathUtils.RAD2DEG;
  angleSeekInput.value = THREE.MathUtils.clamp(Number(savedSliceSettings?.angle ?? legacyAngle) || 0, -45, 45);
}

function seekSlice() {
  timeSeekOutput.value = formatTime(Number(timeSeekInput.value));
  angleSeekOutput.value = `${Number(angleSeekInput.value).toFixed(1)}°`;
  updateSlice();
  persistSliceSettings();
}
angleSeekInput.addEventListener('input', seekSlice);
timeSeekInput.addEventListener('input', seekSlice);

function toggleSlicePlayback() {
  if (playingSlice) {
    playingSlice = false;
    cancelAnimationFrame(sliceAnimation);
    playSliceButton.textContent = 'Play slice';
    return;
  }
  playingSlice = true;
  playSliceButton.textContent = 'Pause slice';
  const startedAt = performance.now();
  const start = Number(timeSeekInput.value);
  const duration = 6000;
  const animate = now => {
    if (!playingSlice) return;
    const advance = ((now - startedAt) / duration) * videoDuration;
    timeSeekInput.value = (start + advance) % videoDuration;
    seekSlice();
    sliceAnimation = requestAnimationFrame(animate);
  };
  sliceAnimation = requestAnimationFrame(animate);
}
playSliceButton.addEventListener('click', toggleSlicePlayback);

function waitFor(media, event, signal) {
  return new Promise((resolve, reject) => {
    const onEvent = () => { cleanup(); resolve(); };
    const onError = () => {
      cleanup();
      reject(media.error ?? new Error(`Video failed while waiting for ${event}.`));
    };
    const onAbort = () => { cleanup(); reject(new DOMException('Video loading was cancelled.', 'AbortError')); };
    const cleanup = () => {
      media.removeEventListener(event, onEvent);
      media.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    media.addEventListener(event, onEvent, { once: true });
    media.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function updateLoading(progress, detail) {
  const percent = Math.round(THREE.MathUtils.clamp(progress, 0, 1) * 100);
  loadingMeter.hidden = false;
  loadingFill.style.width = `${percent}%`;
  loadingValue.textContent = `${percent}%`;
  loadingDetail.textContent = detail;
}

function finishLoading() {
  loadingFill.style.width = '100%';
  loadingValue.textContent = '100%';
  setTimeout(() => { loadingMeter.hidden = true; }, 650);
}

async function captureFrames(media, width, height, depth, signal) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = new Uint8Array(width * height * depth * 4);
  for (let z = 0; z < depth; z++) {
    if (signal.aborted) throw new DOMException('Video loading was cancelled.', 'AbortError');
    const time = Math.min(media.duration - .001, Math.max(.001, (z / (depth - 1)) * (media.duration - .001)));
    const seeked = waitFor(media, 'seeked', signal);
    media.currentTime = time;
    await seeked;
    if (signal.aborted) throw new DOMException('Video loading was cancelled.', 'AbortError');
    context.drawImage(media, 0, 0, width, height);
    pixels.set(context.getImageData(0, 0, width, height).data, z * width * height * 4);
    updateLoading((z + 1) / depth, `Sampling control frame ${z + 1} / ${depth}`);
  }
  return { pixels, depth };
}

function disposeCurrentTrack() {
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video = null;
  }
  if (videoObjectUrl) {
    URL.revokeObjectURL(videoObjectUrl);
    videoObjectUrl = null;
  }
  if (texture3d) texture3d.dispose();
  texture3d = null;
  sliceMaterial.uniforms.volumeTexture.value = null;
}

function getVolumeResolution(sourceWidth, sourceHeight) {
  const { maxWidth, maxHeight } = samplingProfile;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}

async function buildVolume(source) {
  loadController?.abort();
  disposeCurrentTrack();
  const controller = new AbortController();
  loadController = controller;
  const { signal } = controller;
  status.hidden = false;
  status.textContent = 'Loading video…';
  updateLoading(0, 'Loading video metadata…');
  video = document.createElement('video');
  const media = video;
  // GitHub raw files are cross-origin; this keeps captured canvas frames readable.
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  videoObjectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  video.src = videoObjectUrl ?? source;
  videoName.textContent = typeof source === 'string' ? source.split('/').pop() : source.name;
  await waitFor(media, 'loadedmetadata', signal);
  if (media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor(media, 'loadeddata', signal);
  if (signal.aborted || media !== video) throw new DOMException('Video loading was cancelled.', 'AbortError');
  const sourceWidth = media.videoWidth;
  const sourceHeight = media.videoHeight;
  const depth = Math.min(samplingProfile.maxFrames, Math.max(24, Math.ceil(media.duration * 12)));
  const { width, height } = getVolumeResolution(sourceWidth, sourceHeight);
  configureSeekers(media.duration);
  volumeHeight = .9;
  volumeWidth = volumeHeight * width / height;
  outline.geometry.dispose();
  outline.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(volumeWidth, volumeHeight, volumeDepth));
  slice.geometry.dispose();
  slice.geometry = new THREE.PlaneGeometry(volumeWidth, volumeHeight, 96, 54);
  sliceMaterial.uniforms.volumeSize.value.set(volumeWidth, volumeHeight, volumeDepth);
  updateSlice();
  status.textContent = `Building ${width} × ${height} × ${depth} volume…`;
  updateLoading(0, 'Preparing control samples…');
  const { pixels } = await captureFrames(media, width, height, depth, signal);
  if (signal.aborted || media !== video) throw new DOMException('Video loading was cancelled.', 'AbortError');
  texture3d = new THREE.Data3DTexture(pixels, width, height, depth);
  texture3d.format = THREE.RGBAFormat;
  texture3d.type = THREE.UnsignedByteType;
  texture3d.minFilter = THREE.LinearFilter;
  texture3d.magFilter = THREE.LinearFilter;
  texture3d.unpackAlignment = 1;
  texture3d.needsUpdate = true;
  sliceMaterial.uniforms.volumeTexture.value = texture3d;
  status.textContent = `Ready · ${depth} samples · ${formatTime(media.duration)}`;
  finishLoading();
}

document.querySelector('#video-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  demoButtons.forEach(button => {
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
  });
  try { await buildVolume(file); } catch (error) {
    if (error.name === 'AbortError') return;
    loadingMeter.hidden = true;
    status.textContent = `Could not sample this video: ${error.message}`;
  }
});
demoButtons.forEach(button => button.addEventListener('click', async () => {
  demoButtons.forEach(demoButton => {
    const active = demoButton === button;
    demoButton.classList.toggle('is-active', active);
    demoButton.setAttribute('aria-pressed', active);
  });
  try { await buildVolume(button.dataset.demo); } catch (error) {
    if (error.name === 'AbortError') return;
    loadingMeter.hidden = true;
    status.textContent = `Could not load this demo: ${error.message}`;
  }
}));
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
function render() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
restoreSliceSettings();
restoreCameraState();
seekSlice();
render();
toggleSlicePlayback();
buildVolume(defaultDemoUrl).catch(error => {
  if (error.name === 'AbortError') return;
  loadingMeter.hidden = true;
  status.textContent = `Could not load the included sample: ${error.message}`;
});
