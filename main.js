import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURATION & CONSTANTS ---
const BELL_SPACING = 0.575;
const BELL_Y_POSITION = 2.18;
const PIVOT_Y_POSITION = 2.25;

// Song: "We Wish You A Merry Christmas"
// Maps 0-indexed bell positions to sequence
// Notes: 0=D6, 1=E6, 2=F#6, 3=G6, 4=A6, 5=B6, 6=C7
const SONG_SEQUENCE = [
  0, 3, 3, 4, 3, 2, 1, 1, 1, 4, 4, 5, 4, 3, 2, 
  0, 0, 5, 5, 6, 5, 4, 3, 1, 0, 0, 1, 4, 2, 3
];

const NOTE_NAMES = ['D6', 'E6', 'F#6', 'G6', 'A6', 'B6', 'C7'];

const SOUND_URLS = [
  'https://assets.babylonjs.com/sound/holiday2021/d6.mp3',
  'https://assets.babylonjs.com/sound/holiday2021/e6.mp3',
  'https://assets.babylonjs.com/sound/holiday2021/f%236.mp3', // Encoded '#' as '%23'
  'https://assets.babylonjs.com/sound/holiday2021/g6.mp3',
  'https://assets.babylonjs.com/sound/holiday2021/a6.mp3',
  'https://assets.babylonjs.com/sound/holiday2021/b6.mp3',
  'https://assets.babylonjs.com/sound/holiday2021/c7.mp3'
];

const AMBIENT_SOUND_URL = 'https://assets.babylonjs.com/sound/Snow_Man_Scene/winterWoods.mp3';

// --- APPLICATION STATE ---
let scene, camera, renderer, controls;
let clock = new THREE.Clock();
let bellPivots = []; // Group objects acting as pivots for each bell
let bellMeshes = [];  // Reference to the actual bell mesh objects
let arborGlowMaterials = []; // Emissive materials on the archway that will glow
let snowParticles;
let sequenceProgress = 0; // Current note index in SONG_SEQUENCE
let isSnowing = false;
let snowIntensity = 0.0;
let signGlowIntensity = 0.0;

// Audio variables
let bgAudio;
let bellAudios = [];
let isBgAudioPlaying = false;

// Loader & UI elements
const progressBar = document.getElementById('progress-bar');
const loaderStatus = document.getElementById('loader-status');
const startBtn = document.getElementById('start-btn');
const loaderOverlay = document.getElementById('loader-overlay');
const bgSoundBtn = document.getElementById('bg-sound-btn');
const sequenceProgressBar = document.getElementById('sequence-progress');
const sequencePercent = document.getElementById('sequence-percent');
const notesQueue = document.getElementById('notes-queue');
const resetBtn = document.getElementById('reset-song-btn');
const congratsSplash = document.getElementById('congrats-splash');
const congratsCloseBtn = document.getElementById('congrats-close-btn');

// --- INITIALIZE THREE.JS SCENE ---
function init() {
  // 1. Scene setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0.72, 0.82, 0.95);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.72, 0.82, 0.95), 0.05);

  // 2. Camera setup
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 2.5, 4.5);

  // 3. Renderer setup
  const canvas = document.getElementById('webgl-canvas');
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  // 4. OrbitControls setup
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground
  controls.minDistance = 1.5;
  controls.maxDistance = 15;
  controls.target.set(0, 1.5, 0);

  // 5. Light setup
  const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.4);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x475569, 0.8);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(-2.5, 8.5, 10.75);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 25;
  dirLight.shadow.camera.left = -6;
  dirLight.shadow.camera.right = 6;
  dirLight.shadow.camera.top = 6;
  dirLight.shadow.camera.bottom = -6;
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0xa5f3fc, 0.8);
  fillLight.position.set(5.0, 3.0, -8.0);
  scene.add(fillLight);



  // Load assets and build the environment
  loadAssets();
  
  // Setup the visual queue for instructions
  setupNotesQueue();

  // Event Listeners
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  
  // UI interaction handlers
  bgSoundBtn.addEventListener('click', toggleBgAudio);
  resetBtn.addEventListener('click', resetSongProgress);
  congratsCloseBtn.addEventListener('click', () => {
    congratsSplash.classList.add('hidden');
  });

  // Start loop
  animate();
}

// --- LOADING ASSETS ---
function loadAssets() {
  const loadingManager = new THREE.LoadingManager();
  
  loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    const progress = (itemsLoaded / itemsTotal) * 100;
    progressBar.style.width = progress + '%';
    
    // Clean up filename for cleaner UI display
    const filename = url.split('/').pop().split('?')[0];
    loaderStatus.textContent = `Loading ${filename}... (${Math.round(progress)}%)`;
  };

  loadingManager.onLoad = () => {
    loaderStatus.textContent = 'All assets loaded successfully!';
    progressBar.style.width = '100%';
    // Reveal enter button
    startBtn.style.display = 'inline-block';
    
    startBtn.addEventListener('click', () => {
      // Fade out loader overlay
      loaderOverlay.style.opacity = 0;
      setTimeout(() => {
        loaderOverlay.style.display = 'none';
        
        // Start background music automatically on user gesture
        playBgAudio();
      }, 500);
    });
  };

  loadingManager.onError = (url) => {
    loaderStatus.textContent = `Error loading: ${url}. Retrying...`;
    console.error('Error loading asset:', url);
  };

  const gltfLoader = new GLTFLoader(loadingManager);

  // 1. Load Snow Field Ground
  gltfLoader.load('https://assets.babylonjs.com/meshes/Demos/Snow_Man_Scene/snowField.glb', (gltf) => {
    const snowFieldScene = gltf.scene;
    scene.add(snowFieldScene);
    
    snowFieldScene.traverse(child => {
      if (child.isMesh) {
        child.receiveShadow = true;
        child.material = new THREE.MeshPhongMaterial({
          color: 0xebf3fa,
          shininess: 10
        });
      }
    });
  });

  // 2. Load Holiday Arch and Bell
  gltfLoader.load('./holiday2021.glb', (gltf) => {
    const meshes = [];
    gltf.scene.traverse(child => {
      if (child.isMesh) {
        meshes.push(child);
      }
    });

    // In holiday2021.glb:
    // meshes[0] is the bell mesh template
    // meshes[1] is the arbor (archway frame)
    const baseBellMesh = meshes[0];
    const arborMesh = meshes[1];

    if (arborMesh) {
      scene.add(arborMesh);
      arborMesh.position.y -= 0.06;
      arborMesh.castShadow = true;
      arborMesh.receiveShadow = true;

      // Setup dynamic emissive materials for the arbor glow layers
      arborMesh.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            const newMaterials = materials.map(mat => {
              const name = mat.name.toLowerCase();
              const newMat = new THREE.MeshPhongMaterial({
                color: mat.color || new THREE.Color(0xffffff),
                map: mat.map,
                normalMap: mat.normalMap,
                emissiveMap: mat.emissiveMap, // Copy the emissive map mask
                emissive: mat.emissive ? new THREE.Color(mat.emissive) : new THREE.Color(0x000000),
                emissiveIntensity: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1.0,
                shininess: 30
              });
              
              const isGlow = name.includes('glow') || name.includes('sign') || name.includes('light') || mat.emissiveMap || (mat.emissive && (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0));
              if (isGlow) {
                newMat.emissive.setHex(0xeab308); // Golden emission
                newMat.emissiveIntensity = 0.0;
                arborGlowMaterials.push(newMat);
              } else {
                newMat.emissive.setHex(0x000000);
                newMat.emissiveIntensity = 0.0;
              }
              return newMat;
            });
            
            child.material = Array.isArray(child.material) ? newMaterials : newMaterials[0];
          }
        }
      });
    }

    if (baseBellMesh) {
      // Configure template bell material for a premium look
      baseBellMesh.traverse(child => {
        if (child.isMesh) {
          child.material = new THREE.MeshPhongMaterial({
            color: 0xffd700, // Shiny gold
            shininess: 90,
            specular: 0xffffff
          });
          child.castShadow = true;
        }
      });

      // Clone and place the 7 bells
      let startX = Math.floor(SOUND_URLS.length / 2) * BELL_SPACING; // (7 / 2) * 0.575 = 1.725
      
      for (let i = 0; i < SOUND_URLS.length; i++) {
        // Create a pivot group representing the hinge anchor point
        const pivot = new THREE.Group();
        pivot.position.set(startX, PIVOT_Y_POSITION, 0);
        scene.add(pivot);

        // Physics properties for swinging simulation
        pivot.angle = 0;
        pivot.angularVelocity = 0;
        pivot.angularAcceleration = 0;
        pivot.damping = 0.98;
        pivot.restoringForce = 16.0; // Simulated gravity/length tension

        // Clone the bell and offset it downward so it hangs and swings around the pivot
        const bellClone = baseBellMesh.clone();
        
        // Babylon uses y=2.18 for bells and y=2.25 for anchors, difference is -0.07 local Y offset.
        // We set local position on the clone so it hinges properly from the group center.
        bellClone.position.set(0, -0.07, 0); 
        
        // Add bell index as userData for raycaster lookup
        bellClone.userData = { bellIndex: i };

        // Add clone to pivot
        pivot.add(bellClone);
        bellPivots.push(pivot);
        bellMeshes.push(bellClone);

        // Move to the next position (right-to-left)
        startX -= BELL_SPACING;
      }
    }
    console.log("GLTF holiday2021 loaded. Scene children:", scene.children.map(c => c.type));
  });

  // 3. Preload Sounds (Web Audio is bypassed here to use simple Audio elements for speed and caching)
  SOUND_URLS.forEach((url, i) => {
    const audio = new Audio(url);
    audio.preload = 'auto';
    bellAudios.push(audio);
  });

  bgAudio = new Audio(AMBIENT_SOUND_URL);
  bgAudio.loop = true;
  bgAudio.volume = 0.55;
  bgAudio.preload = 'auto';
}

// --- PHYSICS SIMULATION UPDATE ---
function updatePhysics(dt) {
  bellPivots.forEach(pivot => {
    // 1. Angular Acceleration = -RestoringForce * sin(angle)
    pivot.angularAcceleration = -pivot.restoringForce * Math.sin(pivot.angle);
    
    // 2. Velocity += Acceleration * dt
    pivot.angularVelocity += pivot.angularAcceleration * dt;
    
    // 3. Apply Damping (Frame-rate independent decay)
    pivot.angularVelocity *= Math.pow(pivot.damping, dt * 60);
    
    // 4. Update Angle += Velocity * dt
    pivot.angle += pivot.angularVelocity * dt;
    
    // 5. Apply rotation to group X axis (hinge direction)
    pivot.rotation.x = pivot.angle;
  });
}

// --- SNOW PARTICLE SYSTEM ---
function createSnowParticles() {
  const particleCount = 1200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const velocities = [];

  for (let i = 0; i < particleCount * 3; i += 3) {
    // Distribute snow particles around the scene box
    positions[i] = (Math.random() - 0.5) * 15;      // X
    positions[i + 1] = Math.random() * 10 - 2;      // Y (spread up to 8m height)
    positions[i + 2] = (Math.random() - 0.5) * 15;  // Z

    velocities.push({
      x: (Math.random() - 0.5) * 0.1,
      y: -0.6 - Math.random() * 0.6,
      z: (Math.random() - 0.5) * 0.1,
      driftAngle: Math.random() * Math.PI * 2,
      driftSpeed: 0.5 + Math.random() * 1.5
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Create smooth, round snowflakes
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  const texture = new THREE.CanvasTexture(canvas);

  const material = new THREE.PointsMaterial({
    size: 0.12,
    map: texture,
    transparent: true,
    opacity: 0.0, // Start transparent, we fade it in
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  snowParticles = new THREE.Points(geometry, material);
  scene.add(snowParticles);
  snowParticles.userData = { velocities };
}

function updateSnow(dt) {
  if (!snowParticles) {
    createSnowParticles();
  }

  // Smoothly fade in/out particle visibility depending on celebration mode
  const targetOpacity = isSnowing ? 0.95 : 0.0;
  snowParticles.material.opacity += (targetOpacity - snowParticles.material.opacity) * 2.0 * dt;

  const positions = snowParticles.geometry.attributes.position.array;
  const velocities = snowParticles.userData.velocities;

  for (let i = 0; i < positions.length; i += 3) {
    const velIndex = i / 3;
    const vel = velocities[velIndex];

    // Horizontal drift based on sine waves
    vel.driftAngle += vel.driftSpeed * dt;
    const currentDriftX = Math.sin(vel.driftAngle) * 0.25;

    // Apply motion
    positions[i] += (vel.x + currentDriftX) * dt;
    positions[i + 1] += vel.y * dt;
    positions[i + 2] += vel.z * dt;

    // Reset when hitting the bottom
    if (positions[i + 1] < -0.5) {
      positions[i] = (Math.random() - 0.5) * 15;
      positions[i + 1] = 8;
      positions[i + 2] = (Math.random() - 0.5) * 15;
    }
  }

  snowParticles.geometry.attributes.position.needsUpdate = true;
}

// --- INTERACTIVE & SONG LOGIC ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onPointerDown(e) {
  // Only register pointer interaction when loader is gone
  if (loaderOverlay.style.display !== 'none') return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Traverse through bell meshes to test intersection
  const intersects = raycaster.intersectObjects(bellMeshes, true);

  if (intersects.length > 0) {
    // Get the intersected mesh, go up to locate the clone with index metadata
    let hitObj = intersects[0].object;
    while (hitObj && hitObj.userData.bellIndex === undefined) {
      hitObj = hitObj.parent;
    }

    if (hitObj) {
      const bellIndex = hitObj.userData.bellIndex;
      triggerBell(bellIndex);
    }
  }
}

function triggerBell(index) {
  // 1. Kick the physics simulation with an angular impulse
  const pivot = bellPivots[index];
  if (pivot) {
    // Alternating impulse directions to keep swing visually dynamic
    const dir = Math.random() > 0.5 ? 1 : -1;
    pivot.angularVelocity += dir * 14.0;
  }

  // 2. Play the sound (reset time to allow rapid successive strikes)
  const sound = bellAudios[index];
  if (sound) {
    sound.currentTime = 0;
    sound.play().catch(err => console.log('Sound playback prevented:', err));
  }

  // 3. Update the We Wish You A Merry Christmas sequence
  checkSequence(index);
}

function setupNotesQueue() {
  notesQueue.innerHTML = '';
  SONG_SEQUENCE.forEach((bellIdx, index) => {
    const node = document.createElement('div');
    node.className = 'note-node';
    node.id = `note-${index}`;
    // Display note number (1-indexed for the legend)
    node.textContent = bellIdx + 1;
    node.setAttribute('data-note-name', NOTE_NAMES[bellIdx]);
    notesQueue.appendChild(node);
  });
  updateNotesQueueUI();
}

function updateNotesQueueUI() {
  const nodes = notesQueue.querySelectorAll('.note-node');
  nodes.forEach((node, index) => {
    node.className = 'note-node';
    if (index < sequenceProgress) {
      node.classList.add('passed');
    } else if (index === sequenceProgress) {
      node.classList.add('active');
    }
  });

  // Calculate percentage
  const percent = Math.round((sequenceProgress / SONG_SEQUENCE.length) * 100);
  sequenceProgressBar.style.width = percent + '%';
  sequencePercent.textContent = percent + '%';

  // Smooth scroll notes queue to keep active note centered
  if (sequenceProgress > 0) {
    const activeNode = document.getElementById(`note-${sequenceProgress}`);
    if (activeNode) {
      const containerWidth = notesQueue.parentElement.clientWidth;
      const nodeOffset = activeNode.offsetLeft;
      const scrollPosition = nodeOffset - containerWidth / 2 + 16; // Adjust centered offset
      notesQueue.style.transform = `translateX(${-Math.max(0, scrollPosition)}px)`;
    }
  } else {
    notesQueue.style.transform = 'translateX(0px)';
  }
}

function checkSequence(struckIndex) {
  const expectedIndex = SONG_SEQUENCE[sequenceProgress];
  
  if (struckIndex === expectedIndex) {
    // Advance progress
    sequenceProgress++;
    
    // Smoothly blend in sign illumination
    signGlowIntensity = (sequenceProgress / SONG_SEQUENCE.length) * 2.0;

    // Check if song completed
    if (sequenceProgress === SONG_SEQUENCE.length) {
      triggerCelebration();
    }
  } else {
    // Handle error strike feedback
    const activeNode = document.getElementById(`note-${sequenceProgress}`);
    if (activeNode) {
      activeNode.classList.add('error-state');
      setTimeout(() => {
        activeNode.classList.remove('error-state');
      }, 400);
    }
    
    // Reset progress
    sequenceProgress = 0;
    signGlowIntensity = 0.0;
    
    // Turn off snow if they fail during celebratory states
    if (isSnowing) {
      isSnowing = false;
    }
  }

  updateNotesQueueUI();
}

function triggerCelebration() {
  isSnowing = true;
  signGlowIntensity = 3.0; // Super bright glow
  
  // Show congrats card
  congratsSplash.classList.remove('hidden');
  
  // Confetti effect: swing all bells in unison!
  bellPivots.forEach((pivot, idx) => {
    setTimeout(() => {
      pivot.angularVelocity += 18.0;
      bellAudios[idx].currentTime = 0;
      bellAudios[idx].play().catch(e => {});
    }, idx * 120);
  });

  // Re-loop/clear congrats automatically after some time
  setTimeout(() => {
    congratsSplash.classList.add('hidden');
  }, 6000);
}

function resetSongProgress() {
  sequenceProgress = 0;
  signGlowIntensity = 0.0;
  isSnowing = false;
  updateNotesQueueUI();
  congratsSplash.classList.add('hidden');
}

// --- AUDIO PLAYBACK ---
function playBgAudio() {
  bgAudio.play()
    .then(() => {
      isBgAudioPlaying = true;
      bgSoundBtn.classList.add('active');
    })
    .catch(err => {
      console.log('Autoplay blocked by browser. User interaction needed.', err);
    });
}

function toggleBgAudio() {
  if (isBgAudioPlaying) {
    bgAudio.pause();
    isBgAudioPlaying = false;
    bgSoundBtn.classList.remove('active');
  } else {
    bgAudio.play().then(() => {
      isBgAudioPlaying = true;
      bgSoundBtn.classList.add('active');
    }).catch(e => console.error(e));
  }
}

// --- WINDOW RESIZE ---
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- ANIMATION LOOP ---
function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // Cap step size to avoid frame drops causing bugs

  // 1. Update Controls
  controls.update();

  // 2. Physics & pendulum simulation
  updatePhysics(dt);

  // 3. Snow rendering
  updateSnow(dt);

  // 4. Smoothly interpolate materials glow intensity
  arborGlowMaterials.forEach(mat => {
    // Fade emissiveIntensity towards the target signGlowIntensity value
    mat.emissiveIntensity += (signGlowIntensity - mat.emissiveIntensity) * 4.0 * dt;
  });

  // 5. Render Scene
  renderer.render(scene, camera);
}

// Start everything
init();
