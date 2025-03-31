// Music Melee - Main Entry Point
import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import * as TONE from "tone";
import * as CANNON from "cannon-es";

// Initialize the game
async function init() {
  console.log("Music Melee initializing...");

  // Declare variables at the top level of init() function
  let roundStartTime: number = 0;
  let roundDuration: number = 120; // in seconds (2 minutes)
  let comboFadeTimeout: ReturnType<typeof setTimeout>;


  // Set up low-latency audio context configuration
  const audioContext = new AudioContext({ latencyHint: "interactive" });
  TONE.setContext(audioContext);

  // Setup Three.js scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#87CEEB");
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );

  // Add an AudioListener to the camera for 3D audio
  const audioListener = new THREE.AudioListener();
  camera.add(audioListener);

  // Cache Tone.js transport for scheduling events
  const transport = TONE.getTransport();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Optional: for a softer shadow look
  document.body.appendChild(renderer.domElement);

  // Setup Tone.js – resume audio context on first user interaction
  document.body.addEventListener(
    "click",
    async () => {
      if (TONE.getContext().state !== "running") {
        await TONE.start();
        // Reduce the lookAhead window for lower latency
        TONE.getContext().lookAhead = 0.01; // 10ms lookahead
        console.log("Tone.js audio context resumed with low latency settings");
      }

      // Remove the overlay once the user interacts
      const overlay = document.getElementById("startOverlay");
      if (overlay) overlay.remove();

      // Spawn the starting blocks now (if not already spawned)
      for (let i = 0; i < 50; i++) {
        spawnBlock();
      }

      // Wait 5 seconds, then begin the round
      setTimeout(() => {
        startRound();
      }, 5000);
    },
    { once: true },
  );

  // Setup physics
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -20, 0),
  });

  // Initialize PointerLockControls for first-person navigation
  const controls = new PointerLockControls(camera, renderer.domElement);
  // Optionally, trigger pointer lock on a user gesture (e.g., a click)
  renderer.domElement.addEventListener("click", () => {
    controls.lock();
  });

  camera.position.z = 5;

  // Create a visual ground plane
  const groundGeo = new THREE.PlaneGeometry(100, 100);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Remove ambient hemisphere light (we want the sun and block glow to be primary)
  // const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.2);
  // hemiLight.position.set(0, 200, 0);
  // scene.add(hemiLight);

  // Arena dimensions
  const arenaSize = 100; // width and depth

  // Wall parameters
  const wallThickness = 1;
  const wallHeight = 20;
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x999999 });
  const halfArena = arenaSize / 2;

  // Create a helper function to make a wall with matching physics body:
  function createWall(
    width: number,
    height: number,
    depth: number,
    pos: THREE.Vector3,
  ) {
    // Visual wall
    const wallGeo = new THREE.BoxGeometry(width, height, depth);
    const wallMesh = new THREE.Mesh(wallGeo, wallMaterial);
    wallMesh.position.copy(pos);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);

    // Create corresponding physics body (mass 0 for static)
    const halfExtents = new CANNON.Vec3(width / 2, height / 2, depth / 2);
    const wallShape = new CANNON.Box(halfExtents);
    const wallBody = new CANNON.Body({ mass: 0 });
    wallBody.addShape(wallShape);
    wallBody.position.set(pos.x, pos.y, pos.z);
    world.addBody(wallBody);
  }

  // Floor-level walls: center walls are raised so that their base sits on ground. Assume ground at y=0, so center wall at y = wallHeight/2

  // North wall (z = -halfArena)
  createWall(
    arenaSize,
    wallHeight,
    wallThickness,
    new THREE.Vector3(0, wallHeight / 2, -halfArena),
  );
  // South wall (z = halfArena)
  createWall(
    arenaSize,
    wallHeight,
    wallThickness,
    new THREE.Vector3(0, wallHeight / 2, halfArena),
  );
  // East wall (x = halfArena)
  createWall(
    wallThickness,
    wallHeight,
    arenaSize,
    new THREE.Vector3(halfArena, wallHeight / 2, 0),
  );
  // West wall (x = -halfArena)
  createWall(
    wallThickness,
    wallHeight,
    arenaSize,
    new THREE.Vector3(-halfArena, wallHeight / 2, 0),
  );

  // Define the sun's positions so that at the start and end it sits at the horizon.
  const horizonY = 5; // Adjust this value if needed so it appears "at the horizon"
  const startPos = new THREE.Vector3(
    -halfArena * 1.5,
    horizonY,
    -halfArena * 1.5,
  );
  const midPos = new THREE.Vector3(0, 120, 0); // Noon: sun is high overhead
  const endPos = new THREE.Vector3(halfArena * 1.5, horizonY, halfArena * 1.5);

  // Define sun colors: warm reddish at start, white at noon, sunset red at end.
  const startColor = new THREE.Color(0xff4500); // warm reddish
  const midColor = new THREE.Color(0xffffff); // white
  const endColor = new THREE.Color(0xff0000); // sunset red

  // Define sky colors: start (dawn/dusk redish) and noon (blue)
  const dawnSkyColor = new THREE.Color(0xff4500); // redish
  const noonSkyColor = new THREE.Color(0x87ceeb); // blue

  // Create the sun with its initial parameters
  const sun = new THREE.DirectionalLight(startColor, 2.5);
  sun.position.copy(startPos);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  scene.add(sun);

  // Create a visible sun sphere to simulate the sun
  const sunSphereGeometry = new THREE.SphereGeometry(6, 32, 32); // larger sphere (radius 6)
  const sunSphereMaterial = new THREE.MeshBasicMaterial({ color: startColor });
  const sunSphere = new THREE.Mesh(sunSphereGeometry, sunSphereMaterial);
  sunSphere.position.copy(startPos);
  scene.add(sunSphere);

  // Create a simple player physics body (using a sphere shape)
  const playerShape = new CANNON.Sphere(1);
  const playerBody = new CANNON.Body({ mass: 10 });
  playerBody.addShape(playerShape);
  playerBody.position.set(0, 2, 0); // start a bit above ground
  world.addBody(playerBody);

  // Create a static ground plane for the player to stand on
  const groundBody = new CANNON.Body({ mass: 0 });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  playerBody.addEventListener("collide", (e: any) => {
    const otherBody = e.body;
    // Check if the collided body is a block (it has an assigned synth)
    if (otherBody && otherBody.assignedSynth) {
      // Get its associated mesh
      const mesh = (otherBody as any).mesh;
      if (!mesh) return;
      // Flash the block white
      const originalColor = mesh.userData.originalColor;
      // Store the original emissive intensity.
      const originalEmissiveIntensity = (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity;
      // Flash: Override color and emissive properties to white and boost flash intensity.
      (mesh.material as THREE.MeshStandardMaterial).color.set(0xffffff);
      // Calculate timing error
      const timingErrorMs = computeTimingError();
      // If perfect timing, add glow by increasing emissive intensity temporarily.
      if (timingErrorMs < 30) {
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 3;
      } else {
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
      }
      (mesh.material as THREE.MeshStandardMaterial).emissive.set(0xffffff);
      setTimeout(() => {
        // Restore original color and a subtler emissive glow.
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(originalColor);
        (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(originalColor);
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
      }, 150);

      // Compute impact velocity (if available) and ignore very soft collisions
      const impactVelocity =
        e.contact && e.contact.getImpactVelocityAlongNormal
          ? e.contact.getImpactVelocityAlongNormal()
          : 0;
      // Removed minimum impact velocity check to ensure all collisions update the score

      // Use our helper function to compute volume based on distance and impact
      otherBody.assignedVolume.volume.value = computeCollisionVolume(
        mesh,
        camera,
        impactVelocity,
      );

      // Use a simple cooldown check:
      const now = performance.now();
      if (!otherBody.lastToneTime || now - otherBody.lastToneTime > 150) {
        otherBody.lastToneTime = now;
        lastCollisionTime = now;
        const note = otherBody.assignedTone;

        // Immediate triggering with no scheduling delay
        // Revised scoring: compute timing error and bonus multiplier
        const timingErrorMs = computeTimingError();
        if (timingErrorMs < 30) {
          // For perfect hit, trigger note at slightly higher volume
          otherBody.assignedSynth.triggerAttackRelease(note, "8n", undefined, 1.2);
        } else {
          otherBody.assignedSynth.triggerAttackRelease(note, "8n", undefined, 1);
        }

        // Measure actual audio start time for latency calculation
        lastAudioStartTime = performance.now();
        measuredLatency = lastAudioStartTime - lastCollisionTime;

        updateRhythmUI(note); // Update UI for player-driven collision actions
      }
    }
  });

  // Define an expanded array of possible tones (across multiple octaves)
  const tones = [
    "C3",
    "D3",
    "E3",
    "F3",
    "G3",
    "A3",
    "B3",
    "C4",
    "D4",
    "E4",
    "F4",
    "G4",
    "A4",
    "B4",
    "C5",
    "D5",
    "E5",
  ];

  // New block configuration: 12 colours from a rainbow spectrum; each maps to a note (A–G) as described.
  type BlockConfig = {
    color: number;
    synth: string;
    size: number;
    tone: string;
  };

  // Define a cozy retro palette of 12 colors (6 pairs)
  const retroColorPalette: number[] = [
    0x8b5e3c, // Cozy Cocoa primary (#8B5E3C)
    0xa67c52, // Cozy Cocoa variation (#A67C52)
    0xd5a42f, // Retro Mustard primary (#D5A42F)
    0xe2b755, // Retro Mustard variation (#E2B755)
    0x78866b, // Olive Grove primary (#78866B)
    0x8fa595, // Olive Grove variation (#8FA595)
    0x5c8c7b, // Muted Teal primary (#5C8C7B)
    0x78a394, // Muted Teal variation (#78A394)
    0xc27c83, // Dusty Rose primary (#C27C83)
    0xd1939a, // Dusty Rose variation (#D1939A)
    0x6b8ba4, // Soft Blue primary (#6B8BA4)
    0x87a2b9  // Soft Blue variation (#87A2B9)
  ];

  // Define a mapping from each of the 12 colour indices to a note.
  // Using standard 12-tone chromatic scale starting on C
  const noteMapping: string[] = [
    "C", // index 0
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];

  // Defensive check to ensure we have exactly 12 colors and 12 notes
  if (retroColorPalette.length !== 12 || noteMapping.length !== 12) {
    console.error(
      "Expected 12 colors and 12 notes for chromatic scale. Check your configuration.",
    );
  }

  // Allowed block sizes (only 4 sizes); the size determines the octave.
  const allowedSizes: number[] = [1.0, 2.0, 3.0, 4.0];

  // Map from block size to octave: 1.0 => octave 5, 2.0 => octave 4, 3.0 => octave 3, 4.0 => octave 2.
  const sizeToOctave: Record<number, number> = {
    1.0: 5,
    2.0: 4,
    3.0: 3,
    4.0: 2,
  };

  // Generate a randomized sequence of 150 block configurations.
  const blockSequence: BlockConfig[] = [];
  for (let i = 0; i < 150; i++) {
    // Randomly choose a colour index between 0 and 11.
    const colorIndex = Math.floor(Math.random() * retroColorPalette.length);
    const chosenColor = retroColorPalette[colorIndex];
    const noteLetter = noteMapping[colorIndex];

    // Randomly pick one of the allowed sizes.
    const chosenSize =
      allowedSizes[Math.floor(Math.random() * allowedSizes.length)];
    // Determine octave from size.
    const octave = sizeToOctave[chosenSize];
    // Full tone is the note letter concatenated with the octave.
    const fullTone = noteLetter + octave.toString();

    blockSequence.push({
      color: chosenColor,
      synth: "MetalSynth", // All blocks use MetalSynth
      size: chosenSize,
      tone: fullTone,
    });
  }
  // Global pointer for sequentially drawing from blockSequence
  let blockSeqIndex = 0;

  // Define global synth configuration object with optimized envelopes for low latency
  const synthConfigs: Record<string, any> = {
    Synth: {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 }, // Faster attack
    },
    MetalSynth: {
      // For example, use MembraneSynth defaults with faster attack:
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 },
    },
  };

  // Pre-allocate all audio processing nodes to avoid instantiation during gameplay
  const globalLimiter = new TONE.Limiter(-12);
  // Create a game volume node that will control all in-game sound effects.
  const globalGameVolume = new TONE.Volume(0);
  globalGameVolume.connect(globalLimiter);
  globalLimiter.toDestination();
  
  // --- Begin new background music setup ---

  const backgroundSynth = new TONE.PolySynth(TONE.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 2, decay: 1, sustain: 0.7, release: 3 },
  });
  backgroundSynth.volume.value = -18; // start quietly
  backgroundSynth.connect(globalLimiter);

  // Define two chord progressions for dynamic background music.

  // Early progression: a more exploratory, jazz-inspired sequence in C Lydian.
  const earlyProgression = [
    { time: "0:0:0", chord: ["C4", "E4", "G4", "B4"] },
    { time: "1:0:0", chord: ["A3", "C4", "E4", "G4"] },
    { time: "2:0:0", chord: ["D4", "F#4", "A4", "C5"] },
    { time: "3:0:0", chord: ["G3", "B3", "D4", "F#4"] }
  ];

  // Late progression: more variety – keeping it subtle and jazzy.
  const lateProgression = [
    { time: "0:0:0", chord: ["C4", "E4", "G4", "Bb4"] }, // C7
    { time: "1:0:0", chord: ["E4", "G4", "B4", "D5"] },
    { time: "2:0:0", chord: ["A3", "C4", "E4", "G4"] },    // Am7
    { time: "3:0:0", chord: ["D4", "F4", "A4", "C5"] },    // Dm7
    { time: "4:0:0", chord: ["G3", "B3", "D4", "F4"] },     // G7
    { time: "5:0:0", chord: ["F4", "A4", "C5", "E5"] },
    { time: "6:0:0", chord: ["Bb3", "D4", "F4", "Ab4"] },   // adds a subtle tension
    { time: "7:0:0", chord: ["C4", "E4", "G4", "Bb4"] }     // resolves back
  ];

  // Create a Tone.Part using the early progression and loop every 4 measures.
  const backgroundPart = new TONE.Part((time, value) => {
    backgroundSynth.triggerAttackRelease(value.chord, "1m", time);
  }, earlyProgression);
  backgroundPart.loop = true;
  backgroundPart.loopEnd = "4m";

  // Lower the starting volume for backgroundSynth – even quieter.
  backgroundSynth.volume.value = -32;

  // --- End new background music setup ---
  
  // --- Begin chillhop lofi percussion setup ---
  const lofiKick = new TONE.MembraneSynth({
    volume: -8,
    envelope: {
      attack: 0.001,
      decay: 0.3,
      sustain: 0,
      release: 0.4,
    },
  });
  lofiKick.connect(globalLimiter);

  // Schedule a kick drum pattern: trigger on beats 1 and 3 (every half note) with slight timing variation.
  transport.scheduleRepeat((time) => {
    // Apply a small random delay for a laid-back, humanized feel.
    const randomDelay = (Math.random() - 0.5) * 0.05; // ±25ms
    lofiKick.triggerAttackRelease("C2", "8n", time + randomDelay, 1);
  }, "2n");
  // --- End chillhop lofi percussion setup ---
  
  // --- Begin explosion sound setup ---
  const explosionSynth = new TONE.MembraneSynth({
    volume: -6, // louder output
    envelope: {
      attack: 0.001,
      decay: 0.08,
      sustain: 0,
      release: 0.1,
    },
  });
  explosionSynth.connect(globalLimiter);
  // --- End explosion sound setup ---

  // Pre-allocate a pool of synths for immediate use
  const synthPool = {
    Synth: Array(10)
      .fill(0)
      .map(() => new TONE.Synth(synthConfigs.Synth)),
    MetalSynth: Array(30)
      .fill(0)
      .map(() => new TONE.MembraneSynth(synthConfigs.MetalSynth)),
    FMSynth: Array(5)
      .fill(0)
      .map(() => new TONE.FMSynth(synthConfigs.FMSynth)),
    AMSynth: Array(5)
      .fill(0)
      .map(() => new TONE.AMSynth(synthConfigs.AMSynth)),
  };

  // Connect all synths to the limiter but keep them silent until needed
  Object.values(synthPool)
    .flat()
    .forEach((synth) => {
      synth.connect(globalLimiter);
      synth.volume.value = -Infinity; // Silent until used
    });

  // Pre-allocate audio processing nodes for reuse
  const filterPool = Array(30)
    .fill(0)
    .map(() => new TONE.Filter(400, "lowpass"));
  const pannerPool = Array(30)
    .fill(0)
    .map(
      () =>
        new TONE.Panner3D({
          panningModel: "HRTF",
          distanceModel: "inverse",
          refDistance: 1,
          maxDistance: 50,
          rolloffFactor: 0.3,
          coneInnerAngle: 360,
          coneOuterAngle: 0,
          coneOuterGain: 0,
        }),
    );
  const volumePool = Array(30)
    .fill(0)
    .map(() => new TONE.Volume(-12));

  // Track which nodes are in use
  const usedNodes = {
    filters: Array(30).fill(false),
    panners: Array(30).fill(false),
    volumes: Array(30).fill(false),
    synths: {
      Synth: Array(10).fill(false),
      MetalSynth: Array(30).fill(false),
      FMSynth: Array(5).fill(false),
      AMSynth: Array(5).fill(false),
    },
  };

  // Helper function to create the audio chain for a given synth type.
  function buildSynthChain(chosenType: string): {
    synth:
      | TONE.Synth
      | TONE.MetalSynth
      | TONE.PluckSynth
      | TONE.FMSynth
      | TONE.AMSynth;
    bassFilter: TONE.Filter;
    spatialVolume: TONE.Volume;
    panner3D: TONE.Panner3D;
  } {
    // Get available synth from pool
    let boxSynth: TONE.Synth | TONE.MetalSynth | TONE.FMSynth | TONE.AMSynth | TONE.PluckSynth | undefined;
    let synthIndex = -1;

    if (chosenType === "Synth") {
      synthIndex = usedNodes.synths.Synth.findIndex((used) => !used);
      if (synthIndex >= 0) {
        usedNodes.synths.Synth[synthIndex] = true;
        boxSynth = synthPool.Synth[synthIndex];
      } else {
        console.warn("No available Synth in pool; instantiating a new one.");
        boxSynth = new TONE.Synth(synthConfigs.Synth);
      }
    } else if (chosenType === "MetalSynth") {
      synthIndex = usedNodes.synths.MetalSynth.findIndex((used) => !used);
      if (synthIndex >= 0) {
        usedNodes.synths.MetalSynth[synthIndex] = true;
        boxSynth = synthPool.MetalSynth[synthIndex];
        (boxSynth as any).poolIndex = synthIndex;
      } else {
        console.warn(
          "No available MetalSynth in pool; instantiating a new one.",
        );
        boxSynth = new TONE.MembraneSynth(synthConfigs.MetalSynth);
        (boxSynth as any).poolIndex = -1;
      }
    } else if (chosenType === "FMSynth") {
      synthIndex = usedNodes.synths.FMSynth.findIndex((used) => !used);
      if (synthIndex >= 0) {
        usedNodes.synths.FMSynth[synthIndex] = true;
        boxSynth = synthPool.FMSynth[synthIndex];
      } else {
        console.warn("No available FMSynth in pool; instantiating a new one.");
        boxSynth = new TONE.FMSynth(synthConfigs.FMSynth);
      }
    } else if (chosenType === "AMSynth") {
      synthIndex = usedNodes.synths.AMSynth.findIndex((used) => !used);
      if (synthIndex >= 0) {
        usedNodes.synths.AMSynth[synthIndex] = true;
        boxSynth = synthPool.AMSynth[synthIndex];
      } else {
        console.warn("No available AMSynth in pool; instantiating a new one.");
        boxSynth = new TONE.AMSynth(synthConfigs.AMSynth);
      }
    } else if (chosenType === "PluckSynth") {
      console.warn("PluckSynth not in pool; instantiating a new one.");
      boxSynth = new TONE.PluckSynth(synthConfigs.PluckSynth);
    }

    // Get available filter, panner, and volume from pools
    const filterIndex = usedNodes.filters.findIndex((used) => !used);
    const pannerIndex = usedNodes.panners.findIndex((used) => !used);
    const volumeIndex = usedNodes.volumes.findIndex((used) => !used);

    const bassFilter =
      filterIndex >= 0
        ? filterPool[filterIndex]
        : new TONE.Filter(400, "lowpass");
    const panner3D =
      pannerIndex >= 0
        ? pannerPool[pannerIndex]
        : new TONE.Panner3D({
            panningModel: "HRTF",
            distanceModel: "inverse",
            refDistance: 1,
            maxDistance: 50,
            rolloffFactor: 0.3,
            coneInnerAngle: 360,
            coneOuterAngle: 0,
            coneOuterGain: 0,
          });
    const spatialVolume =
      volumeIndex >= 0 ? volumePool[volumeIndex] : new TONE.Volume(-12);

    if (filterIndex >= 0) usedNodes.filters[filterIndex] = true;
    if (pannerIndex >= 0) usedNodes.panners[pannerIndex] = true;
    if (volumeIndex >= 0) usedNodes.volumes[volumeIndex] = true;

    // Reset volume to default
    spatialVolume.volume.value = -12;

    // Connect the chain
    boxSynth!.disconnect();
    boxSynth!.chain(bassFilter, panner3D, spatialVolume, globalGameVolume);

    // Reset volume from -Infinity (dormant state) to 0 for audible output
    boxSynth!.volume.value = 0;

    return { synth: boxSynth!, bassFilter, spatialVolume, panner3D };
  }

  // Helper function to compute volume based on distance and impact velocity
  function computeCollisionVolume(
    mesh: THREE.Mesh,
    camera: THREE.Camera,
    impactVelocity: number,
  ): number {
    const diff = new THREE.Vector3().subVectors(mesh.position, camera.position);
    const distance = diff.length();
    const maxDistance = 50;
    const volumeFactor = Math.max(0, 1 - distance / maxDistance);
    let computedVolume = -12 - (1 - volumeFactor) * 20;
    return Math.min(computedVolume + impactVelocity * 2, 0);
  }

  // Track audio latency for debugging
  let lastCollisionTime = 0;
  let lastAudioStartTime = 0;
  let measuredLatency = 0;

  // Helper for collision handling; ensures the block flashes and triggers its sound.
  function attachCollisionHandler(boxBody: CANNON.Body, mesh: THREE.Mesh) {
    boxBody.addEventListener("collide", (e: any) => {
      // Only proceed if the block collided with the player body
      if (e.body !== playerBody) return;

      const impactVelocity =
        e.contact && e.contact.getImpactVelocityAlongNormal
          ? e.contact.getImpactVelocityAlongNormal()
          : 0;
      if (impactVelocity < 2) return;

      const originalColor = mesh.userData.originalColor;
      ((mesh.material as THREE.MeshStandardMaterial).color).set(0xffffff);
      setTimeout(() => {
        ((mesh.material as THREE.MeshStandardMaterial).color).setHex(originalColor);
      }, 150);

      (boxBody as any).assignedVolume.volume.value = computeCollisionVolume(
        mesh,
        camera,
        impactVelocity,
      );

      const now = performance.now();
      if (now - (boxBody as any).lastToneTime > 150) {
        (boxBody as any).lastToneTime = now;
        lastCollisionTime = now;
        const note = (boxBody as any).assignedTone;

        // Immediate triggering with no scheduling delay
        (boxBody as any).assignedSynth.triggerAttackRelease(
          note,
          "8n",
          undefined,
          1,
        );

        // Revised scoring: use baseScore and combo multiplier.
        // Revised scoring: compute timing error and bonus multiplier
        const timingErrorMs = computeTimingError();
        let bonusMultiplier = 1;
        if (timingErrorMs < 30) {
          bonusMultiplier = 1.5; // perfect timing: extra 50% bonus
        } else if (timingErrorMs < 60) {
          bonusMultiplier = 1.2; // nearly perfect timing: 20% bonus
        }

        const lydianNotes = ["C", "D", "E", "F#", "G", "A", "B"];
        const thisNote: string = (boxBody as any).assignedTone;
        const noteMatch = thisNote.match(/^[A-G]#?/);
        if (noteMatch) {
          const noteLetter = noteMatch[0];
          if (lydianNotes.includes(noteLetter)) {
            // In-key: add score considering combo and timing bonus.
            const pointsEarned = baseScore * comboMultiplier * bonusMultiplier;
            score += pointsEarned;
            comboMultiplier++;
            if (comboMultiplier > maxCombo) maxCombo = comboMultiplier;
            
            // For very perfect timing (error < 30ms), show floating "Perfect!"
            if (timingErrorMs < 30) {
              spawnFloatingText("Perfect!", mesh.position);
              triggerCameraShake();
            }
            
            spawnParticlesAt(mesh.position, mesh.userData.originalColor);
          } else {
            // Off-key: penalize and reset combo multiplier
            score = score - baseScore < 0 ? 0 : score - baseScore;
            comboMultiplier = 1;
          }
          scoreElem.innerText = `Score: ${score}`;
          updateComboDisplay();
        }

        // Free the synth from the pool after the note duration
        const poolIndex = (boxBody as any).assignedSynth.poolIndex;
        if (poolIndex !== undefined && poolIndex >= 0) {
          setTimeout(() => {
            usedNodes.synths.MetalSynth[poolIndex] = false;
          }, TONE.Time("8n").toMilliseconds());
        }

        // Measure actual audio start time for latency calculation
        lastAudioStartTime = performance.now();
        measuredLatency = lastAudioStartTime - lastCollisionTime;

        // latencyElem removed - no longer displaying JS latency
        
        updateRhythmUI(note); // Only updated if the collision involves the player
      }
    });
  }

  // Helper to create a block with its mesh, physics body, audio chain and collision handling.
  function createBlock(
    position: THREE.Vector3,
    config: BlockConfig,
  ): { mesh: THREE.Mesh; body: CANNON.Body } {
    const boxSize = config.size; // Use the discrete size from config
    const assignedTone = config.tone; // Use the corresponding tone
    // Create box geometry using the provided size
    const boxGeo = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    // Use the synth type from config
    const chosenType = config.synth;
    // Use the color from config for the material, and make it glow as a light emitter
    const boxMat = new THREE.MeshStandardMaterial({
      color: config.color,
      emissive: config.color,
      emissiveIntensity: 0.4,
    });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    boxMesh.userData.originalColor = config.color;
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    const edges = new THREE.EdgesGeometry(boxGeo);
    const outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 10 }),
    );
    boxMesh.add(outline);
    boxMesh.userData.outline = outline;
    boxMesh.position.copy(position);

    const halfExtents = new CANNON.Vec3(boxSize / 2, boxSize / 2, boxSize / 2);
    const boxShape = new CANNON.Box(halfExtents);
    const boxBody = new CANNON.Body({ mass: 1 });
    boxBody.addShape(boxShape);
    boxBody.position.copy(new CANNON.Vec3(position.x, position.y, position.z));

    (boxBody as any).mesh = boxMesh;
    boxMesh.userData.boxBody = boxBody;
    (boxBody as any).assignedTone = assignedTone;

    // Use the provided synth type when building the audio chain.
    const { synth, panner3D, spatialVolume } = buildSynthChain(chosenType);
    (boxBody as any).assignedSynth = synth;
    (boxBody as any).assignedPanner3D = panner3D;
    (boxBody as any).assignedVolume = spatialVolume;
    (boxBody as any).lastToneTime = 0;

    attachCollisionHandler(boxBody, boxMesh);

    return { mesh: boxMesh, body: boxBody };
  }

  // Create a global array to store box meshes
  const boxMeshArray: THREE.Mesh[] = [];

  // Create and style a block counter element
  const blockCounterElem = document.createElement("div");
  blockCounterElem.id = "blockCounter";
  blockCounterElem.style.position = "absolute";
  blockCounterElem.style.top = "10px";
  blockCounterElem.style.right = "10px"; // Changed from left to right
  blockCounterElem.style.color = "#A67C52";
  blockCounterElem.style.fontSize = "18px";
  blockCounterElem.style.fontFamily = "Roboto, sans-serif"; // New font-family
  document.body.appendChild(blockCounterElem);

  // Create BPM display element below the block counter
  const bpmElem = document.createElement("div");
  bpmElem.id = "bpmDisplay";
  bpmElem.style.position = "absolute";
  bpmElem.style.top = "40px";
  bpmElem.style.right = "10px";
  bpmElem.style.color = "#A67C52";
  bpmElem.style.fontSize = "18px";
  bpmElem.style.fontFamily = "Roboto, sans-serif";
  document.body.appendChild(bpmElem);

  // Create new UI element for timing accuracy (difference to nearest measure in ms)
  const timingAccuracyElem = document.createElement("div");
  timingAccuracyElem.id = "timingAccuracy";
  timingAccuracyElem.style.position = "absolute";
  timingAccuracyElem.style.top = "70px";
  timingAccuracyElem.style.right = "10px";
  timingAccuracyElem.style.color = "#A67C52";
  timingAccuracyElem.style.fontSize = "18px";
  timingAccuracyElem.style.fontFamily = "Roboto, sans-serif";
  document.body.appendChild(timingAccuracyElem);

  // Create new UI element for last triggered note
  const lastNoteElem = document.createElement("div");
  lastNoteElem.id = "lastNote";
  lastNoteElem.style.position = "absolute";
  lastNoteElem.style.top = "100px";
  lastNoteElem.style.right = "10px";
  lastNoteElem.style.color = "#A67C52";
  lastNoteElem.style.fontSize = "18px";
  lastNoteElem.style.fontFamily = "Roboto, sans-serif";
  document.body.appendChild(lastNoteElem);

  // Function to update the counter text
  function updateBlockCounter() {
    blockCounterElem.innerText = `Blocks: ${boxMeshArray.length}`;
  }
  updateBlockCounter();

  // Create a round timer element at the top center of the screen
  const roundTimerElem = document.createElement("div");
  roundTimerElem.id = "roundTimer";
  roundTimerElem.style.position = "absolute";
  roundTimerElem.style.top = "10px";
  roundTimerElem.style.left = "50%";
  roundTimerElem.style.transform = "translateX(-50%)";
  roundTimerElem.style.color = "#A67C52";
  roundTimerElem.style.fontSize = "24px";
  roundTimerElem.style.fontFamily = "Roboto, sans-serif";
  document.body.appendChild(roundTimerElem);

  // Create a new score display element in the bottom center.
  let score = 0; // Global score variable
  const scoreElem = document.createElement("div");
  scoreElem.id = "scoreDisplay";
  scoreElem.style.position = "absolute";
  scoreElem.style.bottom = "10px";
  scoreElem.style.left = "50%";
  scoreElem.style.transform = "translateX(-50%)";
  scoreElem.style.color = "#A67C52";
  scoreElem.style.fontSize = "18px";
  scoreElem.style.fontFamily = "Roboto, sans-serif";
  scoreElem.innerText = "Score: 0";
  document.body.appendChild(scoreElem);

  // Latency display removed
  
  // New combo multiplier display
  const comboElem = document.createElement("div");
  comboElem.id = "comboDisplay";
  comboElem.style.position = "absolute";
  comboElem.style.top = "160px";
  comboElem.style.left = "50%";
  comboElem.style.transform = "translateX(-50%)";
  comboElem.style.color = "#C27C83";
  comboElem.style.fontSize = "24px";
  comboElem.style.fontFamily = "Roboto, sans-serif";
  comboElem.innerText = "Combo: 1";
  document.body.appendChild(comboElem);

  
  // Global scoring variables
  let comboMultiplier = 1; // increases on each in-key hit
  let maxCombo = 0;        // track the highest combo reached
  const baseScore = 10;    // base points earned per hit (will be multiplied by the combo)
  
  // Music controls removed - background music now plays automatically with no UI controls

  // Blocks will be spawned after user interaction

  // Block spawning will be scheduled when the round starts

  function spawnBlock() {
    const pos = new THREE.Vector3(
      (Math.random() - 0.5) * 40,
      50,
      (Math.random() - 0.5) * 40,
    );
    // Pull the next block configuration from blockSequence
    const config = blockSequence[blockSeqIndex];
    blockSeqIndex = (blockSeqIndex + 1) % blockSequence.length;
    const { mesh, body } = createBlock(pos, config);
    scene.add(mesh);
    world.addBody(body);
    boxMeshArray.push(mesh);
    updateBlockCounter();
  }

  function createTickerBlock() {
    const size = 1; // ticker block dimensions
    const tickerColor = 0x808080; // gray
    const blockGeo = new THREE.BoxGeometry(size, size, size);
    const blockMat = new THREE.MeshStandardMaterial({
      color: tickerColor,
      emissive: tickerColor,
      emissiveIntensity: 0.4,
    });
    const blockMesh = new THREE.Mesh(blockGeo, blockMat);
    blockMesh.userData.originalColor = tickerColor;
    blockMesh.castShadow = true;
    blockMesh.receiveShadow = true;
    // Position the block at the center of the arena (x:0, z:0) and half its height above ground
    blockMesh.position.set(0, size / 2, 0);
    scene.add(blockMesh);

    // Create a static physics body (mass 0 so it remains immovable)
    const halfExtents = new CANNON.Vec3(size / 2, size / 2, size / 2);
    const boxShape = new CANNON.Box(halfExtents);
    const boxBody = new CANNON.Body({ mass: 0 });
    boxBody.addShape(boxShape);
    boxBody.position.set(0, size / 2, 0);
    world.addBody(boxBody);

    // Build an audio chain for the ticker block using a percussive click sound.
    // We use a MembraneSynth with a very short envelope for a click-like effect.
    const tickerSynth = new TONE.MembraneSynth({
      envelope: {
        attack: 0.001,
        decay: 0.1,
        sustain: 0,
        release: 0.1,
      },
    });
    const tickerFilter = new TONE.Filter(800, "lowpass");
    const tickerVolume = new TONE.Volume(0);
    const tickerPanner = new TONE.Panner3D({
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: 1,
      maxDistance: 50,
      rolloffFactor: 0.3, // reduced falloff intensity for the ticker block
      coneInnerAngle: 360,
      coneOuterAngle: 0,
      coneOuterGain: 0,
    });
    tickerSynth.chain(tickerFilter, tickerPanner, tickerVolume, globalLimiter);
    // Save the ticker synth and panner with the physics body if needed later
    (boxBody as any).assignedSynth = tickerSynth;
    (boxBody as any).assignedPanner3D = tickerPanner;

    // Schedule ticker block flashing and click sound every 2 measures (2 bars in 4/4 time)
    transport.scheduleRepeat((time) => {
      blockMesh.material.color.set(0xffffff);
      setTimeout(() => {
        blockMesh.material.color.setHex(tickerColor);
      }, 100);
      tickerSynth.triggerAttackRelease("C4", "8n", time);
      console.log(
        "Ticker block triggered at position:",
        blockMesh.position,
        "sound: C4 click",
      );
    }, "2m");

    return { mesh: blockMesh, body: boxBody };
  }

  // Add ticker block at the center of the arena for debugging
  const tickerBlock = createTickerBlock();

  // Pre-allocate metronome synth with optimized settings for low latency
  const metronomeSynth = new TONE.MembraneSynth({
    volume: 0,
    envelope: {
      attack: 0.001,
      decay: 0.001,
      sustain: 0.001,
      release: 0.001,
    },
  });

  // Connect the metronome to the global limiter
  metronomeSynth.chain(globalLimiter);

  transport.scheduleRepeat((time) => {
    // Trigger a higher-pitched click (C4) for improved audibility
    metronomeSynth.triggerAttackRelease("C4", "16n", time);
  }, "4n");
  // --- End of round timer and tempo track setup ---

  // Movement variables
  const keys: Record<string, boolean> = {
    w: false,
    a: false,
    s: false,
    d: false,
  };

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key in keys) {
      keys[key] = true;
    }
    // Check for spacebar jump (using a downward raycast to allow jumps off any surface)
    if (event.code === "Space") {
      const playerRadius = 1; // using same value as the sphere shape for the player
      const downRaycaster = new THREE.Raycaster();
      const origin = playerBody.position.clone();
      // Set ray downward (0, -1, 0)
      downRaycaster.set(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(0, -1, 0));

      // Include the ground mesh and all block meshes in the raycast
      const intersectObjects = [groundMesh, ...boxMeshArray];
      const intersects = downRaycaster.intersectObjects(intersectObjects);

      // Use a threshold of (playerRadius + small epsilon) for grounding
      if (
        intersects.length > 0 &&
        intersects[0].distance <= playerRadius + 0.2
      ) {
        // Trigger the jump with increased power (sound removed)
        playerBody.velocity.y = 9; // 50% of 18 for a weaker jump

        // If jumping off a block (non-ground), apply a stronger reaction impulse to it
        if (intersects[0].object.userData.boxBody) {
          const blockBody = intersects[0].object.userData.boxBody;
          // Apply a downward impulse to simulate the push-off effect (adjust impulse magnitude as needed)
          blockBody.applyImpulse(new CANNON.Vec3(0, -7, 0), blockBody.position);
        }
      }
    }
  });

  window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (key in keys) {
      keys[key] = false;
    }
  });

  // Create crosshair element
  const crosshairElem = document.createElement("div");
  crosshairElem.id = "crosshair";
  crosshairElem.style.position = "absolute";
  crosshairElem.style.top = "50%";
  crosshairElem.style.left = "50%";
  crosshairElem.style.transform = "translate(-50%, -50%)";
  crosshairElem.style.width = "20px";
  crosshairElem.style.height = "20px";
  crosshairElem.style.border = "2px solid white";
  crosshairElem.style.borderRadius = "50%";
  document.body.appendChild(crosshairElem);

  // Initialize raycaster for block click detection
  const raycaster = new THREE.Raycaster();

  // Add Stats.js for performance monitoring
  const stats = new Stats();
  document.body.appendChild(stats.dom);

  // Add event listener for click tests
  renderer.domElement.addEventListener("mouseup", (event) => {
    // Only proceed if pointer is locked
    if (!controls.isLocked) return;

    // Cast a ray from the center of the screen.
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    // Intersect with all objects in the scene (use recursive flag to catch children like outlines)
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      // Find the intersected block mesh.
      let targetMesh = intersects[0].object;
      // If the clicked object is a child (like an outline), check its parent.
      if (!targetMesh.userData.boxBody && targetMesh.parent) {
        targetMesh = targetMesh.parent;
      }
      if (targetMesh.userData.boxBody) {
        // Log block info for debugging.
        console.log("Block clicked:", targetMesh);
        console.log("Position:", targetMesh.position);
        const blockBody = targetMesh.userData.boxBody as CANNON.Body;
        console.log("Assigned tone:", (blockBody as any).assignedTone);
        console.log("Assigned synth:", (blockBody as any).assignedSynth);

        // Flash the block white (store original color first).
        const originalColor = targetMesh.userData.originalColor;
        // Store the original emissive intensity.
        const originalEmissiveIntensity = ((targetMesh as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity;
        // Flash: Override color and emissive properties to white.
        ((targetMesh as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(0xffffff);
        ((targetMesh as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.set(0xffffff);
        ((targetMesh as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
        setTimeout(() => {
          // Restore the original color and glow settings.
          ((targetMesh as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(originalColor);
          ((targetMesh as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.setHex(originalColor);
          ((targetMesh as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
        }, 150);

        // Play the block sound with a "big impact" (simulate high impact velocity).
        // Use a high volume version by overriding the computed volume if desired.
        const note = (blockBody as any).assignedTone;
        lastCollisionTime = performance.now();

        // Compute timing error before using it
        const timingErrorMs = computeTimingError();
        
        // Immediate triggering with no scheduling delay
        if (timingErrorMs < 30) {
          // For perfect hit, trigger note at slightly higher volume
          (blockBody as any).assignedSynth.triggerAttackRelease(
            note,
            "8n",
            undefined,
            1.2
          );
        } else {
          (blockBody as any).assignedSynth.triggerAttackRelease(
            note,
            "8n",
            undefined,
            1
          );
        }

        // Update score and modify block based on whether its tone is in the current key.
        {
          // Revised scoring: compute timing error and bonus multiplier
          const timingErrorMs = computeTimingError();
          let bonusMultiplier = 1;
          if (timingErrorMs < 30) {
            bonusMultiplier = 1.5; // perfect timing: extra 50% bonus
          } else if (timingErrorMs < 60) {
            bonusMultiplier = 1.2; // nearly perfect timing: 20% bonus
          }
              
          // Define the allowed note letters for the current key (C Lydian)
          const lydianNotes = ["C", "D", "E", "F#", "G", "A", "B"];
          // Expect the tone to be in a format like "C4" (letter plus octave)
          const thisNote: string = (blockBody as any).assignedTone;
          // Use a regex that captures the note letter and octave.
          const noteMatch = thisNote.match(/^([A-G]#?)(\d)$/);
          if (noteMatch) {
            const noteLetter = noteMatch[1];
            const octave = noteMatch[2];
            // Always show the note popup, regardless of key.
            const blockColorHex = '#' + targetMesh.userData.originalColor.toString(16).padStart(6, '0');
            spawnNotePopup(noteLetter, targetMesh.position, blockColorHex);
            
            // Compute the impulse vector from the player to the block.
            const impulseDir = new CANNON.Vec3(
              targetMesh.position.x - playerBody.position.x,
              targetMesh.position.y - playerBody.position.y,
              targetMesh.position.z - playerBody.position.z,
            );
            impulseDir.normalize();

            if (lydianNotes.includes(noteLetter)) {
              // In-key: Award points and adjust combo.
              const pointsEarned = baseScore * comboMultiplier * bonusMultiplier;
              score += pointsEarned;
              comboMultiplier++;
              if (comboMultiplier > maxCombo) maxCombo = comboMultiplier;
              
              // For very perfect timing, display feedback
              if (timingErrorMs < 30) {
                spawnFloatingText("Perfect!", targetMesh.position);
                triggerCameraShake();
              }
              
              // Only show the multiplier popup if the bonus multiplier is above 1.
              if (bonusMultiplier > 1) {
                spawnMultiplierPopup(bonusMultiplier, targetMesh.position);
              }
              
              // Trigger explosion sound
              explosionSynth.triggerAttackRelease((blockBody as any).assignedTone, "8n", undefined, 1.5);
              
              // Trigger explosion effect at the block's position with triple the particles
              spawnParticlesAt(targetMesh.position, targetMesh.userData.originalColor, 3);
              
              // Remove the block from the scene and physics world
              scene.remove(targetMesh);
              world.removeBody(blockBody);
              // Also remove from the global block mesh array and update counter:
              const index = boxMeshArray.indexOf(targetMesh as THREE.Mesh);
              if (index > -1) {
                boxMeshArray.splice(index, 1);
                updateBlockCounter();
              }
              
              console.log("Block exploded and removed.");
            } else {
              // Off-key: Subtract a point and reset combo.
              score = score - baseScore < 0 ? 0 : score - baseScore;
              comboMultiplier = 1;
                  
              // Apply only a mild push.
              const mildForce = 5; // Small force
              impulseDir.scale(mildForce, impulseDir);
              blockBody.applyImpulse(impulseDir, blockBody.position);

              console.log(
                "Block was off-key. Applied mild push; tone and color unchanged. Combo reset.",
              );
            }
            scoreElem.innerText = `Score: ${score}`;
            updateComboDisplay();
          } else {
            // Fallback if tone format is unexpected.
            console.warn("Block tone has unexpected format:", thisNote);
          }
        }

        // Free the synth from the pool after the note duration
        const poolIndex = (blockBody as any).assignedSynth.poolIndex;
        if (poolIndex !== undefined && poolIndex >= 0) {
          setTimeout(() => {
            usedNodes.synths.MetalSynth[poolIndex] = false;
          }, TONE.Time("8n").toMilliseconds());
        }

        // Measure actual audio start time for latency calculation
        lastAudioStartTime = performance.now();
        measuredLatency = lastAudioStartTime - lastCollisionTime;

        updateRhythmUI(note);
      }
    }
  });

  // Helper function to update Tone.js listener position and orientation
  function updateToneListener(camera: THREE.Camera): void {
    const context = TONE.getContext();
    context.listener.positionX.value = camera.position.x;
    context.listener.positionY.value = camera.position.y;
    context.listener.positionZ.value = camera.position.z;

    const listenerForward = new THREE.Vector3();
    camera.getWorldDirection(listenerForward).normalize();
    const up = camera.up;
    context.listener.forwardX.value = listenerForward.x;
    context.listener.forwardY.value = listenerForward.y;
    context.listener.forwardZ.value = listenerForward.z;
    context.listener.upX.value = up.x;
    context.listener.upY.value = up.y;
    context.listener.upZ.value = up.z;
  }

  // Helper to compute the absolute timing error (in ms) relative to the nearest eighth note boundary.
  function computeTimingError(): number {
    const currentBPM = transport.bpm.value;
    const eighthNoteLength = 60 / currentBPM / 2;
    const currentTime = transport.seconds;
    const mod = currentTime % eighthNoteLength;
    const diff = Math.min(mod, eighthNoteLength - mod);
    return diff * 1000; // return difference in milliseconds
  }
  
  // Helper function to compute timing accuracy and update UI
  function updateRhythmUI(note: string) {
    // Get the current BPM from the cached transport.
    const currentBPM = transport.bpm.value;
    // In 4/4 time, one measure's length = (60 / BPM) * 4.
    // But we want the nearest eighth note boundary – an eighth note lasts (60 / BPM) / 2.
    const eighthNoteLength = 60 / currentBPM / 2; // seconds per 8th note
    // Get current transport time in seconds.
    const currentTransportTime = transport.seconds;
    // Compute remainder of current eighth note period:
    const mod = currentTransportTime % eighthNoteLength;
    // The timing accuracy is the smallest difference (either mod or the remainder to the next boundary).
    const diff = Math.min(mod, eighthNoteLength - mod);
    const diffMs = Math.round(diff * 1000);

    // Calculate percentage accuracy (100% = perfect timing)
    const maxDeviation = (eighthNoteLength / 2) * 1000; // Half an eighth note in ms is the worst case
    const accuracyPercent = 100 - (diffMs / maxDeviation) * 100;
    const accuracyText =
      accuracyPercent > 90
        ? "Excellent!"
        : accuracyPercent > 75
          ? "Good"
          : accuracyPercent > 50
            ? "OK"
            : "Off-beat";

    timingAccuracyElem.innerText = `Timing: ${diffMs} ms (${accuracyText})`;
    lastNoteElem.innerText = `Last Note: ${note}`;
  }
  
  function updateComboDisplay() {
    comboElem.innerText = `Combo: ${comboMultiplier}`;
    // Immediately show the combo text
    comboElem.style.opacity = "1";
    // Animate scale-up (and specify a transition that covers both transform and opacity)
    comboElem.style.transition = "transform 0.2s ease, opacity 1s ease";
    comboElem.style.transform = "scale(1.5)";
    
    // Clear any existing fade-out timeout so that rapid updates reset the timer
    clearTimeout(comboFadeTimeout);
    comboFadeTimeout = setTimeout(() => {
      comboElem.style.opacity = "0";
    }, 3000);
    
    // Reset scale after the brief enlargement
    setTimeout(() => { 
      comboElem.style.transform = "scale(1)"; 
    }, 200);
  }
  
  function triggerCameraShake() {
    const originalPos = camera.position.clone();
    let shakeTime = 0;
    const shakeDuration = 150; // in ms
    function shake() {
      if (shakeTime < shakeDuration) {
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1
        );
        camera.position.add(offset);
        shakeTime += 16;
        requestAnimationFrame(shake);
      } else {
        camera.position.copy(originalPos);
      }
    }
    shake();
  }

  function spawnFloatingText(text: string, position: THREE.Vector3) {
    const div = document.createElement("div");
    div.innerText = text;
    div.style.position = "absolute";
    div.style.color = "lime";  // use an accent color for perfect timing
    div.style.fontSize = "20px";
    div.style.fontWeight = "bold";
    div.style.pointerEvents = "none";
    div.style.opacity = "1";
    document.body.appendChild(div);

    // Convert world position to screen coordinates
    const vector = position.clone().project(camera);
    const x = ((vector.x + 1) / 2) * window.innerWidth;
    const y = ((-vector.y + 1) / 2) * window.innerHeight;
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;

    // Animate: move upward and fade out over 1.0 second.
    const duration = 1000;
    const start = performance.now();
    function animateText(now: number) {
      const elapsed = now - start;
      div.style.transform = `translateY(${ - (elapsed / duration) * 30 }px)`;
      div.style.opacity = `${1 - elapsed / duration}`;
      if (elapsed < duration) {
        requestAnimationFrame(animateText);
      } else {
        div.remove();
      }
    }
    requestAnimationFrame(animateText);
  }
  
  function spawnNotePopup(note: string, position: THREE.Vector3, noteColor?: string) {
    const div = document.createElement("div");
    div.innerText = note;
    div.style.position = "absolute";
    // Use the provided noteColor (converted from block's original color) or default to yellow.
    div.style.color = noteColor || "#ffcc00";
    div.style.fontSize = "22px";
    div.style.fontWeight = "bold";
    div.style.pointerEvents = "none";
    div.style.opacity = "1";
    document.body.appendChild(div);

    // Convert the world position to screen coordinates.
    const vector = position.clone().project(camera);
    const x = ((vector.x + 1) / 2) * window.innerWidth;
    const y = ((-vector.y + 1) / 2) * window.innerHeight;
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;

    // Force the note popup to fly to the right:
    const angle = Math.random() * 30; // angle in degrees moving rightward
    const xOffset = 50 + Math.random() * 50; // always positive (rightward)
    const yOffset = -50 - Math.random() * 50;  // upward motion

    const duration = 1500;
    const start = performance.now();
    function animate(now: number) {
      const elapsed = now - start;
      const progress = elapsed / duration;
      div.style.transform = `translate(${xOffset * progress}px, ${yOffset * progress}px) rotate(${angle * progress}deg)`;
      div.style.opacity = `${1 - progress}`;
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        div.remove();
      }
    }
    requestAnimationFrame(animate);
  }

  function spawnMultiplierPopup(multiplier: number, /* position parameter unused */ _pos?: THREE.Vector3) {
    const div = document.createElement("div");
    div.innerText = `×${multiplier.toFixed(1)}`;
    div.style.position = "absolute";
    div.style.color = "#00ff00";
    div.style.fontSize = "24px";
    div.style.fontWeight = "bold";
    div.style.pointerEvents = "none";
    div.style.opacity = "1";
    document.body.appendChild(div);

    // Position the multiplier popup fixed above the score display.
    div.style.left = "50%";
    div.style.bottom = "60px";  // Adjust this value as needed for proper spacing
    div.style.transform = "translateX(-50%)";

    // Generate a slight random offset and rotation for a subtle animation effect.
    const angle = (Math.random() - 0.5) * 20; // small rotation variation
    const xOffset = (Math.random() - 0.5) * 20; 
    const yOffset = -10 - Math.random() * 10;

    const duration = 1500;
    const start = performance.now();
    function animate(now: number) {
      const elapsed = now - start;
      const progress = elapsed / duration;
      // Combine the fixed centering with the animated offset and rotation.
      div.style.transform = `translate(${xOffset * progress}px, ${yOffset * progress}px) rotate(${angle * progress}deg) translateX(-50%)`;
      div.style.opacity = `${1 - progress}`;
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        div.remove();
      }
    }
    requestAnimationFrame(animate);
  }
  
  function spawnParticlesAt(position: THREE.Vector3, color: number, countMultiplier?: number) {
    // Use 8 as the base particle count; multiply if countMultiplier is provided.
    const particleCount = countMultiplier ? 8 * countMultiplier : 8;
    
    // Create a small particle geometry and material to simulate a burst.
    const particleGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({ 
      color,
      transparent: true,
      opacity: 1
    });
    const particle = new THREE.Mesh(particleGeo, particleMat);
    particle.position.copy(position);
    scene.add(particle);
    
    // Use 'particleCount' in the loop:
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const speed = 0.05 + Math.random() * 0.05;
      const clone = particle.clone();
      clone.position.copy(position);
      scene.add(clone);
      
      // Simple animation without TWEEN
      const direction = new THREE.Vector3(
        Math.cos(angle), 
        0.5, // slight upward movement
        Math.sin(angle)
      );
      
      // Store animation data on the particle
      (clone as any).velocity = direction.multiplyScalar(speed);
      (clone as any).life = 1.0;
      (clone as any).update = function(delta: number) {
        this.position.add(this.velocity);
        this.life -= delta * 2;
        (this.material as THREE.MeshBasicMaterial).opacity = this.life;
        // Scale particle based on life for a trail-like effect
        this.scale.set(this.life * 0.8, this.life * 0.8, this.life * 0.8);
        if (this.life <= 0) {
          scene.remove(this);
        }
      };
      
      // Add to a global array for animation
      particlesToAnimate.push(clone);
    }
    
    // Remove the original template particle
    scene.remove(particle);
  }
  
  // Array to track particles for animation
  const particlesToAnimate: THREE.Mesh[] = [];

  // Track time for physics updates
  let lastTime = performance.now();

  // Animation loop
  function animate() {
    stats.update();

    // Step the physics world with variable time step
    const currentTime = performance.now();
    const dt = (currentTime - lastTime) / 1000; // delta in seconds
    lastTime = currentTime;
    // Advance the physics with a fixed time step (1/60) using accumulated dt and allow for up to 3 substeps.
    world.step(1 / 60, dt, 3);
    requestAnimationFrame(animate);

    // Update camera position to match the player's physics body
    if (controls.isLocked) {
      camera.position.copy(playerBody.position as unknown as THREE.Vector3);
    }

    // Basic WASD movement: calculate front and side speeds
    const speed = 48; // 20% faster than 40
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    // Compute horizontal forward by zeroing the Y component
    const horizForward = camDir.clone().setY(0).normalize();
    // Compute right vector: cross(up, forward) yields the right direction
    const right = new THREE.Vector3()
      .crossVectors(camera.up, horizForward)
      .normalize();

    let moveX = 0;
    let moveZ = 0;
    if (keys.w) moveZ += 1; // W now moves forward
    if (keys.s) moveZ -= 1; // S now moves backward
    if (keys.a) moveX += 1; // A now strafes left (relative to camera)
    if (keys.d) moveX -= 1; // D now strafes right

    const velocity = new CANNON.Vec3();
    if (moveZ !== 0 || moveX !== 0) {
      const moveDir = new THREE.Vector3();
      moveDir
        .add(horizForward.multiplyScalar(moveZ))
        .add(right.multiplyScalar(moveX));
      moveDir.normalize().multiplyScalar(speed);
      velocity.x = moveDir.x;
      velocity.z = moveDir.z;
    }
    // Preserve Y-velocity (gravity/jump)
    playerBody.velocity.x = velocity.x;
    playerBody.velocity.z = velocity.z;

    // Update boxes' Three.js meshes from their Cannon bodies
    world.bodies.forEach((body) => {
      if ((body as any).mesh) {
        const mesh = (body as any).mesh as THREE.Mesh;
        mesh.position.copy(body.position as unknown as THREE.Vector3);
        mesh.quaternion.copy(body.quaternion as unknown as THREE.Quaternion);

        // Update the 3D panner position to match the body position
        if ((body as any).assignedPanner3D) {
          const panner = (body as any).assignedPanner3D as TONE.Panner3D;
          panner.positionX.value = body.position.x;
          panner.positionY.value = body.position.y;
          panner.positionZ.value = body.position.z;
        }
      }
    });

    // Update Tone.js listener position and orientation to match the camera
    updateToneListener(camera);

    // Update BPM display
    bpmElem.innerText = `BPM: ${transport.bpm.value.toFixed(0)}`;
    
    // Calculate beat factor for ambient pulsing
    const currentBPM = transport.bpm.value;
    const eighthNoteLength = 60 / currentBPM / 2;
    const currentTransportTime = transport.seconds;
    const mod = currentTransportTime % eighthNoteLength;
    const beatFactor = mod / eighthNoteLength;
    
    // Ambient pulsing: vary sun intensity slightly with beat (using a sine wave)
    const pulseIntensity = 2.5 + 0.3 * Math.sin(beatFactor * Math.PI * 2);
    sun.intensity = pulseIntensity;
    
    // Update particles
    for (let i = particlesToAnimate.length - 1; i >= 0; i--) {
      const particle = particlesToAnimate[i];
      if (particle.parent === null) {
        // Particle was already removed
        particlesToAnimate.splice(i, 1);
        continue;
      }
      
      (particle as any).update(dt);
      if ((particle as any).life <= 0) {
        particlesToAnimate.splice(i, 1);
      }
    }

    // Animate sun position and color over the round duration
    const elapsedRound = (performance.now() - roundStartTime) / 1000;
    const t = Math.min(elapsedRound / roundDuration, 1); // normalized time (0 to 1)

    if (t <= 0.5) {
      // First half of the round: from start to mid (noon)
      const factor = t / 0.5;
      sun.position.lerpVectors(startPos, midPos, factor);
      sun.color.copy(startColor.clone().lerp(midColor, factor));
    } else {
      // Second half of the round: from mid to end (sunset)
      const factor = (t - 0.5) / 0.5;
      sun.position.lerpVectors(midPos, endPos, factor);
      sun.color.copy(midColor.clone().lerp(endColor, factor));
    }

    // Update the visible sun sphere position and color to match the directional light
    sunSphere.position.copy(sun.position);
    sunSphere.material.color.copy(sun.color);

    // Gradual day-night cycle: Extend sunrise/sunset to 30 seconds at boundaries.
    if (elapsedRound < 30) {
      // Sunrise: interpolate from black to dawnSkyColor.
      const factor = elapsedRound / 30;
      scene.background = new THREE.Color(0x000000).lerp(dawnSkyColor, factor);
      sun.intensity = factor * 2.5;
      sunSphere.visible = factor > 0.2;
    } else if (elapsedRound > roundDuration - 30) {
      // Sunset: interpolate from dawnSkyColor to black.
      const factor = (roundDuration - elapsedRound) / 30;
      scene.background = dawnSkyColor
        .clone()
        .lerp(new THREE.Color(0x000000), 1 - factor);
      sun.intensity = factor * 2.5;
      sunSphere.visible = factor > 0.2;
    } else {
      // Daytime: keep a steady noon sky and full sun intensity.
      scene.background = noonSkyColor;
      sun.intensity = 2.5;
      sunSphere.visible = true;
    }

    // Ramp metronome volume: quiet/peaceful at round start, louder/more aggressive at the end.
    const metStartVol = -30; // very quiet at start (in dB)
    const metEndVol = -6; // much louder at round end
    metronomeSynth.volume.value = metStartVol + (metEndVol - metStartVol) * t;

    renderer.render(scene, camera);
  }

  animate();

  // Function to start the round with sound and scheduling
  function startRound() {
    // --- Start of round timer and tempo track setup ---
    roundStartTime = performance.now();

    // Set initial tempo and ramp BPM to 180 over the round duration
    transport.bpm.value = 100;
    transport.bpm.rampTo(180, roundDuration);

    // Start the Transport with a slight offset
    transport.start("+0.1");
    console.log("Transport started with offset +0.1");
    
    // Start the background music part in sync with the game round.
    backgroundPart.start("+0.1");

    // Late progression transition removed to keep consistent chord progression

    // Optionally, ramp up the background synth volume until round end (e.g., from -18 dB to -12 dB)
    backgroundSynth.volume.rampTo(-36, roundDuration);

    // Schedule block spawning: add two blocks per measure until the round ends
    transport.scheduleRepeat(spawnBlock, "2n");
    
    // Border flash removed for cleaner UI

    // Debug transport ticking
    transport.scheduleRepeat((time) => {
      console.log("Transport tick. Transport.seconds =", transport.seconds);
    }, "1m");

    // Update the round timer element every 100ms
    const roundTimerInterval = setInterval(() => {
      const elapsed = (performance.now() - roundStartTime) / 1000;
      const t = Math.min(elapsed / roundDuration, 1);
      const remaining = Math.max(0, roundDuration - elapsed);
      const minutes = Math.floor(remaining / 60);
      const seconds = Math.floor(remaining % 60);
      roundTimerElem.innerText = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      
      // Round progress (no longer used for music intensity)
      const progress = elapsed / roundDuration;
    
      // Gradually increase the chillhop beat's volume from -8 dB to 0 dB as the round progresses.
      lofiKick.volume.value = -8 + (8 * t);
      
      if (remaining <= 0) {
        clearInterval(roundTimerInterval);
        // Stop the round and perform cleanup:
        TONE.getTransport().stop();
        TONE.getTransport().cancel();  // Cancel all pending scheduled events.
        
        console.log("Round ended.");
        
        // Display summary overlay
        const summaryOverlay = document.createElement("div");
        summaryOverlay.id = "summaryOverlay";
        summaryOverlay.style.position = "absolute";
        summaryOverlay.style.top = "0";
        summaryOverlay.style.left = "0";
        summaryOverlay.style.right = "0";
        summaryOverlay.style.bottom = "0";
        summaryOverlay.style.background = "rgba(0, 0, 0, 0.8)";
        summaryOverlay.style.color = "white";
        summaryOverlay.style.display = "flex";
        summaryOverlay.style.flexDirection = "column";
        summaryOverlay.style.alignItems = "center";
        summaryOverlay.style.justifyContent = "center";
        summaryOverlay.style.fontFamily = "Roboto, sans-serif";
        summaryOverlay.innerHTML = `<h1>Round Over!</h1>
          <p>Final Score: ${score}</p>
          <p>Max Combo: ${maxCombo}</p>
          <button id="playAgainBtn" style="margin-top:20px; padding:10px 20px; font-size:18px; cursor:pointer;">Play Again</button>
          <p style="margin-top:10px;">Great job – click below to try again</p>
          <p style="font-size:24px; color:#ffcc00; margin-top:20px;">
            Vibecoded with love by Gianluca | <a href="https://jam.pieter.com" target="_blank" style="color:#a0a0ff; text-decoration:underline;">Vibe Jam 2025</a>
          </p>`;
        document.body.appendChild(summaryOverlay);
        
        document.getElementById("playAgainBtn")!.addEventListener("click", () => {
          // Option 1: Reload the page to restart the game:
          window.location.reload();
        });
      }
    }, 100);
  }

  // Remove loading text once the game is loaded
  const loadingElem = document.getElementById("loading");
  if (loadingElem) {
    loadingElem.remove();
  }
  
  // Add credit footer
  const creditElem = document.createElement("div");
  creditElem.id = "creditFooter";
  creditElem.style.position = "absolute";
  creditElem.style.bottom = "5px";
  creditElem.style.right = "10px";
  creditElem.style.color = "#8FA595";
  creditElem.style.fontSize = "12px";
  creditElem.style.fontFamily = "Roboto, sans-serif";
  creditElem.innerHTML = 'Vibecoded with love by <a href="https://gianluca.ai" target="_blank" style="color: #a0a0ff; text-decoration: none;">Gianluca</a> using Aider, OpenAI o3-mini, and Claude 3.7 Sonnet';
  document.body.appendChild(creditElem);

  // Handle window resize
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// Start the game
init().catch(console.error);
