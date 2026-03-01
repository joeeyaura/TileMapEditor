// Global variables

const WORLD_SCALE = 4; // 4 units per cell in game engine
let isGridVisible = true; // NEW: State for grid visibility
let walkCamera = null;
let yaw = 0; // Horizontal rotation
let pitch = 0; // Vertical rotation
let scene, camera, perspectiveCamera, orthographicCamera, renderer, gridHelper;
let tiles = new Map(); // All available tiles
let tilePacks = new Map(); // Pack organization
let activePackId = null;
let selectedPaletteTile = null;
let selectedPlacedTile = null;
let currentLayer = 1;
let maxLayer = 1; // Start with 1 layer
let raycaster, mouse;
let placedTiles = new Map(); // cellKey -> tileMesh
let isMouseDown = false;
let mouseButton = 0;
let cameraControls = {
    isPanning: false,
    isRotating: false,
    panStart: new THREE.Vector2(),
    panEnd: new THREE.Vector2(),
    panDelta: new THREE.Vector2(),
    rotateStart: new THREE.Vector2(),
    rotateEnd: new THREE.Vector2(),
    rotateDelta: new THREE.Vector2(),
    theta: Math.PI / 4,
    phi: Math.PI / 4
};
let detailMeshes = new Set(); // Free-placement detail meshes
let compassGroup = null;
let interactionMode = 'place'; // 'place' or 'select'
let draggedTile = null;
let previewGhost = null;
let cameraTarget = new THREE.Vector3(0, 0, 0);
let cameraDistance = 40;
let cameraMode = 'perspective'; // 'perspective' or 'topdown'
let meshCache = new Map();

let walkMode = false;
const walkSpeed = 5; // Increased for better feel
const sprintMult = 2;
const keys = {};
const clock = new THREE.Clock();
let detailPreview = null;
// Settings variables
let settings = {
    toneMapping: 5, // AgX
    exposure: 1.0,
    shadows: true,
    shadowQuality: 2048,
    fog: false,
    ambientIntensity: 1.0,
    directionalIntensity: 5.0,
    lightColor: 0xffffff,
    ambientOcclusion: false,
    aoRadius: 12,
    aoMinDistance: 0.002,
    aoMaxDistance: 0.12,
    gridSize: 64,
    gridColor1: 0x2a3f8a,
    gridColor2: 0x1a2a5a,
    backgroundColor: 0x0a0e27,
    fov: 45,
    ghostOpacity: 0.4,
    historySize: 50,
    autosaveInterval: 30
};
let directionalLight;
let ambientLight;
let fog;
let autoSaveInterval;
let composer = null;
let renderPass = null;
let ssaoPass = null;
let placementRotation = 0;
let isTransforming = false;

// Dual Mode System Variables
let editorMode = 'tiles'; // 'tiles' or 'details'
let previousTileMode = 'place'; // Store last tile mode when switching
let previousDetailMode = 'place'; // Store last detail mode when switching

// Add to global variables section in tilemap.js
let detailPacks = new Map(); // Detail pack organization
let details = new Map(); // All available detail meshes
let activeDetailPackId = null;
let currentPackType = 'tiles'; // 'tiles' or 'details'
let selectedDetail = null;

// History
const history = [];
let historyIndex = -1;
MAX_HISTORY = 50;

// Transform Gizmo Variables
let transformControls = null;
let transformMode = 'translate'; // 'translate', 'rotate', 'scale'
let transformSpace = 'world'; // 'world' or 'local'
let snapEnabled = false;
let transformSnapValues = {
    translate: 0.5,
    rotate: Math.PI / 8, // 22.5 degrees
    scale: 0.1
};

// Layer Management
let layerMap = new Map();
let detailLayerVisible = true;

const GRID_SIZE = 64;
const CELL_SIZE = 4;
const LAYER_HEIGHT = 1.0;
const AUTOSAVE_KEY = 'tilemap_autosave';
const AUTOSAVE_INTERVAL = 30000; // 30 seconds
const MODEL_SCALE = 0.25; // Scale factor for all imported models
const MODEL_SCALE_INVERSE = 1 / MODEL_SCALE; // = 4, for exporting
const EXPORT_SCALE = 4.0; // Your game engine uses 4x4x4 units per cell
const ORTHO_ZOOM_SCALE = 0.5;
// --- Command Pattern Classes ---

class Command
{
    constructor()
    {}
    execute()
    {
        throw new Error("Execute method must be implemented");
    }
    undo()
    {
        throw new Error("Undo method must be implemented");
    }
}

class PlaceTileCommand extends Command
{
    constructor(tileMesh, cellKey)
    {
        super();
        this.tileMesh = tileMesh;
        this.cellKey = cellKey;
    }
    execute()
    {
        scene.add(this.tileMesh);
        placedTiles.set(this.cellKey, this.tileMesh);

        if (this.tileMesh.userData.occupiedCells)
        {
            this.tileMesh.userData.occupiedCells.forEach(key => placedTiles.set(key, this.tileMesh));
        }

        animateTilePlacement(this.tileMesh);
    }
    undo()
    {
        scene.remove(this.tileMesh);
        placedTiles.delete(this.cellKey);

        if (this.tileMesh.userData.occupiedCells)
        {
            this.tileMesh.userData.occupiedCells.forEach(key => placedTiles.delete(key));
        }
    }
}

class RemoveTileCommand extends Command
{
    constructor(tileMesh, cellKey)
    {
        super();
        this.tileMesh = tileMesh;
        this.cellKey = cellKey;
        this.isDetail = tileMesh.userData.isDetail || false;
    }

    execute()
    {
        scene.remove(this.tileMesh);

        // Only remove from placedTiles if it's a tile (not a detail)
        if (!this.isDetail)
        {
            placedTiles.delete(this.cellKey);

            if (this.tileMesh.userData.occupiedCells)
            {
                this.tileMesh.userData.occupiedCells.forEach(key => placedTiles.delete(key));
            }
        }

        // Always remove from detailMeshes set if it's a detail
        if (this.isDetail)
        {
            detailMeshes.delete(this.tileMesh);
        }
    }

    undo()
    {
        scene.add(this.tileMesh);

        // Only restore to placedTiles if it's a tile
        if (!this.isDetail)
        {
            placedTiles.set(this.cellKey, this.tileMesh);

            if (this.tileMesh.userData.occupiedCells)
            {
                this.tileMesh.userData.occupiedCells.forEach(key => placedTiles.set(key, this.tileMesh));
            }
        }

        // Add back to detailMeshes set if it's a detail
        if (this.isDetail)
        {
            detailMeshes.add(this.tileMesh);
        }
    }
}

// Logs detailed intersection information for selection debugging.
function debugSelection(intersects)
{
    console.log("Number of intersects:", intersects.length);
    intersects.forEach((intersect, i) =>
    {
        console.log(`Intersect ${i}:`,
        {
            object: intersect.object.name || intersect.object.type,
            userData: intersect.object.userData,
            parentUserData: intersect.object.parent ? intersect.object.parent.userData : null
        });
    });
}

class RotateTileCommand extends Command
{
    constructor(tileMesh, oldRot, newRot)
    {
        super();
        this.tileMesh = tileMesh;
        // Store as integers 0-3
        this.oldRot = Math.round((oldRot % (Math.PI * 2)) / (Math.PI / 2)) % 4;
        this.newRot = Math.round((newRot % (Math.PI * 2)) / (Math.PI / 2)) % 4;

        // Store original position for proper undo
        this.oldWorldPos = tileMesh.position.clone();
        this.oldFootprintPos = {
            ...tileMesh.userData.position
        };
    }

    execute()
    {
        this._applyRotation(this.newRot);
    }

    undo()
    {
        this._applyRotation(this.oldRot);
    }

    _applyRotation(targetRotationInt)
    {
        const tileData = this.tileMesh.userData.tileData;
        const currentPos = this.tileMesh.userData.position;
        const pivotType = tileData.pivotType || "footprint_center";

        // Convert integer to radians
        const rotationRad = targetRotationInt * (Math.PI / 2);

        // 1. Clear old logical footprint
        if (this.tileMesh.userData.occupiedCells)
        {
            this.tileMesh.userData.occupiedCells.forEach(key => placedTiles.delete(key));
        }

        // 2. Get old and new effective dimensions
        const [oldW, oldH] = getEffectiveDimensions(tileData, this.tileMesh.rotation.y);
        const [newW, newH] = getEffectiveDimensions(tileData, rotationRad);

        // 3. Calculate NEW cell position to keep the tile centered
        let newCellX, newCellZ;

        if (pivotType === "footprint_center")
        {
            // For footprint center, we need to adjust cell position so the center stays the same
            // The center in world space should remain constant
            const worldPos = cellToWorld(
                currentPos.cellX + oldW / 2 - 0.5,
                currentPos.cellZ + oldH / 2 - 0.5
            );

            // Convert back to cell coordinates using NEW dimensions
            const targetCell = worldToCell(worldPos.x, worldPos.z);
            newCellX = Math.floor(targetCell.x - newW / 2 + 0.5);
            newCellZ = Math.floor(targetCell.z - newH / 2 + 0.5);
        }
        else if (pivotType === "bottom_left")
        {
            // For bottom-left pivot, keep the pivot point fixed
            newCellX = currentPos.cellX;
            newCellZ = currentPos.cellZ;
        }
        else
        {
            // Default to footprint center behavior
            const worldPos = cellToWorld(
                currentPos.cellX + oldW / 2 - 0.5,
                currentPos.cellZ + oldH / 2 - 0.5
            );
            const targetCell = worldToCell(worldPos.x, worldPos.z);
            newCellX = Math.floor(targetCell.x - newW / 2 + 0.5);
            newCellZ = Math.floor(targetCell.z - newH / 2 + 0.5);
        }

        // 4. Update position data
        this.tileMesh.userData.position.cellX = newCellX;
        this.tileMesh.userData.position.cellZ = newCellZ;

        // 5. Apply rotation
        this.tileMesh.rotation.y = rotationRad;
        this.tileMesh.userData.rotation = rotationRad;

        // 6. Update world position based on pivot type
        const worldPos = cellToWorld(newCellX + newW / 2 - 0.5, newCellZ + newH / 2 - 0.5);
        const layerY = (this.tileMesh.userData.position.layer - 1) * LAYER_HEIGHT;
        const manualOffset = tileData.yOffset || 0;
        const finalY = layerY + manualOffset;

        // Apply visual offset if any
        const visualOffset = tileData.visualOffset || [0, 0, 0];
        const targetX = worldPos.x + visualOffset[0];
        const targetY = finalY + visualOffset[1];
        const targetZ = worldPos.z + visualOffset[2];

        this.tileMesh.position.set(targetX, targetY, targetZ);

        // 7. Update occupied cells with NEW dimensions
        this.tileMesh.userData.occupiedCells = [];
        for (let dx = 0; dx < newW; dx++)
        {
            for (let dz = 0; dz < newH; dz++)
            {
                const key = `${newCellX + dx},${newCellZ + dz},${this.tileMesh.userData.position.layer}`;
                placedTiles.set(key, this.tileMesh);
                this.tileMesh.userData.occupiedCells.push(key);
            }
        }
    }
}

class TransformCommand extends Command
{
    constructor(tileMesh, oldState, newState)
    {
        super();
        this.tileMesh = tileMesh;
        this.oldState = {
            position: oldState.position.clone(),
            rotation: oldState.rotation.clone(),
            scale: oldState.scale.clone()
        };

        this.newState = {
            position: newState.position.clone(),
            rotation: newState.rotation.clone(),
            scale: newState.scale.clone()
        };

        this.isDetail = tileMesh.userData.isDetail || false;
        this.cellKey = `${tileMesh.userData.position.cellX},${tileMesh.userData.position.cellZ},${tileMesh.userData.position.layer}`;
        this.detailId = tileMesh.userData.uuid;
    }

    execute()
    {
        this._applyState(this.newState);
    }

    undo()
    {
        this._applyState(this.oldState);
    }

    _applyState(state)
    {
        const mesh = this.tileMesh;

        // Apply position and rotation
        mesh.position.copy(state.position);
        mesh.rotation.copy(state.rotation);

        if (this.isDetail)
        {
            // CRITICAL FIX: Validate originalScale exactly like initTransformControls does
            let originalScale;
            if (mesh.userData.originalScale &&
                typeof mesh.userData.originalScale.x === 'number' &&
                isFinite(mesh.userData.originalScale.x))
            {
                originalScale = mesh.userData.originalScale;
            }
            else
            {
                originalScale = new THREE.Vector3(1, 1, 1);
            }

            // Store the clean multiplier
            mesh.userData.scale = state.scale.clone();

            // Calculate actual scale: original * MODEL_SCALE * userScale
            const actualScale = new THREE.Vector3(
                originalScale.x * MODEL_SCALE * state.scale.x,
                originalScale.y * MODEL_SCALE * state.scale.y,
                originalScale.z * MODEL_SCALE * state.scale.z
            );

            // Apply scale
            mesh.scale.copy(actualScale);

            console.log("TransformCommand - Applied scale multiplier:", state.scale);
            console.log("TransformCommand - Actual scale applied:", mesh.scale);
        }
        else
        {
            mesh.scale.copy(state.scale);
        }

        // Ensure mesh is in the scene and visible
        if (!mesh.parent)
        {
            scene.add(mesh);
        }
        mesh.visible = true;
    }
}

// Returns detail scale multiplier.
function getDetailScaleMultiplier(detailMesh)
{
    if (!detailMesh.userData.isDetail) return detailMesh.scale.clone();

    // Return the scale multiplier stored in userData
    if (detailMesh.userData.scale)
    {
        return detailMesh.userData.scale.clone();
    }

    // Fallback to default scale from tileData
    const defaultScale = detailMesh.userData.tileData?.defaultScale || [1, 1, 1];
    return new THREE.Vector3(defaultScale[0], defaultScale[1], defaultScale[2]);
}

// Returns effective dimensions.
function getEffectiveDimensions(tileData, rotation)
{
    // Handle details that might not have traditional size
    if (!tileData.size)
    {
        return [1, 1]; // Default 1x1 for details
    }

    const [w, h] = tileData.size;
    // Check if rotated 90 or 270 degrees (π/2 or 3π/2)
    const isRotated = Math.abs(Math.abs(rotation) % Math.PI - Math.PI / 2) < 0.1;
    return isRotated ? [h, w] : [w, h];
}

// Executes a command, appends it to history, and trims redo state.
function executeCommand(command)
{
    if (historyIndex < history.length - 1)
    {
        history.splice(historyIndex + 1);
    }

    command.execute();
    history.push(command);
    historyIndex++;

    if (history.length > MAX_HISTORY)
    {
        history.shift();
        historyIndex--;
    }

    updateHistoryButtons();
}

// Reverts the previous action.
function undo()
{
    if (historyIndex >= 0)
    {
        history[historyIndex].undo();
        historyIndex--;
        updateHistoryButtons();
    }
}

// Reapplies the next action in history.
function redo()
{
    if (historyIndex < history.length - 1)
    {
        historyIndex++;
        history[historyIndex].execute();
        updateHistoryButtons();
    }
}

// Refreshes undo/redo button enabled states based on history position.
function updateHistoryButtons()
{
    document.getElementById('undoButton').disabled = historyIndex < 0;
    document.getElementById('redoButton').disabled = historyIndex === history.length - 1;
}

// --- Coordinate conversion ---
// Converts grid cell coordinates to world coordinates.
function cellToWorld(cellX, cellZ)
{
    return {
        x: cellX - GRID_SIZE / 2 + 0.5,
        z: cellZ - GRID_SIZE / 2 + 0.5
    };
}

// Converts world coordinates to grid cell coordinates.
function worldToCell(worldX, worldZ)
{
    return {
        x: Math.floor(worldX + GRID_SIZE / 2),
        z: Math.floor(worldZ + GRID_SIZE / 2)
    };
}

// Calculates the drawable viewport size from the current UI layout.
function getViewportDimensions()
{
    const leftWidth = document.getElementById('sidebar')?.offsetWidth || 0;
    const rightWidth = document.getElementById('layerSidebar')?.offsetWidth || 0;
    const bottomHeight = document.getElementById('asset-browser')?.offsetHeight || 0;
    const toolbarHeight = document.getElementById('toolbar')?.offsetHeight || 50;

    return {
        width: window.innerWidth - leftWidth - rightWidth,
        height: window.innerHeight - toolbarHeight - bottomHeight
    };
}

// Initializes the editor scene, UI bindings, and runtime systems.
function init()
{
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e27);

    const { width, height } = getViewportDimensions();
    const aspect = width / height;

    perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    orthographicCamera = new THREE.OrthographicCamera(-20 * aspect, 20 * aspect, 20, -20, 0.1, 1000);
    camera = perspectiveCamera;
    updateCameraPosition();

    walkCamera = new THREE.Object3D();
    walkCamera.position.set(0, 2, 0);
    scene.add(walkCamera);

    // Modern renderer setup
    renderer = new THREE.WebGLRenderer(
    {
        antialias: true,
        powerPreference: "high-performance"
    });
    //renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    renderer.setSize(window.innerWidth - 300, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setSize(width, height);
    document.getElementById('viewport').appendChild(renderer.domElement);

    // Lighting
    ambientLight = new THREE.AmbientLight(0x404040, 1.0); // Color, Intensity
    scene.add(ambientLight);

    // Add Directional Light for casting shadows
    directionalLight = new THREE.DirectionalLight(0xffffff, 5); // Color, Intensity
    directionalLight.position.set(60, 150, 60); // Position the light (e.g., from top-right-front)
    directionalLight.target.position.set(0, 0, 0); // Point it at the scene origin

    // 3. Configure Shadow Properties
    directionalLight.castShadow = true;

    // Configure the shadow map area for the orthographic camera inside the light
    const d = GRID_SIZE / 2;
    directionalLight.shadow.camera.left = -d;
    directionalLight.shadow.camera.right = d;
    directionalLight.shadow.camera.top = d;
    directionalLight.shadow.camera.bottom = -d;
    directionalLight.shadow.camera.near = 0.15;
    directionalLight.shadow.camera.far = 1500;
    directionalLight.shadow.mapSize.width = 4096; // Higher resolution for better shadows
    directionalLight.shadow.mapSize.height = 4096;
    directionalLight.shadow.bias = 0.01;
    scene.add(directionalLight);
    scene.add(directionalLight.target); // Must add target to the scene
    createGrid(0);

    // Initialize Layer 1
    layerMap.set(1,
    {
        name: 'Layer 1',
        locked: false,
        visible: true
    });

    // Fix Icon Error Programmatically
    const walkIcon = document.querySelector('[data-feather="walk"]');
    if (walkIcon) walkIcon.setAttribute('data-feather', 'navigation');

    updateLayerPanel();

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    loadSettingsFromStorage();
    setupPostProcessing();
    applySettings();
    setupControls();
    setupEventListeners();
    setupDragAndDrop();
    createCategoryTabs();
    updateEditorModeUI();
    create3DCompass();
    initTransformControls();

    // -----------------------------------------------------------------
    //  FIX: Define autoSavedLayout BEFORE the if/else block uses it.
    // -----------------------------------------------------------------
    let autoSavedLayout = checkAutoSave();

    autoLoadTilePacks(autoSavedLayout);

    // 2. Start Auto-Save Loop
    setupAutoSave();

    // Start the Global Animation Loop
    animate();
}

// Initializes transform controls.
function initTransformControls()
{
    // Create transform controls
    transformControls = new THREE.TransformControls(camera, renderer.domElement);
    transformControls.setSize(0.75);
    transformControls.visible = false;

    // Set up event listeners
    transformControls.addEventListener('dragging-changed', function(event)
    {
        isTransforming = event.value;

        if (event.value)
        {
            // Store the initial state for undo
            if (transformControls.object)
            {
                const mesh = transformControls.object;

                // FIX: Use the helper function or calculate the multiplier immediately.
                // We cannot store 'null' and fallback to actualScale later, because 
                // actualScale (e.g. 4.0) is not the same as the multiplier (e.g. 1.0).
                let currentMultiplier;
                if (mesh.userData.isDetail)
                {
                    if (mesh.userData.scale)
                    {
                        currentMultiplier = mesh.userData.scale.clone();
                    }
                    else
                    {
                        // Calculate initial multiplier if it doesn't exist
                        const originalScale = mesh.userData.originalScale || new THREE.Vector3(1, 1, 1);
                        const baseScale = new THREE.Vector3(
                            Math.max(originalScale.x * MODEL_SCALE, 0.001),
                            Math.max(originalScale.y * MODEL_SCALE, 0.001),
                            Math.max(originalScale.z * MODEL_SCALE, 0.001)
                        );
                        currentMultiplier = new THREE.Vector3(
                            mesh.scale.x / baseScale.x,
                            mesh.scale.y / baseScale.y,
                            mesh.scale.z / baseScale.z
                        );
                    }
                }
                else
                {
                    currentMultiplier = mesh.scale.clone();
                }

                mesh.userData.transformStartState = {
                    position: mesh.position.clone(),
                    rotation: mesh.rotation.clone(),
                    actualScale: mesh.scale.clone(),
                    scaleMultiplier: currentMultiplier
                };
            }
        }
        else
        {
            // Transformation ended - create undo command
            if (transformControls.object && transformControls.object.userData.transformStartState)
            {
                const mesh = transformControls.object;
                const startState = mesh.userData.transformStartState;

                // Calculate the new scale multiplier from the actual scale
                let newScaleMultiplier;

                if (mesh.userData.isDetail)
                {
                    // 1. Safely get originalScale
                    const originalScale = (mesh.userData.originalScale && typeof mesh.userData.originalScale.x === 'number') ?
                        mesh.userData.originalScale :
                        new THREE.Vector3(1, 1, 1);

                    // 2. Calculate base scale with SAFEGUARDS against zero
                    const baseScale = new THREE.Vector3(
                        Math.max(originalScale.x * MODEL_SCALE, 0.001),
                        Math.max(originalScale.y * MODEL_SCALE, 0.001),
                        Math.max(originalScale.z * MODEL_SCALE, 0.001)
                    );

                    // 3. Calculate multiplier with SAFEGUARDS against division by zero
                    newScaleMultiplier = new THREE.Vector3(
                        baseScale.x !== 0 ? mesh.scale.x / baseScale.x : 1.0,
                        baseScale.y !== 0 ? mesh.scale.y / baseScale.y : 1.0,
                        baseScale.z !== 0 ? mesh.scale.z / baseScale.z : 1.0
                    );

                    // 4. Check for NaN immediately and fix it
                    if (isNaN(newScaleMultiplier.x) || !isFinite(newScaleMultiplier.x))
                    {
                        newScaleMultiplier.x = startState.scaleMultiplier?.x || 1.0;
                    }
                    if (isNaN(newScaleMultiplier.y) || !isFinite(newScaleMultiplier.y))
                    {
                        newScaleMultiplier.y = startState.scaleMultiplier?.y || 1.0;
                    }
                    if (isNaN(newScaleMultiplier.z) || !isFinite(newScaleMultiplier.z))
                    {
                        newScaleMultiplier.z = startState.scaleMultiplier?.z || 1.0;
                    }

                    // 5. Robustly get min/max scale to prevent Clamping NaN errors
                    const tileData = mesh.userData.tileData ||
                    {};

                    // Helper to validate a scale array
                    const getSafeScale = (arr, defaultVal) =>
                    {
                        if (Array.isArray(arr) && arr.length >= 3)
                        {
                            return arr.map(n => (typeof n === 'number' && isFinite(n)) ? n : defaultVal);
                        }
                        return [defaultVal, defaultVal, defaultVal];
                    };

                    const minScaleArr = getSafeScale(tileData.minScale, 0.1);
                    const maxScaleArr = getSafeScale(tileData.maxScale, 5.0);

                    // 6. Clamp the multiplier using validated values
                    newScaleMultiplier.x = THREE.MathUtils.clamp(newScaleMultiplier.x, minScaleArr[0], maxScaleArr[0]);
                    newScaleMultiplier.y = THREE.MathUtils.clamp(newScaleMultiplier.y, minScaleArr[1], maxScaleArr[1]);
                    newScaleMultiplier.z = THREE.MathUtils.clamp(newScaleMultiplier.z, minScaleArr[2], maxScaleArr[2]);

                    // 7. Apply the clamped scale back to the mesh immediately
                    mesh.scale.set(
                        baseScale.x * newScaleMultiplier.x,
                        baseScale.y * newScaleMultiplier.y,
                        baseScale.z * newScaleMultiplier.z
                    );

                    // Store the clean multiplier
                    mesh.userData.scale = newScaleMultiplier.clone();
                }
                else
                {
                    // Non-detail meshes
                    newScaleMultiplier = mesh.scale.clone();
                }

                // Prepare command states
                // We use the calculated multiplier for both old and new state to keep consistency
                const oldState = {
                    position: startState.position,
                    rotation: startState.rotation,
                    scale: startState.scaleMultiplier || newScaleMultiplier.clone()
                };

                const newState = {
                    position: mesh.position.clone(),
                    rotation: mesh.rotation.clone(),
                    scale: newScaleMultiplier.clone()
                };

                // Only create command if something actually changed
                if (!oldState.position.equals(newState.position) ||
                    !oldState.rotation.equals(newState.rotation) ||
                    !oldState.scale.equals(newState.scale))
                {

                    console.log("Transform completed - New scale multiplier:", newState.scale);
                    console.log("Transform completed - Actual scale:", mesh.scale);

                    executeCommand(new TransformCommand(mesh, oldState, newState));
                }

                delete mesh.userData.transformStartState;
            }
        }
    });

    scene.add(transformControls);
}

// Clamps detail scale.
function clampDetailScale(mesh, actualScale)
{
    if (!mesh.userData.isDetail || !mesh.userData.tileData) return actualScale;

    const minScale = mesh.userData.tileData.minScale || [0.1, 0.1, 0.1];
    const maxScale = mesh.userData.tileData.maxScale || [5, 5, 5];

    // Simple clamping for now - just limit the actual scale
    return new THREE.Vector3(
        THREE.MathUtils.clamp(actualScale.x, minScale[0] * MODEL_SCALE, maxScale[0] * MODEL_SCALE),
        THREE.MathUtils.clamp(actualScale.y, minScale[1] * MODEL_SCALE, maxScale[1] * MODEL_SCALE),
        THREE.MathUtils.clamp(actualScale.z, minScale[2] * MODEL_SCALE, maxScale[2] * MODEL_SCALE)
    );
}

// --- The Global Animation Loop (Fixed) ---
// Runs the main animation and render loop.
function animate()
{
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    // Update logic
    if (walkMode)
    {
        updateWalker(delta);
        if (walkCamera) walkCamera.updateMatrixWorld();
    }

    // Render
    if (settings.ambientOcclusion && composer && ssaoPass)
    {
        composer.render();
    }
    else
    {
        renderer.render(scene, camera);
    }
}

// Sets up post processing.
function setupPostProcessing()
{
    const viewport = document.getElementById('viewport');
    const width = viewport ? viewport.clientWidth : renderer.domElement.width;
    const height = viewport ? viewport.clientHeight : renderer.domElement.height;

    if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.SSAOPass || !THREE.SSAOShader || !THREE.SimplexNoise)
    {
        console.warn("SSAO dependencies are missing. Ambient Occlusion will be disabled.");
        settings.ambientOcclusion = false;
        return;
    }

    composer = new THREE.EffectComposer(renderer);
    renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);

    try
    {
        ssaoPass = new THREE.SSAOPass(scene, camera, width, height);
        applyAmbientOcclusionSettings();
        composer.addPass(ssaoPass);
    }
    catch (error)
    {
        console.warn("Failed to initialize SSAO pass. Ambient Occlusion will be disabled.", error);
        ssaoPass = null;
        settings.ambientOcclusion = false;
    }
}

// Applies ambient occlusion settings.
function applyAmbientOcclusionSettings()
{
    if (!ssaoPass) return;

    if (settings.aoMaxDistance <= settings.aoMinDistance)
    {
        settings.aoMaxDistance = settings.aoMinDistance + 0.01;
    }

    ssaoPass.enabled = settings.ambientOcclusion;
    ssaoPass.kernelRadius = settings.aoRadius;
    ssaoPass.minDistance = settings.aoMinDistance;
    ssaoPass.maxDistance = settings.aoMaxDistance;
}

// Updates compass position.
function updateCompassPosition()
{
    if (compassGroup)
    {
        create3DCompass();
    }
}

// --- Setup & Events ---
// Registers DOM and keyboard event handlers for editor interaction.
function setupEventListeners()
{
    // Tool Buttons
    document.getElementById('toolSelect').addEventListener('click', () => setInteractionMode('select'));
    document.getElementById('toolPlace').addEventListener('click', () => setInteractionMode('place'));
    document.getElementById('toolErase').addEventListener('click', () => setInteractionMode('erase'));
    document.getElementById('exportMesh').addEventListener('click', exportAsMesh);
    document.getElementById('exportText').addEventListener('click', exportForSecondLife);
    // document.getElementById('toggleCompass').addEventListener('click', toggleCompass);


    // Add pack type switching
    document.getElementById('tilePacksTab').addEventListener('click', () => switchPackType('tiles'));
    document.getElementById('detailPacksTab').addEventListener('click', () => switchPackType('details'));

    // Undo/Redo
    document.getElementById('undoButton').addEventListener('click', undo);
    document.getElementById('redoButton').addEventListener('click', redo);

    // Camera / Walk
    document.getElementById('resetCamera').addEventListener('click', () =>
    {
        cameraDistance = 40;
        cameraControls.theta = Math.PI / 4;
        cameraControls.phi = Math.PI / 4;
        setCameraMode('perspective');
        updateCameraPosition();
    });
    document.getElementById('walkMode').addEventListener('click', toggleWalk);

    // View Presets
    document.getElementById('topView').addEventListener('click', () => setPresetView(0, Math.PI / 2, true));
    document.getElementById('isoView').addEventListener('click', () => setPresetView(Math.PI / 4, Math.PI / 4, false));

    document.addEventListener('keydown', (e) =>
    {
        if (e.key === 'Escape')
        {
            if (selectedPlacedTile)
            {
                deselectTile();
                showNotification("Deselected", "info");
                e.preventDefault();
            }
            else if (document.getElementById('settingsWindow').style.display !== 'none')
            {
                closeSettings();
            }
        }
        
    });


    // Mode switching
    document.getElementById('modeTiles').addEventListener('click', () => switchEditorMode('tiles'));
    document.getElementById('modeDetails').addEventListener('click', () => switchEditorMode('details'));

    // Transform controls
    document.getElementById('transformMove').addEventListener('click', () =>
    {
        if (editorMode === 'details')
        {
            setInteractionMode('translate');
        }
    });
    document.getElementById('transformRotate').addEventListener('click', () =>
    {
        if (editorMode === 'details')
        {
            setInteractionMode('rotate');
        }
    });
    document.getElementById('transformScale').addEventListener('click', () =>
    {
        if (editorMode === 'details')
        {
            setInteractionMode('scale');
        }
    });

    // Reset transform
    document.getElementById('resetTransform').addEventListener('click', resetDetailTransform);

    // Toggle snap
    document.getElementById('toggleSnap').addEventListener('click', toggleSnap);


    // Keyboard shortcuts for transform
    document.addEventListener('keydown', (event) =>
    {
        if (event.key === 't' || event.key === 'T')
        {
            toggleTransformMode();
        }
        else if (event.key === 's' || event.key === 'S')
        {
            toggleSnap();
        }
        else if (event.key === 'w' || event.key === 'W')
        {
            setTransformMode('translate');
        }
        else if (event.key === 'e' || event.key === 'E')
        {
            setTransformMode('rotate');
        }
        else if (event.key === 'p' || event.key === 'R')
        {
            setTransformMode('scale');
        }
        else if (event.key === '0' && selectedPlacedTile && selectedPlacedTile.userData.isDetail)
        {
            event.preventDefault();
            resetDetailScale();
        }
        else if (event.key === '1')
        {
            event.preventDefault();
            switchEditorMode('tiles');
        }
        else if (event.key === '2')
        {
            event.preventDefault();
            switchEditorMode('details');
        }
        else if (editorMode === 'details')
        {
            if (event.key === 'w' || event.key === 'W')
            {
                event.preventDefault();
                setInteractionMode('translate');
            }
            else if (event.key === 'e' || event.key === 'E')
            {
                event.preventDefault();
                setInteractionMode('rotate');
            }
            else if (event.key === 'r' || event.key === 'R')
            {
                event.preventDefault();
                setInteractionMode('scale');
            }
            else if (event.key === '0' && selectedPlacedTile && selectedPlacedTile.userData.isDetail)
            {
                event.preventDefault();
                resetDetailTransform();
            }
        }
    });


    // Layers
    document.getElementById('addLayer').addEventListener('click', addLayer);
    document.getElementById('deleteLayer').addEventListener('click', deleteLayer);

    // NEW: Grid Toggle
    document.getElementById('toggleGrid').addEventListener('click', toggleGrid);
    // Files
    document.getElementById('loadLayout').addEventListener('click', () =>
    {
        document.getElementById('layoutInput').click();
    });
    document.getElementById('layoutInput').addEventListener('change', handleLayoutLoad);
    document.getElementById('clearGrid').addEventListener('click', clearGrid);
    document.getElementById('saveLayout').addEventListener('click', saveLayout);

    // Open/Close
    document.getElementById('openSettings').addEventListener('click', openSettings);
    document.getElementById('closeSettings').addEventListener('click', closeSettings);

    // Range inputs with live updates
    const rangeInputs = document.querySelectorAll('#settingsWindow input[type="range"]');
    rangeInputs.forEach(input =>
    {
        input.addEventListener('input', (e) =>
        {
            const valueSpan = e.target.parentElement.querySelector('.setting-value');
            if (valueSpan)
            {
                if (e.target.id === 'fov')
                {
                    valueSpan.textContent = e.target.value + '°';
                }
                else if (e.target.id === 'autosaveInterval')
                {
                    valueSpan.textContent = e.target.value + 's';
                }
                else if (e.target.id === 'aoMinDistance')
                {
                    valueSpan.textContent = parseFloat(e.target.value).toFixed(3);
                }
                else if (e.target.id === 'aoMaxDistance')
                {
                    valueSpan.textContent = parseFloat(e.target.value).toFixed(2);
                }
                else if (e.target.id === 'aoRadius')
                {
                    valueSpan.textContent = parseInt(e.target.value);
                }
                else
                {
                    valueSpan.textContent = parseFloat(e.target.value).toFixed(1);
                }
            }
        });
    });

    // Apply & Save button
    document.getElementById('saveSettings').addEventListener('click', () =>
    {
        // Collect all settings from UI
        settings.toneMapping = parseInt(document.getElementById('toneMapper').value);
        settings.exposure = parseFloat(document.getElementById('toneExposure').value);
        settings.shadows = document.getElementById('enableShadows').checked;
        settings.shadowQuality = parseInt(document.getElementById('shadowQuality').value);
        settings.fog = document.getElementById('enableFog').checked;
        settings.ambientIntensity = parseFloat(document.getElementById('ambientIntensity').value);
        settings.directionalIntensity = parseFloat(document.getElementById('directionalIntensity').value);
        settings.lightColor = parseInt(document.getElementById('lightColor').value.replace('#', '0x'));
        settings.ambientOcclusion = document.getElementById('enableAO').checked;
        settings.aoRadius = parseInt(document.getElementById('aoRadius').value);
        settings.aoMinDistance = parseFloat(document.getElementById('aoMinDistance').value);
        settings.aoMaxDistance = parseFloat(document.getElementById('aoMaxDistance').value);
        settings.gridSize = parseInt(document.getElementById('gridSize').value);
        settings.gridColor1 = parseInt(document.getElementById('gridColor1').value.replace('#', '0x'));
        settings.gridColor2 = parseInt(document.getElementById('gridColor2').value.replace('#', '0x'));
        settings.backgroundColor = parseInt(document.getElementById('backgroundColor').value.replace('#', '0x'));
        settings.fov = parseInt(document.getElementById('fov').value);

        settings.ghostOpacity = parseFloat(document.getElementById('ghostOpacity').value);
        settings.historySize = parseInt(document.getElementById('historySize').value);
        settings.autosaveInterval = parseInt(document.getElementById('autosaveInterval').value);

        applySettings();
    });

    // Reset button
    document.getElementById('resetSettings').addEventListener('click', resetSettingsToDefaults);

    // Close on Escape key
    document.addEventListener('keydown', (e) =>
    {
        if (e.key === 'Escape' && document.getElementById('settingsWindow').style.display !== 'none')
        {
            closeSettings();
        }
    });
    // Keyboard
    document.addEventListener('keydown', (event) =>
    {
        if (event.code === 'KeyZ' && (event.ctrlKey || event.metaKey))
        {
            event.preventDefault();
            undo();
        }
        else if (event.code === 'KeyY' && (event.ctrlKey || event.metaKey))
        {
            event.preventDefault();
            redo();
        }

        else if (event.code === 'KeyM') setInteractionMode('select');
        else if (event.code === 'KeyP') setInteractionMode('place');
        else if (event.code === 'KeyE') setInteractionMode('erase');
        else if (event.code === 'KeyG') toggleGrid();

        else if (event.key === 'r' || event.key === 'R')
        {
            if (interactionMode === 'place')
            {
                // Rotate the "Brush"
                placementRotation += Math.PI / 2;
                // Update the ghost immediately
                if (previewGhost) previewGhost.rotation.y = placementRotation;
            }
            else if (selectedPlacedTile)
            {
                // Rotate the selected existing tile
                rotateSelectedTile();
            }
        }
        else if (event.key === 'Delete' && selectedPlacedTile)
        {
            const pos = selectedPlacedTile.userData.position;
            executeCommand(new RemoveTileCommand(selectedPlacedTile, `${pos.cellX},${pos.cellZ},${pos.layer}`));
        }
        else if (selectedPlacedTile && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code))
        {
            event.preventDefault();

            const currentPos = selectedPlacedTile.userData.position;
            const tileData = selectedPlacedTile.userData.tileData;
            const layerData = layerMap.get(currentPos.layer);

            if (layerData.locked)
            {
                showNotification("Cannot move: Layer is locked", "error");
                return;
            }

            const [w, h] = getEffectiveDimensions(tileData, selectedPlacedTile.userData.rotation);

            // For top-down view (phi close to 90°), use absolute directions
            // For perspective view, use camera-relative
            const isTopDown = cameraMode === 'topdown';

            let moveX = 0;
            let moveZ = 0;

            if (isTopDown)
            {
                // Top-down view: Use absolute directions (easier to predict)
                switch (event.code)
                {
                    case 'ArrowUp':
                        moveZ -= 1;
                        break;
                    case 'ArrowDown':
                        moveZ += 1;
                        break;
                    case 'ArrowLeft':
                        moveX -= 1;
                        break;
                    case 'ArrowRight':
                        moveX += 1;
                        break;
                }
            }
            else
            {
                // Perspective view: Use camera-relative
                const cameraDir = new THREE.Vector3();
                camera.getWorldDirection(cameraDir);
                cameraDir.y = 0;
                cameraDir.normalize();

                const cameraRight = new THREE.Vector3();
                cameraRight.crossVectors(cameraDir, new THREE.Vector3(0, 1, 0)).normalize();

                switch (event.code)
                {
                    case 'ArrowDown': // Toward camera center
                        moveX = Math.round(-cameraDir.x);
                        moveZ = Math.round(-cameraDir.z);
                        break;
                    case 'ArrowUp': // Away from camera center
                        moveX = Math.round(cameraDir.x);
                        moveZ = Math.round(cameraDir.z);
                        break;
                    case 'ArrowLeft': // Camera's left
                        moveX = Math.round(-cameraRight.x);
                        moveZ = Math.round(-cameraRight.z);
                        break;
                    case 'ArrowRight': // Camera's right
                        moveX = Math.round(cameraRight.x);
                        moveZ = Math.round(cameraRight.z);
                        break;
                }
            }

            let newX = currentPos.cellX + moveX;
            let newZ = currentPos.cellZ + moveZ;

            // Check bounds
            if (newX < 0 || newX + w > GRID_SIZE || newZ < 0 || newZ + h > GRID_SIZE)
            {
                showNotification("Cannot move: Out of bounds", "error");
                return;
            }

            if (checkCollision(newX, newZ, currentPos.layer, w, h, selectedPlacedTile))
            {
                showNotification("Cannot move: Tile in the way", "error");
                return;
            }

            const newPos = {
                cellX: newX,
                cellZ: newZ,
                layer: currentPos.layer
            };
            executeCommand(new MoveTileCommand(selectedPlacedTile, currentPos, newPos));
        }
    });
    window.addEventListener('resize', onWindowResize);
}

// Sets interaction mode.
function setInteractionMode(mode)
{
    // Only set interaction mode if we're in the correct editor mode
    if (editorMode === 'tiles' && (mode === 'translate' || mode === 'rotate' || mode === 'scale'))
    {
        return; // Don't allow transform modes in tile mode
    }

    if (interactionMode === mode) return;

    const prevBtn = document.querySelector(`.tool-button[data-mode="${interactionMode}"]`);
    if (prevBtn) prevBtn.classList.remove('active');

    interactionMode = mode;

    const newBtn = document.querySelector(`.tool-button[data-mode="${interactionMode}"]`);
    if (newBtn) newBtn.classList.add('active');

    updateModeIndicator();

    // Update transform controls based on mode
    if (editorMode === 'details')
    {
        if (mode === 'translate' || mode === 'rotate' || mode === 'scale')
        {
            // If we have a selected detail, update the transform mode
            if (selectedPlacedTile && selectedPlacedTile.userData.isDetail)
            {
                setTransformMode(mode);
            }
        }
        else if (mode === 'select')
        {
            // Hide transform controls when switching to select mode
            if (transformControls)
            {
                transformControls.visible = false;
            }
        }
    }
    else
    {
        // Tile mode - deselect when switching from select mode
        if (interactionMode !== 'select')
        {
            deselectTile();
        }
    }
}


// Resets detail transform.
function resetDetailTransform()
{
    if (selectedPlacedTile && selectedPlacedTile.userData.isDetail)
    {
        const detailData = selectedPlacedTile.userData.tileData;
        const defaultScale = detailData.defaultScale || [1, 1, 1];

        const oldState = {
            position: selectedPlacedTile.position.clone(),
            rotation: selectedPlacedTile.rotation.clone(),
            scale: selectedPlacedTile.userData.scale.clone()
        };

        // Reset to default scale multiplier
        const newState = {
            position: oldState.position, // Keep position
            rotation: new THREE.Euler(0, 0, 0), // Reset rotation
            scale: new THREE.Vector3(defaultScale[0], defaultScale[1], defaultScale[2])
        };

        // Execute command for undo/redo support
        executeCommand(new TransformCommand(selectedPlacedTile, oldState, newState));

        showNotification(`Reset transform to default`, 'info');
    }
}

// Updates editor mode ui.
function updateEditorModeUI()
{
    // Update mode buttons
    document.getElementById('modeTiles').classList.toggle('active', editorMode === 'tiles');
    document.getElementById('modeDetails').classList.toggle('active', editorMode === 'details');

    // Show/hide transform group
    const transformGroup = document.querySelector('.tool-group.transform-group');
    if (editorMode === 'details')
    {
        transformGroup.style.display = 'flex';
        transformGroup.classList.remove('disabled');
    }
    else
    {
        transformGroup.style.display = 'none';
        transformGroup.classList.add('disabled');
    }

    // Update interaction mode based on previous state
    if (editorMode === 'tiles')
    {
        setInteractionMode(previousTileMode);
    }
    else
    {
        setInteractionMode(previousDetailMode);
    }

    // Update status indicator
    updateModeIndicator();
}

// Toggles transform mode.
function toggleTransformMode()
{
    if (!transformControls || !transformControls.object)
    {
        showNotification("Select an object first", "warning");
        return;
    }

    // Cycle through transform modes
    const modes = ['translate', 'rotate', 'scale'];
    const currentIndex = modes.indexOf(transformMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setTransformMode(modes[nextIndex]);
}

// Sets transform mode.
function setTransformMode(mode)
{
    if (editorMode !== 'details') return;

    transformMode = mode;

    // Update transform buttons
    document.querySelectorAll('[data-transform]').forEach(btn =>
    {
        btn.classList.toggle('active', btn.dataset.transform === mode);
    });

    if (transformControls)
    {
        transformControls.setMode(mode);
        applyTransformSnapSettings();
    }

    // Update interaction mode
    interactionMode = mode;
    updateModeIndicator();

    //  showNotification(`Transform: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`, 'info');
}

// Toggles snap.
function toggleSnap()
{
    snapEnabled = !snapEnabled;

    if (transformControls)
    {
        applyTransformSnapSettings();
    }

    // Update button
    const btn = document.getElementById('toggleSnap');
    btn.classList.toggle('active', snapEnabled);
    btn.title = snapEnabled ? 'Snap: ON (S)' : 'Snap: OFF (S)';

    // showNotification(`Snap: ${snapEnabled ? 'ON' : 'OFF'}`, 'info');
}

// Updates mode indicator.
function updateModeIndicator()
{
    let statusText = `${editorMode === 'tiles' ? 'Tile' : 'Detail'} Mode: `;

    if (editorMode === 'tiles')
    {
        statusText += `${interactionMode.charAt(0).toUpperCase() + interactionMode.slice(1)} | `;
    }
    else
    {
        if (interactionMode === 'translate' || interactionMode === 'rotate' || interactionMode === 'scale')
        {
            statusText += `${interactionMode.charAt(0).toUpperCase() + interactionMode.slice(1)} | `;
        }
        else
        {
            statusText += `${interactionMode.charAt(0).toUpperCase() + interactionMode.slice(1)} | `;
        }
    }

    statusText += `Layer: ${currentLayer}`;

    const statusEl = document.getElementById('currentStatus');
    if (statusEl)
    {
        statusEl.innerText = statusText;
        statusEl.setAttribute('data-mode', editorMode);
    }

    const layerDisplay = document.getElementById('currentLayerDisplay');
    if (layerDisplay) layerDisplay.innerText = currentLayer;
}


// Sets preset view.
function setPresetView(theta, phi, topDown = false)
{
    cameraDistance = 60;
    cameraControls.theta = theta;
    cameraControls.phi = phi;
    setCameraMode(topDown ? 'topdown' : 'perspective');
    updateCameraPosition();
}

// Toggles grid.
function toggleGrid()
{
    if (gridHelper)
    {
        isGridVisible = !isGridVisible;
        // The gridHelper object controls the grid rendering in Three.js
        gridHelper.visible = isGridVisible;

        // Update the button icon and title for visual feedback
        const btn = document.getElementById('toggleGrid');
        if (btn)
        {
            btn.innerHTML = isGridVisible ?
                '<i data-feather="grid"></i>' :
                '<i data-feather="x-square"></i>';
            btn.title = isGridVisible ? 'Toggle Grid (G)' : 'Toggle Grid (G) - OFF';
            if (window.feather) feather.replace();
            //showNotification(`Grid: ${isGridVisible ? 'On' : 'Off'}`, 'info');
        }
    }
}
// --- Layer Logic ---

// Updates layer panel.
function updateLayerPanel()
{
    const layerListEl = document.getElementById('layerList');
    if (!layerListEl) return;

    layerListEl.innerHTML = '';

    const detailLi = document.createElement('li');
    detailLi.className = 'layer-item detail-layer-item';

    const detailIconButton = document.createElement('button');
    detailIconButton.className = 'layer-action-button';
    detailIconButton.innerHTML = '<i data-feather="layers"></i>';
    detailIconButton.title = 'Dedicated Detail Layer';
    detailIconButton.disabled = true;
    detailLi.appendChild(detailIconButton);

    const detailName = document.createElement('span');
    detailName.className = 'layer-name';
    detailName.innerText = 'Details Layer';
    detailLi.appendChild(detailName);

    const detailActions = document.createElement('div');
    detailActions.className = 'layer-actions';

    const detailVisibilityButton = document.createElement('button');
    detailVisibilityButton.className = 'layer-action-button';
    detailVisibilityButton.innerHTML = detailLayerVisible ? '<i data-feather="eye"></i>' : '<i data-feather="eye-off"></i>';
    detailVisibilityButton.title = detailLayerVisible ? 'Hide details' : 'Show details';
    detailVisibilityButton.onclick = (e) =>
    {
        e.stopPropagation();
        toggleDetailLayerVisibility(!detailLayerVisible);
        updateLayerPanel();
    };
    detailActions.appendChild(detailVisibilityButton);

    detailLi.appendChild(detailActions);
    layerListEl.appendChild(detailLi);

    const sortedKeys = Array.from(layerMap.keys()).sort((a, b) => a - b);

    sortedKeys.forEach(num =>
    {
        const data = layerMap.get(num);
        const li = document.createElement('li');
        li.className = 'layer-item' + (num === currentLayer ? ' active' : '');
        li.dataset.layerNum = num;

        const selectButton = document.createElement('button');
        selectButton.className = 'layer-action-button';
        selectButton.innerHTML = num === currentLayer ? '<i data-feather="check-circle" style="color: #4fc3f7;"></i>' : '<i data-feather="circle"></i>';
        selectButton.onclick = (e) =>
        {
            e.stopPropagation();
            currentLayer = num;
            updateLayerPanel();
            updateModeIndicator();

            // Move grid to the new layer height
            updateGridPosition();
        };
        li.appendChild(selectButton);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'layer-name';
        nameSpan.innerText = data.name;
        nameSpan.onclick = () =>
        {
            const newName = prompt(`Rename Layer ${num}:`, data.name);
            if (newName)
            {
                data.name = newName.trim();
                updateLayerPanel();
            }
        };
        li.appendChild(nameSpan);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'layer-actions';

        const visibilityButton = document.createElement('button');
        visibilityButton.className = 'layer-action-button';
        visibilityButton.innerHTML = data.visible !== false ? '<i data-feather="eye"></i>' : '<i data-feather="eye-off"></i>';
        visibilityButton.onclick = (e) =>
        {
            e.stopPropagation();
            data.visible = !data.visible;
            toggleLayerVisibility(num, data.visible);
            updateLayerPanel();
        };
        actionsDiv.appendChild(visibilityButton);

        const lockButton = document.createElement('button');
        lockButton.className = 'layer-action-button' + (data.locked ? ' locked' : '');
        lockButton.innerHTML = data.locked ? '<i data-feather="lock"></i>' : '<i data-feather="unlock"></i>';
        lockButton.onclick = (e) =>
        {
            e.stopPropagation();
            data.locked = !data.locked;
            updateLayerPanel();
        };
        actionsDiv.appendChild(lockButton);

        li.appendChild(actionsDiv);
        layerListEl.appendChild(li);
    });

    if (window.feather) feather.replace();

    const delBtn = document.getElementById('deleteLayer');
    if (delBtn) delBtn.disabled = layerMap.size <= 1;
}

// Updates grid position.
function updateGridPosition()
{
    if (!gridHelper) return;

    // Calculate Y position for current layer (layer 1 = 0, layer 2 = LAYER_HEIGHT, etc.)
    const layerY = (currentLayer - 1) * LAYER_HEIGHT;

    // Animate the grid movement (optional, but nice)
    const targetY = layerY;
    const duration = 300; // ms
    const startY = gridHelper.position.y;
    const startTime = Date.now();

    function animateGridMove()
    {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function for smooth animation
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        const currentY = startY + (targetY - startY) * easeOutCubic;

        gridHelper.position.y = currentY;

        if (progress < 1)
        {
            requestAnimationFrame(animateGridMove);
        }
    }

    animateGridMove();
}

// Adds a new editable layer and refreshes layer UI state.
function addLayer()
{
    // Find the next available layer number
    const existingLayers = Array.from(layerMap.keys()).sort((a, b) => a - b);
    let newLayerNum = 1;

    // Find the first gap in layer numbers
    for (let i = 0; i < existingLayers.length; i++)
    {
        if (existingLayers[i] > newLayerNum)
        {
            // Found a gap, use this number
            break;
        }
        newLayerNum = existingLayers[i] + 1;
    }

    // If no gaps found, use the next number after the highest
    if (layerMap.has(newLayerNum))
    {
        newLayerNum = existingLayers[existingLayers.length - 1] + 1;
    }

    layerMap.set(newLayerNum,
    {
        name: `Layer ${newLayerNum}`,
        locked: false,
        visible: true
    });

    currentLayer = newLayerNum;
    maxLayer = Math.max(maxLayer, newLayerNum);

    updateLayerPanel();
    updateModeIndicator();
    updateGridPosition();
}

// Deletes the currently selected layer when allowed and updates layer state.
function deleteLayer()
{
    if (layerMap.size <= 1) return;

    const layerNumToDelete = currentLayer;

    let hasTiles = false;
    for (let [key, mesh] of placedTiles)
    {
        if (!mesh.userData.isDetail && mesh.userData.position.layer === layerNumToDelete)
        {
            hasTiles = true;
            break;
        }
    }

    if (hasTiles && !confirm(`Layer ${layerNumToDelete} has tiles. Delete anyway?`)) return;

    const toRemove = [];
    placedTiles.forEach((mesh, key) =>
    {
        if (!mesh.userData.isDetail && mesh.userData.position.layer === layerNumToDelete)
        {
            if (!toRemove.includes(mesh)) toRemove.push(mesh);
        }
    });

    toRemove.forEach(mesh =>
    {
        scene.remove(mesh);
        mesh.userData.occupiedCells.forEach(k => placedTiles.delete(k));
    });

    layerMap.delete(layerNumToDelete);

    // Recalculate maxLayer (find the highest existing layer)
    const remainingLayers = Array.from(layerMap.keys());
    if (remainingLayers.length > 0)
    {
        maxLayer = Math.max(...remainingLayers);
        currentLayer = remainingLayers[remainingLayers.length - 1];
    }
    else
    {
        // Should never happen since we have at least 1 layer
        maxLayer = 1;
        currentLayer = 1;
    }

    updateLayerPanel();
    updateModeIndicator();
    updateGridPosition();
}

// Toggles layer visibility.
function toggleLayerVisibility(layerNum, isVisible)
{
    scene.traverse(object =>
    {
        if (object.userData && object.userData.position && !object.userData.isDetail && object.userData.position.layer === layerNum)
        {
            object.visible = isVisible;
        }
    });
}

// Toggles detail layer visibility.
function toggleDetailLayerVisibility(isVisible)
{
    detailLayerVisible = isVisible;

    detailMeshes.forEach(mesh =>
    {
        if (mesh) mesh.visible = isVisible;
    });

    if (selectedPlacedTile && selectedPlacedTile.userData?.isDetail && !isVisible)
    {
        deselectTile();
    }
}

// --- Camera & Walk Mode ---

// Toggles first-person walk mode on or off.
function toggleWalk()
{
    walkMode = !walkMode;
    const btn = document.getElementById('walkMode');
    if (btn) btn.classList.toggle('walk-active', walkMode);

    if (walkMode)
    {
        renderer.domElement.requestPointerLock();

        walkCamera.position.copy(camera.position);
        //walkCamera.position.y = Math.max(0, walkCamera.position.y);
        walkCamera.position.y = camera.position.y;
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion);
        yaw = euler.y;
        pitch = 0;

        walkCamera.add(camera);
        camera.position.set(0, 0, 0);
        camera.rotation.set(0, 0, 0);
    }
    else
    {
        document.exitPointerLock();
        walkCamera.remove(camera);
        scene.add(camera);
        updateCameraPosition();
    }
}

document.addEventListener('pointerlockchange', () =>
{
    if (document.pointerLockElement !== renderer.domElement && walkMode)
    {
        toggleWalk();
    }
});

document.addEventListener('mousemove', (e) =>
{
    if (!walkMode || document.pointerLockElement !== renderer.domElement) return;

    const sensitivity = 0.002;
    yaw -= e.movementX * sensitivity;
    pitch -= e.movementY * sensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));

    walkCamera.rotation.order = 'YXZ';
    walkCamera.rotation.y = yaw;
    walkCamera.rotation.x = pitch;
    walkCamera.rotation.z = 0;
});

window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// Updates walk-mode movement and camera direction each frame.
function updateWalker(delta)
{
    if (!walkMode) return;

    const forward = keys['KeyW'] ? 1 : 0;
    const backward = keys['KeyS'] ? 1 : 0;
    const left = keys['KeyA'] ? 1 : 0;
    const right = keys['KeyD'] ? 1 : 0;
    const up = keys['KeyE'] ? 1 : 0;
    const down = keys['KeyQ'] ? 1 : 0;
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];

    const dir = new THREE.Vector3();
    walkCamera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();

    const rightVec = new THREE.Vector3();
    rightVec.crossVectors(dir, new THREE.Vector3(0, 1, 0));

    const velocity = new THREE.Vector3();

    velocity.addScaledVector(dir, forward - backward);
    velocity.addScaledVector(rightVec, right - left);


    velocity.set(0, 0, 0);
    velocity.addScaledVector(dir, forward - backward); // W should go towards Look
    velocity.addScaledVector(rightVec, right - left); // D should go towards Right

    velocity.set(0, 0, 0);
    velocity.addScaledVector(dir, backward - forward); // FLIPPED: S is now Forward-positive
    velocity.addScaledVector(rightVec, left - right); // FLIPPED: A is now Right-positive

    velocity.normalize();

    const finalSpeed = walkSpeed * (sprint ? sprintMult : 1) * delta;
    velocity.multiplyScalar(finalSpeed);

    // Vertical movement (fly mode)
    velocity.y = (up - down) * finalSpeed;

    walkCamera.position.add(velocity);

    // Bounds constraint
    const half = GRID_SIZE / 2;
    walkCamera.position.x = THREE.MathUtils.clamp(walkCamera.position.x, -half, half);
    walkCamera.position.z = THREE.MathUtils.clamp(walkCamera.position.z, -half, half);
    walkCamera.position.y = Math.max(0.5, walkCamera.position.y);
}

// Returns layout data.
function getLayoutData()
{
    return buildLayoutData();
}

// Normalizes serialized tile rotation values to quarter-turn integers (0-3).
function normalizeTileQuarterTurns(rotationValue)
{
    if (!Number.isFinite(rotationValue)) return 0;

    // Already in quarter-turn format.
    if (Number.isInteger(rotationValue) && rotationValue >= 0 && rotationValue <= 3)
    {
        return rotationValue;
    }

    // Legacy export sometimes stored very large integer turn counts.
    if (Number.isInteger(rotationValue) && Math.abs(rotationValue) > 3)
    {
        return ((rotationValue % 4) + 4) % 4;
    }

    // Assume radians and snap to nearest 90 degrees to prevent 45°/off-grid rotations.
    const quarterTurns = Math.round(rotationValue / (Math.PI / 2));
    return ((quarterTurns % 4) + 4) % 4;
}

// Converts serialized tile rotation (int or radians) into snapped radians.
function getSnappedTileRotationRadians(rotationValue)
{
    return normalizeTileQuarterTurns(rotationValue) * (Math.PI / 2);
}

// Normalizes serialized detail rotation values into an XYZ Euler.
function normalizeDetailRotationEuler(rotationValue, fallbackY = 0)
{
    if (Array.isArray(rotationValue) && rotationValue.length >= 3)
    {
        return new THREE.Euler(
            Number.isFinite(rotationValue[0]) ? rotationValue[0] : 0,
            Number.isFinite(rotationValue[1]) ? rotationValue[1] : fallbackY,
            Number.isFinite(rotationValue[2]) ? rotationValue[2] : 0
        );
    }

    if (rotationValue && typeof rotationValue === 'object')
    {
        return new THREE.Euler(
            Number.isFinite(rotationValue.x) ? rotationValue.x : 0,
            Number.isFinite(rotationValue.y) ? rotationValue.y : fallbackY,
            Number.isFinite(rotationValue.z) ? rotationValue.z : 0
        );
    }

    const y = Number.isFinite(rotationValue) ? rotationValue : fallbackY;
    return new THREE.Euler(0, y, 0);
}

// Resolves per-detail angle snap (degrees in JSON) into radians.
function getDetailRotationSnapRadians(detailData)
{
    if (!detailData) return transformSnapValues.rotate;

    const snapping = detailData.snapping;
    if (snapping === 'none' || snapping === false)
    {
        return null;
    }

    const candidateDegrees = [
        detailData.angleSnap,
        detailData.angleSnaps,
        detailData.rotationSnap,
        detailData.rotationSnapDegrees,
        detailData.snapAngle,
        typeof snapping === 'number' ? snapping : null,
        typeof snapping === 'string' ? parseFloat(snapping) : null,
        (snapping && typeof snapping === 'object') ? (snapping.angle ?? snapping.rotation ?? snapping.degrees) : null
    ];

    const angleDegrees = candidateDegrees.find(v => Number.isFinite(v) && v > 0);
    if (!Number.isFinite(angleDegrees))
    {
        return transformSnapValues.rotate;
    }

    return THREE.MathUtils.degToRad(angleDegrees);
}

// Applies active transform snap values, including per-detail rotation snapping.
function applyTransformSnapSettings()
{
    if (!transformControls) return;

    if (!snapEnabled)
    {
        transformControls.setTranslationSnap(null);
        transformControls.setRotationSnap(null);
        transformControls.setScaleSnap(null);
        return;
    }

    if (transformMode === 'translate')
    {
        transformControls.setTranslationSnap(transformSnapValues.translate);
    }
    else if (transformMode === 'rotate')
    {
        const detailData = transformControls.object?.userData?.isDetail ? transformControls.object.userData.tileData : null;
        transformControls.setRotationSnap(getDetailRotationSnapRadians(detailData));
    }
    else if (transformMode === 'scale')
    {
        transformControls.setScaleSnap(transformSnapValues.scale);
    }
}

// Builds a complete layout payload for autosave and manual save.
function buildLayoutData()
{
    const layout = {
        version: '2.2',
        gridSize: GRID_SIZE,
        detailLayerVisible,
        tiles: [],
        details: [],
        layers: []
    };

    const processed = new Set();

    // Save grid tiles.
    placedTiles.forEach(tile =>
    {
        if (!tile?.userData || processed.has(tile.userData.uuid) || tile.userData.isDetail) return;

        processed.add(tile.userData.uuid);
        const tileData = tile.userData.tileData;
        const packId = tileData.packId?.split(':')[0] || 'unknown';

        layout.tiles.push(
        {
            packId,
            tileId: tileData.originalId || tileData.id.split(':')[1],
            position:
            {
                x: tile.userData.position.cellX,
                z: tile.userData.position.cellZ,
                layer: tile.userData.position.layer
            },
            rotation: normalizeTileQuarterTurns(tile.userData.rotation || 0)
        });
    });

    // Save free-form details.
    detailMeshes.forEach(mesh =>
    {
        if (!mesh?.userData || processed.has(mesh.userData.uuid)) return;

        processed.add(mesh.userData.uuid);

        const detailData = mesh.userData.tileData;
        const packId = detailData.packId?.split(':')[0] || 'unknown';
        const scale = mesh.userData.scale || new THREE.Vector3(1, 1, 1);

        layout.details.push(
        {
            packId,
            detailId: detailData.originalId || detailData.id.split(':')[1],
            position:
            {
                x: mesh.position.x,
                y: mesh.position.y,
                z: mesh.position.z
            },
            rotation:
            {
                x: mesh.rotation.x,
                y: mesh.rotation.y,
                z: mesh.rotation.z
            },
            scale: [scale.x, scale.y, scale.z],
            layer: mesh.userData.position.layer
        });
    });

    // Export layer metadata for restoration.
    Array.from(layerMap.entries()).forEach(([num, data]) =>
    {
        layout.layers.push(
        {
            num,
            ...data
        });
    });

    return layout;
}

// Checks whether an auto-saved layout exists and is still valid.
function checkAutoSave()
{
    const savedData = localStorage.getItem(AUTOSAVE_KEY);
    if (savedData)
    {
        if (confirm("Found an auto-saved session. Do you want to load it and restore your progress?"))
        {
            try
            {
                const layout = JSON.parse(savedData);
                // We return the layout data here. It will be passed to autoLoadTilePacks
                // and then loadLayout, which handles the actual rendering after packs are ready.
                return layout;
            }
            catch (e)
            {
                console.error("Failed to parse auto-save data:", e);
                localStorage.removeItem(AUTOSAVE_KEY); // Clear bad data
                return null;
            }
        }
        else
        {
            localStorage.removeItem(AUTOSAVE_KEY); // User chose to discard
            return null;
        }
    }
    return null;
}

// Saves the current layout to local storage automatically.
function autoSave()
{
    const layout = getLayoutData();
    try
    {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(layout));
        // console.log("Auto-save successful.");
    }
    catch (e)
    {
        console.warn("Auto-save failed: LocalStorage quota exceeded or error.", e);
    }
}


// Starts the periodic auto-save timer.
function setupAutoSave()
{
    autoSave();
    setInterval(autoSave, AUTOSAVE_INTERVAL);
}
// Add at global level or with other helper functions
// Draws a temporary line in the scene to visualize the raycast direction.
function visualizeRaycast(raycaster, length = 10, color = 0xff0000, duration = 1000)
{
    // Create an arrow helper
    const arrow = new THREE.ArrowHelper(
        raycaster.ray.direction.clone().normalize(),
        raycaster.ray.origin,
        length,
        color,
        0.3, // head length
        0.2 // head width
    );

    scene.add(arrow);

    // Auto-remove after duration
    setTimeout(() =>
    {
        scene.remove(arrow);
        // Clean up
        arrow.geometry.dispose();
        if (Array.isArray(arrow.material))
        {
            arrow.material.forEach(m => m.dispose());
        }
        else
        {
            arrow.material.dispose();
        }
    }, duration);

    return arrow;
}

// Logs detailed raycast diagnostics for troubleshooting selection.
function debugRaycastDetails()
{
    console.log('=== DETAIL RAYCAST DEBUG ===');
    console.log('detailMeshes size:', detailMeshes.size);

    // Check if detailMeshes actually contain valid meshes
    let validCount = 0;
    detailMeshes.forEach(mesh =>
    {
        if (mesh && mesh.isObject3D)
        {
            validCount++;
            console.log(`- Mesh: ${mesh.uuid.substring(0,8)}, isDetail: ${mesh.userData.isDetail}, visible: ${mesh.visible}, position:`, mesh.position);

            // Check if mesh has children with geometry
            let hasGeometry = false;
            mesh.traverse(child =>
            {
                if (child.isMesh && child.geometry)
                {
                    hasGeometry = true;
                    console.log(`  └─ Child mesh: ${child.uuid.substring(0,8)}, geometry: ${child.geometry.type}, vertices: ${child.geometry.attributes.position?.count || 0}`);
                }
            });
            if (!hasGeometry)
            {
                console.warn(`  └─ ⚠️ No geometry found in detail mesh!`);
            }
        }
    });
    console.log(`Valid meshes: ${validCount}/${detailMeshes.size}`);

    // Test raycast on ALL scene objects to see if anything is being hit
    const allMeshes = [];
    scene.traverse(obj =>
    {
        if (obj.isMesh && obj.visible)
        {
            allMeshes.push(obj);
        }
    });

    const allIntersects = raycaster.intersectObjects(allMeshes);
    console.log(`Total scene meshes: ${allMeshes.length}, Intersections: ${allIntersects.length}`);

    if (allIntersects.length > 0)
    {
        console.log('First hit:',
        {
            name: allIntersects[0].object.name,
            type: allIntersects[0].object.type,
            parent: allIntersects[0].object.parent?.type,
            distance: allIntersects[0].distance,
            point: allIntersects[0].point,
            isDetail: allIntersects[0].object.userData.isDetail ||
                allIntersects[0].object.parent?.userData.isDetail || false
        });
    }

    console.log('===============================');
}

// Handles mouse-down interactions in the editor viewport.
function onMouseDown(event)
{
    if (walkMode) return;



    isMouseDown = true;
    mouseButton = event.button;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (event.button === 0)
    {


        if (layerMap.get(currentLayer).locked) return;

        raycaster.setFromCamera(mouse, camera);


        // Different behavior based on editor mode
        if (editorMode === 'tiles')
        {
            // Tile mode behavior
            if (interactionMode === 'select')
            {
                const intersects = raycastTiles();
                if (intersects.length > 0)
                {
                    const tileMesh = getRootTileMesh(intersects[0].object);
                    if (!tileMesh.userData.isDetail && tileMesh.userData.position.layer === currentLayer)
                    {
                        selectTile(tileMesh);
                    }
                }
                else
                {
                    deselectTile();
                }
            }
            else if (interactionMode === 'erase')
            {
                const intersects = raycastTiles();
                if (intersects.length > 0)
                {
                    const tileMesh = getRootTileMesh(intersects[0].object);
                    if (!tileMesh.userData.isDetail && tileMesh.userData.position.layer === currentLayer)
                    {
                        const pos = tileMesh.userData.position;
                        executeCommand(new RemoveTileCommand(tileMesh, `${pos.cellX},${pos.cellZ},${pos.layer}`));
                    }
                }
            }
        }
        else
        {

            // Detail mode behavior - raycast details
            if (interactionMode === 'select' || interactionMode === 'translate' ||
                interactionMode === 'rotate' || interactionMode === 'scale' ||
                interactionMode === 'erase')
            {

                // Raycast details specifically
                const detailArray = Array.from(detailMeshes);

                // Do ONE raycast
                const intersects = raycaster.intersectObjects(detailArray, true);

                // Visualize the SAME raycast
                //  visualizeRaycast(raycaster, 30, 0xff0000, 2000);

                //debugRaycastDetails();
                if (intersects.length > 0)
                {
                    // Get the root detail mesh (this could be a child mesh of the detail)
                    const detailMesh = getRootTileMesh(intersects[0].object);


                    // Only handle detail meshes in detail mode
                    if (detailMesh.userData.isDetail && detailMesh.userData.position.layer === currentLayer)
                    {
                        if (interactionMode === 'erase')
                        {
                            const pos = detailMesh.userData.position;
                            executeCommand(new RemoveTileCommand(detailMesh, `${pos.cellX},${pos.cellZ},${pos.layer}`));
                        }
                        else
                        {
                            // For all other modes (select, translate, rotate, scale)
                            selectTile(detailMesh);

                            // If we're in a transform mode, update the gizmo mode
                            if (interactionMode === 'translate' || interactionMode === 'rotate' || interactionMode === 'scale')
                            {
                                setTransformMode(interactionMode);
                            }
                            else if (interactionMode === 'select')
                            {
                                // If we were in select mode, switch to translate for the gizmo
                                setTransformMode('translate');
                            }
                        }
                    }
                }
                else
                {
                    // Clicked on empty space
                    if (!isTransforming)
                    {
                        deselectTile();
                    }
                }
            }
        }
    }


    if (event.button === 2 && cameraMode !== 'topdown')
    {
        cameraControls.isRotating = true;
        cameraControls.rotateStart.set(event.clientX, event.clientY);
    }
    if (event.button === 1)
    {
        cameraControls.isPanning = true;
        cameraControls.panStart.set(event.clientX, event.clientY);
    }
}


// Handles mouse-move interactions in the editor viewport.
function onMouseMove(event)
{
    if (walkMode || isTransforming) return; // NEW: Skip if transforming

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (cameraControls.isPanning)
    {
        cameraControls.panEnd.set(event.clientX, event.clientY);
        cameraControls.panDelta.subVectors(cameraControls.panEnd, cameraControls.panStart);

        const panSpeed = 0.05;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.getWorldDirection(right);
        right.cross(camera.up).normalize();
        up.copy(camera.up);

        cameraTarget.addScaledVector(right, -cameraControls.panDelta.x * panSpeed);
        cameraTarget.addScaledVector(up, cameraControls.panDelta.y * panSpeed);
        updateCameraPosition();
        cameraControls.panStart.copy(cameraControls.panEnd);
    }
    else if (cameraControls.isRotating)
    {

        cameraControls.rotateEnd.set(event.clientX, event.clientY);
        cameraControls.rotateDelta.subVectors(cameraControls.rotateEnd, cameraControls.rotateStart);

        const rotateSpeed = 0.005;
        cameraControls.theta -= cameraControls.rotateDelta.x * rotateSpeed;
        cameraControls.phi -= cameraControls.rotateDelta.y * rotateSpeed;
        cameraControls.phi = Math.max(0.02, Math.min(Math.PI - 0.12, cameraControls.phi));

        updateCameraPosition();
        cameraControls.rotateStart.copy(cameraControls.rotateEnd);
    }

    if (!cameraControls.isPanning && !cameraControls.isRotating)
    {
        // Create a plane at the specific height of the current layer
        const layerY = (currentLayer - 1) * LAYER_HEIGHT;
        const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -layerY);

        raycaster.setFromCamera(mouse, camera);
        const target = new THREE.Vector3();

        const hit = raycaster.ray.intersectPlane(dragPlane, target);

        if (hit)
        {
            // Different preview logic based on editor mode
            if (editorMode === 'tiles')
            {
                // Tile mode preview
                if (interactionMode === 'place' && selectedPaletteTile)
                {
                    updateTilePreview(target);
                }
                else if (interactionMode === 'select' && selectedPlacedTile && !selectedPlacedTile.userData.isDetail)
                {
                    updateTilePreview(target, selectedPlacedTile.userData.tileData, selectedPlacedTile);
                }
                else
                {
                    removePreviewGhost();
                }
            }
            else
            {
                // Detail mode preview
                if (interactionMode === 'place' && selectedDetail)
                {
                    updateDetailPreview(selectedDetail, target);
                }
                else
                {
                    removeDetailPreview();
                }
            }
        }
        else
        {
            removePreviewGhost();
            removeDetailPreview();
        }
    }
}

// Updates tile preview.
function updateTilePreview(hitPoint, tileData = null, excludeMesh = null)
{
    const tileToUse = tileData || selectedPaletteTile;
    if (!tileToUse)
    {
        removePreviewGhost();
        return;
    }

    const [tileWidth, tileHeight] = tileToUse.size;
    const rot = (interactionMode === 'select' && selectedPlacedTile) ?
        selectedPlacedTile.userData.rotation : placementRotation;

    const [effW, effH] = getEffectiveDimensions(tileToUse, rot);
    let cell = worldToCell(hitPoint.x, hitPoint.z);

    cell.x = Math.floor(cell.x - effW / 2 + 0.5);
    cell.z = Math.floor(cell.z - effH / 2 + 0.5);

    if (cell.x < 0 || cell.x + effW > GRID_SIZE || cell.z < 0 || cell.z + effH > GRID_SIZE)
    {
        removePreviewGhost();
        return;
    }

    if (!previewGhost)
    {
        const ghostMaterial = new THREE.MeshLambertMaterial(
        {
            color: new THREE.Color(tileToUse.color || '#4fc3f7'),
            transparent: true,
            opacity: settings.ghostOpacity,
            side: THREE.DoubleSide,
            emissive: new THREE.Color(tileToUse.color || '#4fc3f7').multiplyScalar(0.2)
        });
        const geometry = new THREE.BoxGeometry(tileWidth, 1.0, tileHeight);
        previewGhost = new THREE.Mesh(geometry, ghostMaterial);
        scene.add(previewGhost);
    }
    else
    {
        if (previewGhost.geometry.parameters.width !== tileWidth || previewGhost.geometry.parameters.depth !== tileHeight)
        {
            previewGhost.geometry.dispose();
            previewGhost.geometry = new THREE.BoxGeometry(tileWidth, 1.0, tileHeight);
        }
    }

    const worldPos = cellToWorld(cell.x + effW / 2 - 0.5, cell.z + effH / 2 - 0.5);
    previewGhost.position.set(worldPos.x, (currentLayer - 1) * LAYER_HEIGHT + 0.5, worldPos.z);
    previewGhost.rotation.y = rot;

    const valid = !checkCollision(cell.x, cell.z, currentLayer, effW, effH, excludeMesh);
    previewGhost.material.color.setHex(valid ? (tileToUse.color ? new THREE.Color(tileToUse.color).getHex() : 0x4fc3f7) : 0xff0000);
    updatePreviewGhostAppearance();
}

// Updates detail preview.
function updateDetailPreview(detailData, hitPoint)
{
    removeDetailPreview();

    // Create a preview sphere at the ACTUAL hit point (on the ground)
    const previewGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const previewMaterial = new THREE.MeshLambertMaterial(
    {
        color: 0xf7a84f,
        transparent: true,
        opacity: 0.6,
        wireframe: true
    });

    detailPreview = new THREE.Mesh(previewGeometry, previewMaterial);

    // Position at hit point, slightly raised so it's visible above grid
    detailPreview.position.copy(hitPoint);
    detailPreview.position.y += 0.15; // Just enough to avoid z-fighting

    // Add scale indicator box - THIS is the wireframe box showing the detail's size
    const defaultScale = detailData.defaultScale || [1, 1, 1];

    // Create a box geometry that represents the actual detail size
    const indicatorGeometry = new THREE.BoxGeometry(
        defaultScale[0] * MODEL_SCALE,
        defaultScale[1] * MODEL_SCALE,
        defaultScale[2] * MODEL_SCALE
    );
    const indicatorMaterial = new THREE.MeshBasicMaterial(
    {
        color: 0x00ff00,
        wireframe: true,
        transparent: true,
        opacity: 0.5
    });
    const scaleIndicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);

    // Center the box on the sphere
    scaleIndicator.position.y = (defaultScale[1] * MODEL_SCALE) / 2;

    detailPreview.add(scaleIndicator);
    scene.add(detailPreview);
}

// Handles mouse-up interactions and finalizes drag/place actions.
async function onMouseUp(event)
{
    if (walkMode) return;

    if (event.button === 0)
    {
        if (layerMap.get(currentLayer).locked) return;

        // Calculate hit point on the specific layer plane
        const layerY = (currentLayer - 1) * LAYER_HEIGHT;
        const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -layerY);

        raycaster.setFromCamera(mouse, camera);
        const target = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(dragPlane, target);

        if (hit)
        {
            if (editorMode === 'tiles')
            {
                // Tile mode placement
                if (interactionMode === 'place' && selectedPaletteTile && !draggedTile)
                {
                    const point = target;
                    const cell = worldToCell(point.x, point.z);
                    const [placeW, placeH] = getEffectiveDimensions(selectedPaletteTile, placementRotation);
                    const adjustX = Math.floor(cell.x - placeW / 2 + 0.5);
                    const adjustZ = Math.floor(cell.z - placeH / 2 + 0.5);

                    const mesh = await prepareTileMesh(adjustX, adjustZ, currentLayer, selectedPaletteTile, placementRotation);
                    if (mesh)
                    {
                        const cellKey = `${adjustX},${adjustZ},${currentLayer}`;
                        if (!checkCollision(adjustX, adjustZ, currentLayer, placeW, placeH))
                        {
                            executeCommand(new PlaceTileCommand(mesh, cellKey));
                        }
                        else
                        {
                            showNotification("Cannot place here!", "error");
                        }
                    }
                }
            }
            else
            {
                // Detail mode placement
                if (interactionMode === 'place' && selectedDetail && !draggedTile)
                {
                    const gridSnap = event.altKey;

                    if (gridSnap)
                    {
                        // Snap to grid
                        const cell = worldToCell(target.x, target.z);
                        const worldPos = cellToWorld(cell.x + 0.5, cell.z + 0.5);
                        await placeDetailMesh(selectedDetail, worldPos);
                    }
                    else
                    {
                        // Free placement at exact position
                        await placeDetailMesh(selectedDetail, target);
                    }
                }
            }
        }
    }

    removePreviewGhost();
    removeDetailPreview();
    isMouseDown = false;
    cameraControls.isPanning = false;
    cameraControls.isRotating = false;
    draggedTile = null;
}

// Handles mouse-wheel zoom input.
function onMouseWheel(event)
{
    const zoomSpeed = 0.1;
    const direction = event.deltaY > 0 ? 1 : -1;
    cameraDistance = Math.max(1, Math.min(200, cameraDistance * (1 + direction * zoomSpeed)));
    updateCameraPosition();
}

// Checks whether a tile footprint collides with existing tiles on a layer.
function checkCollision(x, z, layer, w, h, excludeMesh = null)
{
    for (let i = 0; i < w; i++)
    {
        for (let j = 0; j < h; j++)
        {
            const key = `${x+i},${z+j},${layer}`;
            if (placedTiles.has(key))
            {
                if (excludeMesh && placedTiles.get(key) === excludeMesh) continue;
                return true;
            }
        }
    }
    return false;
}

// Builds and configures a tile mesh for a target cell placement.
async function prepareTileMesh(cellX, cellZ, layer, tileData, rotationOverride = null)
{
    const width = tileData.size[0];
    const height = tileData.size[1];
    const rotation = rotationOverride !== null ? rotationOverride : (tileData.rotation || 0);

    // Get dimensions as they will appear on the grid (swapped if rotated 90/270)
    const [effectiveW, effectiveH] = getEffectiveDimensions(tileData, rotation);

    if (cellX < 0 || cellX + effectiveW > GRID_SIZE || cellZ < 0 || cellZ + effectiveH > GRID_SIZE)
    {
        return null;
    }

    let mesh;
    if (tileData.mesh)
    {
        try
        {
            const baseMesh = await loadMesh(tileData.mesh);
            mesh = baseMesh.clone(true);

            // Apply MODEL_SCALE to bring from world units to grid units
            //mesh.scale.multiplyScalar(MODEL_SCALE);

            // 1. Apply Rotation FIRST so bounding box checks are accurate to orientation
            mesh.rotation.y = rotation;

            // 2. Get initial scaled bounds
            const box = new THREE.Box3().setFromObject(mesh);
            const center = box.getCenter(new THREE.Vector3());

            // 4. Calculate Target World Position (center of footprint)
            const worldPos = cellToWorld(cellX + effectiveW / 2 - 0.5, cellZ + effectiveH / 2 - 0.5);

            // 5. Determine pivot type and visual offset
            const pivotType = tileData.pivotType || "footprint_center";
            const visualOffset = tileData.visualOffset || [0, 0, 0];
            const layerY = (layer - 1) * LAYER_HEIGHT;
            const manualOffset = tileData.yOffset || 0;
            const finalY = layerY + manualOffset;

            // 6. Position based on pivot type
            let targetX, targetY, targetZ;

            switch (pivotType)
            {
                case "visual_center":
                    // OLD behavior - centers visual bounds on footprint center
                    targetX = worldPos.x - center.x;
                    targetY = finalY - box.min.y;
                    targetZ = worldPos.z - center.z;
                    break;

                case "footprint_center":
                    // NEW: Mesh origin at footprint center (recommended for most tiles)
                    targetX = worldPos.x;
                    targetY = finalY;
                    targetZ = worldPos.z;
                    break;

                case "bottom_left":
                    // Mesh origin at bottom-left corner of footprint
                    const footprintMin = cellToWorld(cellX, cellZ);
                    targetX = footprintMin.x + 0.5; // Center of first cell in X
                    targetY = finalY;
                    targetZ = footprintMin.z + 0.5; // Center of first cell in Z
                    break;

                case "bottom_center":
                    // Mesh origin at bottom-center of footprint (good for walls, fences)
                    targetX = worldPos.x;
                    targetY = finalY;
                    // Bottom edge in Z direction
                    targetZ = cellToWorld(cellX, cellZ).z + 0.5;
                    break;

                case "custom":
                    // Fully custom position - use visualOffset as absolute offset from footprint center
                    targetX = worldPos.x;
                    targetY = finalY;
                    targetZ = worldPos.z;
                    break;

                default:
                    // Default to footprint_center
                    targetX = worldPos.x;
                    targetY = finalY;
                    targetZ = worldPos.z;
            }

            // 7. Apply visual offset for fine-tuning
            targetX += visualOffset[0];
            targetY += visualOffset[1];
            targetZ += visualOffset[2];

            // 8. Apply final position
            mesh.position.set(targetX, targetY, targetZ);

            // Restore rotation (it's already applied, but good to ensure userData tracks it)
            mesh.rotation.y = rotation;

            mesh.traverse((child) =>
            {
                if (child.isMesh)
                {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material)
                    {
                        child.material = Array.isArray(child.material) ?
                            child.material.map(mat => mat.clone()) :
                            child.material.clone();

                        // Ensure tone mapping is enabled for new materials
                        if (Array.isArray(child.material))
                        {
                            child.material.forEach(mat =>
                            {
                                mat.toneMapped = true;
                            });
                        }
                        else
                        {
                            child.material.toneMapped = true;
                        }
                    }
                }
            });
        }
        catch (error)
        {
            console.warn(`Failed to load mesh "${tileData.mesh}", using fallback:`, error);
            mesh = createFallbackMesh(tileData);
            // Apply rotation to fallback mesh
            mesh.rotation.y = rotation;
            const worldPos = cellToWorld(cellX + effectiveW / 2 - 0.5, cellZ + effectiveH / 2 - 0.5);
            mesh.position.set(worldPos.x, (layer - 1) * LAYER_HEIGHT, worldPos.z);
        }
    }
    else
    {
        mesh = createFallbackMesh(tileData);
        // Apply rotation to fallback mesh
        mesh.rotation.y = rotation;
        const worldPos = cellToWorld(cellX + effectiveW / 2 - 0.5, cellZ + effectiveH / 2 - 0.5);
        mesh.position.set(worldPos.x, (layer - 1) * LAYER_HEIGHT, worldPos.z);
    }

    // Standard user data setup
    mesh.userData = {
        tileData:
        {
            ...tileData,
            // Store pivot info for rotation handling
            pivotType: tileData.pivotType || "footprint_center",
            visualOffset: tileData.visualOffset || [0, 0, 0]
        },
        position:
        {
            cellX,
            cellZ,
            layer
        },
        originalColor: new THREE.Color(tileData.color || '#888888'),
        occupiedCells: [],
        rotation: rotation,
        uuid: THREE.MathUtils.generateUUID(),
        // Store original position for reference
        originalPosition: mesh.position.clone()
    };

    // Mark occupied cells
    for (let dx = 0; dx < effectiveW; dx++)
    {
        for (let dz = 0; dz < effectiveH; dz++)
        {
            mesh.userData.occupiedCells.push(`${cellX + dx},${cellZ + dz},${layer}`);
        }
    }
    return mesh;
}

// Updates preview ghost.
function updatePreviewGhost(overrideTile, excludeMesh = null, hitPoint = null)
{
    const tileToUse = overrideTile || selectedPaletteTile;
    if (!tileToUse) return;

    const [tileWidth, tileHeight] = tileToUse.size;

    // Use the passed hitPoint, or calculate it if missing (fallback)
    let point = hitPoint;
    if (!point)
    {
        raycaster.setFromCamera(mouse, camera);
        const layerY = (currentLayer - 1) * LAYER_HEIGHT;
        const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -layerY);
        point = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, point);
    }

    if (point)
    {
        const rot = (interactionMode === 'select' && selectedPlacedTile) ?
            selectedPlacedTile.userData.rotation :
            placementRotation;

        const [effW, effH] = getEffectiveDimensions(tileToUse, rot);
        let cell = worldToCell(point.x, point.z);

        // IMPORTANT: Use the same center calculation as placement/rotation
        cell.x = Math.floor(cell.x - effW / 2 + 0.5);
        cell.z = Math.floor(cell.z - effH / 2 + 0.5);

        if (cell.x < 0 || cell.x + effW > GRID_SIZE || cell.z < 0 || cell.z + effH > GRID_SIZE)
        {
            removePreviewGhost();
            return;
        }

        if (!previewGhost)
        {
            const ghostMaterial = new THREE.MeshLambertMaterial(
            {
                color: new THREE.Color(tileToUse.color || '#4fc3f7'),
                transparent: true,
                opacity: settings.ghostOpacity, // Use setting
                side: THREE.DoubleSide,
                emissive: new THREE.Color(tileToUse.color || '#4fc3f7').multiplyScalar(0.2)
            });
            const geometry = new THREE.BoxGeometry(tileWidth, 1.0, tileHeight);
            previewGhost = new THREE.Mesh(geometry, ghostMaterial);
            scene.add(previewGhost);
        }
        else
        {
            // Update geometry if tile size changed
            if (previewGhost.geometry.parameters.width !== tileWidth || previewGhost.geometry.parameters.depth !== tileHeight)
            {
                previewGhost.geometry.dispose();
                previewGhost.geometry = new THREE.BoxGeometry(tileWidth, 1.0, tileHeight);
            }
        }

        const worldPos = cellToWorld(cell.x + effW / 2 - 0.5, cell.z + effH / 2 - 0.5);

        previewGhost.position.set(worldPos.x, (currentLayer - 1) * LAYER_HEIGHT + 0.5, worldPos.z);
        previewGhost.rotation.y = rot;

        const valid = !checkCollision(cell.x, cell.z, currentLayer, effW, effH, excludeMesh);
        previewGhost.material.color.setHex(valid ? (tileToUse.color ? new THREE.Color(tileToUse.color).getHex() : 0x4fc3f7) : 0xff0000);
        updatePreviewGhostAppearance();

    }
    else
    {
        removePreviewGhost();
    }
}

// Updates preview ghost appearance.
function updatePreviewGhostAppearance()
{
    if (!previewGhost || !previewGhost.material) return;

    previewGhost.material.transparent = true;
    previewGhost.material.opacity = settings.ghostOpacity;
    previewGhost.material.wireframe = false;

    if (previewGhost.material.emissive)
    {
        previewGhost.material.emissive.copy(previewGhost.material.color).multiplyScalar(0.2);
    }

    previewGhost.material.needsUpdate = true;
}

// Removes preview ghost.
function removePreviewGhost()
{
    if (previewGhost)
    {
        scene.remove(previewGhost);
        previewGhost.geometry.dispose();
        previewGhost.material.dispose();
        previewGhost = null;
    }
}

// Returns root tile mesh.
function getRootTileMesh(intersectedObject)
{
    let obj = intersectedObject;

    // First, try to find if this is part of a detail mesh
    while (obj)
    {
        if (obj.userData && obj.userData.isDetail)
        {
            return obj; // This is a detail mesh
        }
        if (obj.userData && obj.userData.tileData && !obj.userData.isPreview)
        {
            return obj; // This is a regular tile
        }
        obj = obj.parent;
    }

    // If we didn't find a valid root, return the original object
    return intersectedObject;
}

// Raycasts the scene and returns tile/detail intersections under the cursor.
function raycastTiles()
{
    const tileMeshes = [];
    const processed = new Set();

    // Add grid-based tiles - ONLY these should block placement
    placedTiles.forEach(tile =>
    {
        if (tile && tile.userData && !tile.userData.isDetail && !tile.userData.isPreview && !processed.has(tile.uuid))
        {
            processed.add(tile.uuid);
            tileMeshes.push(tile);
        }
    });

    // Add detail meshes separately - these can be selected but don't block placement
    detailMeshes.forEach(mesh =>
    {
        if (mesh && mesh.userData && !mesh.userData.isPreview && !processed.has(mesh.uuid))
        {
            processed.add(mesh.uuid);
            tileMeshes.push(mesh);
        }
    });

    return raycaster.intersectObjects(tileMeshes, true);
}

// Selects tile.
function selectTile(tileMesh)
{
    // Don't select if we're in the wrong mode
    if (editorMode === 'tiles' && tileMesh.userData.isDetail)
    {
        return;
    }
    if (editorMode === 'details' && !tileMesh.userData.isDetail)
    {
        return;
    }

    // If we're already selecting this tile, do nothing
    if (selectedPlacedTile === tileMesh) return;

    deselectTile();
    selectedPlacedTile = tileMesh;

    // Apply highlight with different colors for tiles vs details
    tileMesh.traverse((child) =>
    {
        if (child.isMesh && child.material)
        {
            if (child.material.emissive)
            {
                child.userData.oldEmissive = child.material.emissive.getHex();
                // Use blue for tiles, orange for details
                const highlightColor = tileMesh.userData.isDetail ? 0xffa500 : 0x4444ff;
                child.material.emissive.setHex(highlightColor);
            }
        }
    });

    // Attach transform controls for details in detail mode
    if (editorMode === 'details' && tileMesh.userData.isDetail && transformControls)
    {
        transformControls.attach(tileMesh);
        transformControls.visible = true;
        applyTransformSnapSettings();
        setTransformMode('translate');
    }

    // Force update the mode indicator
    updateModeIndicator();
}

// Deselects tile.
function deselectTile()
{
    if (selectedPlacedTile)
    {
        // Remove highlight
        selectedPlacedTile.traverse((child) =>
        {
            if (child.isMesh && child.material && child.material.emissive)
            {
                child.material.emissive.setHex(child.userData.oldEmissive || 0x000000);
            }
        });

        // Detach transform controls
        if (transformControls)
        {
            transformControls.detach();
            transformControls.visible = false;
        }

        selectedPlacedTile = null;
        updateModeIndicator();
    }
}

// Rotates selected tile.
function rotateSelectedTile()
{
    if (!selectedPlacedTile) return;

    const tileData = selectedPlacedTile.userData.tileData;
    const currentRot = selectedPlacedTile.userData.rotation || 0;
    const newRot = currentRot + Math.PI / 2;
    const pos = selectedPlacedTile.userData.position;

    // 1. Calculate new effective dimensions
    const [oldW, oldH] = getEffectiveDimensions(tileData, currentRot);
    const [newW, newH] = getEffectiveDimensions(tileData, newRot);

    // 2. Calculate new cell position to keep center
    const worldPos = cellToWorld(pos.cellX + oldW / 2 - 0.5, pos.cellZ + oldH / 2 - 0.5);
    const targetCell = worldToCell(worldPos.x, worldPos.z);
    const newCellX = Math.floor(targetCell.x - newW / 2 + 0.5);
    const newCellZ = Math.floor(targetCell.z - newH / 2 + 0.5);

    // 3. Check Bounds with NEW position
    if (newCellX < 0 || newCellX + newW > GRID_SIZE ||
        newCellZ < 0 || newCellZ + newH > GRID_SIZE)
    {
        showNotification("Cannot rotate: Out of bounds", "error");
        return;
    }

    // 4. Check Collision at NEW position
    if (checkCollision(newCellX, newCellZ, pos.layer, newW, newH, selectedPlacedTile))
    {
        showNotification("Cannot rotate: Blocked", "error");
        return;
    }

    // 5. Execute Command
    executeCommand(new RotateTileCommand(selectedPlacedTile, currentRot, newRot));
}

// Creates fallback mesh.
function createFallbackMesh(tileData)
{
    const geometry = new THREE.BoxGeometry(
        tileData.size[0], // Already at world scale
        0.5,
        tileData.size[1]
    );
    const material = new THREE.MeshLambertMaterial(
    {
        color: new THREE.Color(tileData.color || '#888888'),
        side: THREE.FrontSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Scale the fallback mesh to match imported models
    applyModelScale(mesh);

    return mesh;
}

// Plays a short placement animation for newly spawned tile meshes.
function animateTilePlacement(mesh)
{
    const originalScale = mesh.scale.x;

    mesh.scale.set(0, 0, 0);
    let progress = 0;

    function animatePlacementStep()
    {
        progress += 0.1;
        const s = Math.min(progress, 1) * originalScale;
        mesh.scale.set(s, s, s);
        if (progress < 1) requestAnimationFrame(animatePlacementStep);
    }
    animatePlacementStep();
}

// Sets up controls.
function setupControls()
{
    const viewport = renderer.domElement;
    viewport.addEventListener('wheel', onMouseWheel, false);
    viewport.addEventListener('mousedown', onMouseDown, false);
    viewport.addEventListener('mousemove', onMouseMove, false);
    viewport.addEventListener('mouseup', onMouseUp, false);
    viewport.addEventListener('mouseleave', () =>
    {
        cameraControls.isPanning = false;
        cameraControls.isRotating = false;
        removePreviewGhost();
    });
    viewport.addEventListener('contextmenu', e => e.preventDefault());
}

// Creates or recreates the editable grid helper at the requested height.
function createGrid(layerY = 0)
{
    // Remove existing grid if it exists
    if (gridHelper)
    {
        scene.remove(gridHelper);
        if (gridHelper.geometry) gridHelper.geometry.dispose();
        if (gridHelper.material)
        {
            if (Array.isArray(gridHelper.material))
            {
                gridHelper.material.forEach(mat => mat.dispose());
            }
            else
            {
                gridHelper.material.dispose();
            }
        }
    }

    // Create new grid at the specified layer height
    gridHelper = new THREE.GridHelper(
        settings.gridSize,
        settings.gridSize,
        settings.gridColor1,
        settings.gridColor2
    );

    // Position grid at the current layer height
    gridHelper.position.y = layerY;
    scene.add(gridHelper);
    gridHelper.visible = isGridVisible;
}

// Switches active camera type between perspective and top-down orthographic.
function setCameraMode(mode)
{
    cameraMode = mode;
    camera = mode === 'topdown' ? orthographicCamera : perspectiveCamera;

    if (mode !== 'topdown')
    {
        camera.up.set(0, 1, 0);
    }

    if (renderPass) renderPass.camera = camera;
    if (ssaoPass) ssaoPass.camera = camera;
    if (transformControls) transformControls.camera = camera;
}

// Updates the orbital editor camera position from camera control values.
function updateCameraPosition()
{
    if (cameraMode === 'topdown')
    {
        const aspect = orthographicCamera.aspect || 1;
        const orthoSize = Math.max(2, cameraDistance * ORTHO_ZOOM_SCALE);

        orthographicCamera.left = -orthoSize * aspect;
        orthographicCamera.right = orthoSize * aspect;
        orthographicCamera.top = orthoSize;
        orthographicCamera.bottom = -orthoSize;
        orthographicCamera.position.set(cameraTarget.x, cameraTarget.y + cameraDistance, cameraTarget.z);
        orthographicCamera.up.set(0, 0, -1);
        orthographicCamera.lookAt(cameraTarget);
        orthographicCamera.updateProjectionMatrix();
        return;
    }

    perspectiveCamera.position.set(
        cameraTarget.x + cameraDistance * Math.sin(cameraControls.theta) * Math.cos(cameraControls.phi),
        cameraTarget.y + cameraDistance * Math.sin(cameraControls.phi),
        cameraTarget.z + cameraDistance * Math.cos(cameraControls.theta) * Math.cos(cameraControls.phi)
    );
    perspectiveCamera.lookAt(cameraTarget);
}

// Handles viewport resize updates for camera and renderer.
function onWindowResize()
{
    const { width, height } = getViewportDimensions();
    const aspect = width / height;

    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();

    orthographicCamera.aspect = aspect;
    if (cameraMode === 'topdown')
    {
        updateCameraPosition();
    }

    renderer.setSize(width, height);

    if (composer) composer.setSize(width, height);
    if (ssaoPass) ssaoPass.setSize(width, height);

    // Update transform controls camera
    if (transformControls)
    {
        transformControls.camera = camera;
    }
}

// Places detail at position.
function placeDetailAtPosition(detailData, position, rotation = 0, scale = [1, 1, 1])
{
    // Create a detail mesh at exact position (not grid-snapped)
    return prepareDetailMesh(position.x, position.z, currentLayer, detailData, rotation, scale);
}

// Builds and configures a detail mesh for free-form placement.
async function prepareDetailMesh(worldX, worldZ, layer, detailData, rotation = 0, scaleMultiplier = null)
{
    try
    {
        // Load the detail mesh
        const baseMesh = await loadMesh(detailData.mesh);
        const mesh = baseMesh.clone(true);

        // CRITICAL: Store the original scale from the base mesh
        // This should be (1,1,1) for most models, but we store it anyway
        mesh.userData.originalScale = (baseMesh.userData.originalScale || new THREE.Vector3(1, 1, 1)).clone();

        // Reset to original scale first
        mesh.scale.copy(mesh.userData.originalScale);

        // Apply MODEL_SCALE
        mesh.scale.multiplyScalar(MODEL_SCALE);

        // Use the provided scale multiplier or default
        const targetScale = scaleMultiplier || detailData.defaultScale || [1, 1, 1];

        // Apply the scale multiplier
        mesh.scale.x *= targetScale[0];
        mesh.scale.y *= targetScale[1];
        mesh.scale.z *= targetScale[2];

        // Position at exact world coordinates
        const layerY = (layer - 1) * LAYER_HEIGHT;
        const yOffset = detailData.yOffset || 0;

        mesh.position.set(worldX, layerY + yOffset, worldZ);
        mesh.rotation.y = rotation;

        // Calculate grid cell for selection
        const cell = worldToCell(worldX, worldZ);
        const cellKey = `${cell.x},${cell.z},${layer}`;

        // Setup user data with the scale multiplier
        mesh.userData = {
            isDetail: true,
            originalScale: mesh.userData.originalScale.clone(), // Make sure this is preserved
            tileData:
            {
                ...detailData,
                size: detailData.size || [1, 1],
                originalId: detailData.originalId,
                packId: detailData.packId,
                pivotType: "free",
                visualOffset: detailData.visualOffset || [0, 0, 0],
                minScale: detailData.minScale || [0.1, 0.1, 0.1],
                maxScale: detailData.maxScale || [5, 5, 5],
                defaultScale: detailData.defaultScale || [1, 1, 1]
            },
            position:
            {
                cellX: cell.x,
                cellZ: cell.z,
                layer: layer,
                worldX: worldX,
                worldZ: worldZ
            },
            originalColor: new THREE.Color(detailData.color || '#4fc3f7'),
            // occupiedCells: [cellKey],
            rotation: rotation,
            // Store the scale multiplier as a Vector3
            scale: new THREE.Vector3(targetScale[0], targetScale[1], targetScale[2]),
            uuid: THREE.MathUtils.generateUUID(),
            // Store the actual scale for reference
            actualScale: mesh.scale.clone()
        };

        // Enable shadows
        mesh.traverse((child) =>
        {
            if (child.isMesh)
            {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        console.log("Detail mesh prepared - Original scale:", mesh.userData.originalScale);
        console.log("Detail mesh prepared - Scale multiplier:", mesh.userData.scale);
        console.log("Detail mesh prepared - Final scale:", mesh.scale);

        mesh.visible = detailLayerVisible;

        return mesh;
    }
    catch (error)
    {
        console.error('Failed to prepare detail mesh:', error);
        return null;
    }
}

// Calculates actual scale.
function calculateActualScale(detailMesh)
{
    if (!detailMesh.userData.isDetail) return detailMesh.scale;

    // For details: actual = original * MODEL_SCALE * userScale
    const userScale = detailMesh.userData.scale;
    const originalScale = detailMesh.userData.originalScale || new THREE.Vector3(1, 1, 1);

    return new THREE.Vector3(
        originalScale.x * MODEL_SCALE * userScale.x,
        originalScale.y * MODEL_SCALE * userScale.y,
        originalScale.z * MODEL_SCALE * userScale.z
    );
}

// Creates, configures, and places a detail mesh into the scene.
async function placeDetailMesh(detailData, position, rotation = 0, scale = null)
{
    console.log('📦 Placing detail:', detailData.name);
    console.log('   detailMeshes size before add:', detailMeshes.size);
    try
    {

        // Load the detail mesh
        const baseMesh = await loadMesh(detailData.mesh);
        const mesh = baseMesh.clone(true);

        // Store original scale
        mesh.userData.originalScale = baseMesh.userData.originalScale || new THREE.Vector3(1, 1, 1);

        // Apply MODEL_SCALE first
        mesh.scale.copy(mesh.userData.originalScale);
        mesh.scale.multiplyScalar(MODEL_SCALE);

        // Apply user scale if provided, otherwise use default
        const targetScale = scale || detailData.defaultScale || [1, 1, 1];
        mesh.scale.x *= targetScale[0];
        mesh.scale.y *= targetScale[1];
        mesh.scale.z *= targetScale[2];

        // Position the mesh at exact world coordinates
        const layerY = (currentLayer - 1) * LAYER_HEIGHT;
        const yOffset = detailData.yOffset || 0;

        mesh.position.copy(position);
        if (Math.abs(mesh.position.y - (layerY + yOffset)) < 0.001)
        {
            mesh.position.y = layerY + yOffset; // Snap to layer if very close
        }

        mesh.rotation.y = rotation;

        // Calculate grid cell for selection purposes ONLY (not for collision)
        const cell = worldToCell(position.x, position.z);
        const cellKey = `${cell.x},${cell.z},${currentLayer}`;

        // Setup user data
        mesh.userData = {
            isDetail: true,
            tileData:
            {
                ...detailData,
                size: detailData.size || [1, 1],
                originalId: detailData.originalId,
                packId: detailData.packId,
                pivotType: "free",
                visualOffset: detailData.visualOffset || [0, 0, 0],
                minScale: detailData.minScale || [0.1, 0.1, 0.1],
                maxScale: detailData.maxScale || [5, 5, 5],
                defaultScale: detailData.defaultScale || [1, 1, 1]
            },
            position:
            {
                cellX: cell.x,
                cellZ: cell.z,
                layer: currentLayer,
                worldX: position.x,
                worldZ: position.z
            },
            originalColor: new THREE.Color(detailData.color || '#4fc3f7'),
            rotation: rotation,
            scale: new THREE.Vector3(targetScale[0], targetScale[1], targetScale[2]),
            uuid: THREE.MathUtils.generateUUID()
        };

        // Enable shadows
        mesh.traverse((child) =>
        {
            if (child.isMesh)
            {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Add to scene and detailMeshes collection
        scene.add(mesh);
        console.log('   About to add mesh to detailMeshes, mesh UUID:', mesh.uuid);

        // After adding
        detailMeshes.add(mesh);


        // Animate placement
        animateTilePlacement(mesh);

        //showNotification(`Placed ${detailData.name}`);

        // Auto-select the placed detail
        selectTile(mesh);

        return mesh;
    }
    catch (error)
    {
        console.error('Failed to place detail:', error);
        showNotification('Failed to place detail', 'error');
        return null;
    }
}

// Resets detail scale.
function resetDetailScale()
{
    if (selectedPlacedTile && selectedPlacedTile.userData.isDetail)
    {
        const defaultScale = selectedPlacedTile.userData.tileData.defaultScale || [1, 1, 1];
        const oldScale = selectedPlacedTile.scale.clone();
        const newScale = new THREE.Vector3(defaultScale[0], defaultScale[1], defaultScale[2]);

        // Apply the default scale with MODEL_SCALE
        selectedPlacedTile.scale.set(
            newScale.x * MODEL_SCALE,
            newScale.y * MODEL_SCALE,
            newScale.z * MODEL_SCALE
        );

        // Update user data
        selectedPlacedTile.userData.scale.copy(newScale);

        showNotification(`Reset scale to default`, 'info');
    }
}

// Fetches a tile-pack JSON file from a URL and loads it into the editor.
async function loadTilePackFromURL(url)
{
    try
    {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const tilePack = await response.json();
        loadTilePack(tilePack); // Uses the existing loadTilePack function
        console.log(`Loaded pack: ${url}`);
    }
    catch (error)
    {
        console.warn(`Failed to load ${url}:`, error.message);
    }
}

// Fetches a tile-pack JSON file from a URL and loads it into the editor.
async function loadTilePackFromURL(url)
{
    try
    {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const tilePack = await response.json();
        loadTilePack(tilePack); // This function should already exist
        console.log(`Loaded pack: ${url}`);
    }
    catch (error)
    {
        console.warn(`Failed to load ${url}:`, error.message);
    }
}

// Loads tile pack.
function loadTilePack(tilePack)
{
    const packId = tilePack.id || THREE.MathUtils.generateUUID();
    if (tilePacks.has(packId)) return;

    const packTiles = [];
    tilePack.tiles.forEach(async (tile, index) =>
    {
        const uniqueId = tile.id ? `${packId}:${tile.id}` : `${packId}:tile_${index}`;
        const tileObj = {
            ...tile,
            packId,
            originalId: tile.id,
            id: uniqueId,
            ignoreOverhang: tile.ignoreOverhang || false
        };

        // If this tile has a mesh, pre-calculate its pivot offset
        if (tile.mesh)
        {
            try
            {
                const mesh = await loadMesh(tile.mesh);
                if (mesh.userData.pivotOffset)
                {
                    tileObj.pivotOffset = mesh.userData.pivotOffset;
                }
            }
            catch (error)
            {
                console.warn(`Could not calculate pivot for ${tile.mesh}:`, error);
            }
        }

        tiles.set(uniqueId, tileObj);
        packTiles.push(tileObj);
    });

    tilePacks.set(packId,
    {
        id: packId,
        name: tilePack.name || 'Unnamed',
        spriteSheet: tilePack.spriteSheet || '',
        iconCols: tilePack.iconCols || 4,
        iconSize: tilePack.iconSize || 64,
        tiles: packTiles
    });

    if (activePackId === null) activePackId = packId;
    updateTileGrid();
    showNotification(`Loaded pack: ${tilePack.name}`);
}

// Creates category tabs.
function createCategoryTabs()
{
    const container = document.getElementById('asset-browser');

    // Create category tabs container
    const categoryTabs = document.createElement('div');
    categoryTabs.id = 'categoryTabs';
    categoryTabs.className = 'category-tabs';

    // Insert before the tile grid
    const tileGrid = document.getElementById('tileGrid');
    container.insertBefore(categoryTabs, tileGrid);
}

// Updates category tabs.
function updateCategoryTabs()
{
    const categoryTabs = document.getElementById('categoryTabs');
    if (!categoryTabs) return;

    categoryTabs.innerHTML = '';

    // Get all unique categories from current pack
    const pack = tilePacks.get(activePackId);
    if (!pack) return;

    const categories = new Set();
    pack.tiles.forEach(tile =>
    {
        if (tile.category)
        {
            categories.add(tile.category);
        }
    });

    // Add "All" tab first
    const allTab = document.createElement('button');
    allTab.className = 'category-tab active';
    allTab.textContent = 'All';
    allTab.dataset.category = 'all';
    allTab.onclick = () => filterByCategory('all');
    categoryTabs.appendChild(allTab);

    // Add category tabs
    Array.from(categories).sort().forEach(category =>
    {
        const tab = document.createElement('button');
        tab.className = 'category-tab';
        tab.textContent = category;
        tab.dataset.category = category;
        tab.onclick = () => filterByCategory(category);
        categoryTabs.appendChild(tab);
    });
}

// Filters by category.
function filterByCategory(category)
{
    // Update active tab
    document.querySelectorAll('.category-tab').forEach(tab =>
    {
        tab.classList.toggle('active', tab.dataset.category === category);
    });

    // Filter tiles
    const tileItems = document.querySelectorAll('#tileGrid .tile-item');
    tileItems.forEach(item =>
    {
        const tileId = item.dataset.tileId;
        const tile = tiles.get(tileId);

        if (category === 'all' || (tile && tile.category === category))
        {
            item.style.display = 'block';
        }
        else
        {
            item.style.display = 'none';
        }
    });
}

// Creates pack tabs.
function createPackTabs()
{
    const container = document.getElementById('packTabs');
    container.innerHTML = '';
    tilePacks.forEach(pack =>
    {
        const tab = document.createElement('button');
        tab.className = 'pack-tab' + (pack.id === activePackId ? ' active' : '');
        tab.textContent = pack.name;
        tab.onclick = () =>
        {
            activePackId = pack.id;
            selectedPaletteTile = null;
            updateTileGrid();
            createPackTabs();
        };
        container.appendChild(tab);
    });
}

// Updates tile grid.
function updateTileGrid()
{
    const grid = document.getElementById('tileGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (currentPackType === 'tiles')
    {
        // Show tile packs grid
        const pack = tilePacks.get(activePackId);
        if (!pack) return;

        // Update category tabs when switching packs
        updateCategoryTabs();

        const indexToSpriteXY = (idx, cols, iconSize) =>
        {
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            return {
                x: col * iconSize,
                y: row * iconSize
            };
        };

        // Get tiles belonging to this pack
        const packTiles = Array.from(tiles.values()).filter(t => t.packId === activePackId);

        packTiles.forEach(tile =>
        {
            const div = document.createElement('div');
            div.className = 'tile-item';
            div.dataset.tileId = tile.id;
            div.title = tile.name;
            div.draggable = true;

            // Sprite preview
            let previewStyle = '';
            if (tile.spriteIndex != null && pack.spriteSheet)
            {
                const
                {
                    x,
                    y
                } = indexToSpriteXY(tile.spriteIndex, pack.iconCols, pack.iconSize);
                const sheetWH = `${pack.iconCols * pack.iconSize}px`;

                previewStyle =
                    `background-image:url('${pack.spriteSheet}');` +
                    `background-size:${sheetWH} ${sheetWH};` +
                    `background-position:-${x}px -${y}px;`;
            }
            else if (tile.color)
            {
                previewStyle = `background-color:${tile.color};`;
            }

            // Label & 3D indicator
            const meshIcon = tile.mesh ? '<span class="mesh-indicator">📦</span>' : '';

            div.innerHTML = `
                <div class="sprite-preview" style="${previewStyle}"></div>
                <div class="tile-label">${tile.name}${meshIcon}</div>
            `;

            // Selection
            div.onclick = () =>
            {
                selectedPaletteTile = tile;
                selectedDetail = null; // Clear detail selection
                grid.querySelectorAll('.tile-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');

                // Set interaction mode to place tiles
                setInteractionMode('place');
            };

            grid.appendChild(div);
        });

        if (window.feather) feather.replace();

        // Apply current category filter
        const activeCategory = document.querySelector('.category-tab.active')?.dataset.category || 'all';
        filterByCategory(activeCategory);
    }
    else
    {
        // Show detail packs grid
        const pack = detailPacks.get(activeDetailPackId);
        if (!pack)
        {
            console.warn('No detail pack found or no activeDetailPackId set');
            // Show empty state
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'prop-empty-state';
            emptyDiv.innerHTML = `
                <i data-feather="package" style="width: 48px; height: 48px; margin-bottom: 10px;"></i>
                <p>No detail packs loaded or selected</p>
            `;
            grid.appendChild(emptyDiv);
            if (window.feather) feather.replace();
            return;
        }

        // Update category tabs for details
        updateCategoryTabsForDetails();

        const indexToSpriteXY = (idx, cols, iconSize) =>
        {
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            return {
                x: col * iconSize,
                y: row * iconSize
            };
        };

        pack.details.forEach(detail =>
        {
            const div = document.createElement('div');
            div.className = 'tile-item detail-item';
            div.dataset.detailId = detail.id;
            div.title = detail.name;
            div.draggable = true;

            // Sprite preview
            let previewStyle = '';
            if (detail.spriteIndex != null && pack.spriteSheet)
            {
                const
                {
                    x,
                    y
                } = indexToSpriteXY(detail.spriteIndex, pack.iconCols, pack.iconSize);
                const sheetWH = `${pack.iconCols * pack.iconSize}px`;

                previewStyle =
                    `background-image:url('${pack.spriteSheet}');` +
                    `background-size:${sheetWH} ${sheetWH};` +
                    `background-position:-${x}px -${y}px;`;
            }
            else if (detail.color)
            {
                previewStyle = `background-color:${detail.color};`;
            }
            else
            {
                // Default styling for details without sprites
                previewStyle = `background: linear-gradient(135deg, #4fc3f7 0%, #2196f3 100%);`;
            }

            // Label & 3D indicator
            const meshIcon = detail.mesh ? '<span class="mesh-indicator">📦</span>' : '';

            div.innerHTML = `
                <div class="sprite-preview" style="${previewStyle}"></div>
                <div class="tile-label">${detail.name}${meshIcon}</div>
            `;

            // Selection
            div.onclick = () =>
            {
                selectedDetail = detail;
                selectedPaletteTile = null; // Clear tile selection
                grid.querySelectorAll('.tile-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');

                // Set interaction mode to place details
                setInteractionMode('place');
            };

            grid.appendChild(div);
        });

        if (window.feather) feather.replace();

        // Apply current category filter
        const activeCategory = document.querySelector('.category-tab.active')?.dataset.category || 'all';
        filterByCategoryForDetails(activeCategory);
    }
}

// Switches editor mode.
function switchEditorMode(mode)
{
    if (editorMode === mode) return;

    // Store current mode's interaction state
    if (editorMode === 'tiles')
    {
        previousTileMode = interactionMode;
    }
    else
    {
        previousDetailMode = interactionMode;
    }

    // Update editor mode
    editorMode = mode;

    // Clear any existing selections
    deselectTile(); // This will detach transform controls
    removePreviewGhost();
    removeDetailPreview();

    // Hide transform controls when switching to tile mode
    if (editorMode === 'tiles' && transformControls)
    {
        transformControls.visible = false;
        transformControls.detach();
    }

    // Update UI
    updateEditorModeUI();

    // Show notification
    showNotification(`Switched to ${mode === 'tiles' ? 'Tile' : 'Detail'} Mode`, 'info');
}

// Sets up drag and drop.
function setupDragAndDrop()
{
    const grid = document.getElementById('tileGrid');

    // Start Drag
    grid.addEventListener('dragstart', e =>
    {
        if (e.target.dataset.tileId)
        {
            draggedTile = tiles.get(e.target.dataset.tileId);
            e.dataTransfer.effectAllowed = 'copy';
            // Auto-switch to tile mode if dragging a tile
            if (editorMode !== 'tiles')
            {
                switchEditorMode('tiles');
            }
        }
        else if (e.target.dataset.detailId)
        {
            draggedTile = details.get(e.target.dataset.detailId);
            e.dataTransfer.effectAllowed = 'copy';
            // Auto-switch to detail mode if dragging a detail
            if (editorMode !== 'details')
            {
                switchEditorMode('details');
            }
        }
    });

    const vp = document.getElementById('viewport');
    const canvas = renderer.domElement;

    // Drag Over (Ghost Preview)
    vp.addEventListener('dragover', e =>
    {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';

        // Use canvas rect for accurate coordinates
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        // Calculate hit point
        raycaster.setFromCamera(mouse, camera);
        const layerY = (currentLayer - 1) * LAYER_HEIGHT;
        const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -layerY);
        const hitPoint = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(dragPlane, hitPoint);

        if (hit && draggedTile)
        {
            if (draggedTile.type === 'detail')
            {
                // Auto-switch to detail mode
                if (editorMode !== 'details')
                {
                    switchEditorMode('details');
                }
                updateDetailPreview(draggedTile, hitPoint);
            }
            else
            {
                // Auto-switch to tile mode
                if (editorMode !== 'tiles')
                {
                    switchEditorMode('tiles');
                }
                updateTilePreview(hitPoint, draggedTile);
            }
        }
        else
        {
            removePreviewGhost();
            removeDetailPreview();
        }
    });

    // Drop (Place & Select)
    vp.addEventListener('drop', async e =>
    {
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        // Calculate hit point
        raycaster.setFromCamera(mouse, camera);
        const layerY = (currentLayer - 1) * LAYER_HEIGHT;
        const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -layerY);
        const hitPoint = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(dragPlane, hitPoint);

        if (hit && draggedTile)
        {
            if (draggedTile.type === 'detail')
            {
                // Auto-switch to detail mode
                switchEditorMode('details');

                const gridSnap = e.altKey;

                if (gridSnap)
                {
                    // Snap to grid
                    const cell = worldToCell(hitPoint.x, hitPoint.z);
                    const worldPos = cellToWorld(cell.x + 0.5, cell.z + 0.5);
                    await placeDetailMesh(draggedTile, worldPos, 0, draggedTile.defaultScale);
                }
                else
                {
                    // Free placement at exact position
                    await placeDetailMesh(draggedTile, hitPoint, 0, draggedTile.defaultScale);
                }
            }
            else
            {
                // Auto-switch to tile mode
                switchEditorMode('tiles');

                const cell = worldToCell(hitPoint.x, hitPoint.z);
                const [placeW, placeH] = getEffectiveDimensions(draggedTile, placementRotation);
                const adjustX = Math.floor(cell.x - placeW / 2 + 0.5);
                const adjustZ = Math.floor(cell.z - placeH / 2 + 0.5);

                if (!checkCollision(adjustX, adjustZ, currentLayer, placeW, placeH))
                {
                    const mesh = await prepareTileMesh(adjustX, adjustZ, currentLayer, draggedTile, placementRotation);
                    if (mesh)
                    {
                        const cellKey = `${adjustX},${adjustZ},${currentLayer}`;
                        executeCommand(new PlaceTileCommand(mesh, cellKey));
                        selectTile(mesh);
                    }
                }
                else
                {
                    showNotification("Cannot place here!", "error");
                }
            }
        }

        draggedTile = null;
        removePreviewGhost();
        removeDetailPreview();
    });
}

// Removes detail preview.
function removeDetailPreview()
{
    if (detailPreview)
    {
        scene.remove(detailPreview);
        detailPreview.geometry.dispose();
        detailPreview.material.dispose();
        detailPreview = null;
    }
}

// Displays a transient notification message in the UI.
function showNotification(msg, type = 'success')
{
    const notif = document.createElement('div');
    notif.innerText = msg;
    notif.style.position = 'fixed';
    notif.style.top = '10px';
    notif.style.left = '50%';
    notif.style.transform = 'translateX(-50%)';
    notif.style.padding = '10px 20px';
    notif.style.borderRadius = '5px';
    notif.style.background = type === 'error' ? '#ef5350' : '#66bb6a';
    notif.style.color = 'white';
    notif.style.zIndex = '2000';
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

// Removes all placed tiles and details from the scene.
function clearGrid()
{
    if (!confirm('Are you sure you want to clear all tiles and details?')) return;

    const processed = new Set();
    const meshesToRemove = [];

    // Collect grid tiles (non-detail)
    placedTiles.forEach(tile =>
    {
        if (tile.userData?.uuid && !processed.has(tile.userData.uuid) && !tile.userData.isDetail)
        {
            processed.add(tile.userData.uuid);
            meshesToRemove.push(tile);
        }
    });

    // Collect detail meshes
    detailMeshes.forEach(mesh =>
    {
        if (mesh.userData?.uuid && !processed.has(mesh.userData.uuid))
        {
            processed.add(mesh.userData.uuid);
            meshesToRemove.push(mesh);
        }
    });

    // Remove all meshes
    meshesToRemove.forEach(mesh =>
    {
        disposeMesh(mesh);
        scene.remove(mesh);
    });

    // Clear all collections
    placedTiles.clear();
    detailMeshes.clear();
    selectedPlacedTile = null;

    if (transformControls)
    {
        transformControls.detach();
        transformControls.visible = false;
    }

    showNotification('Grid cleared');
}

// Saves layout.
function saveLayout()
{
    const layout = buildLayoutData();

    const blob = new Blob([JSON.stringify(layout, null, 2)],
    {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tile-layout.json';
    a.click();
    URL.revokeObjectURL(url);

    showNotification(`Saved ${layout.tiles.length} tiles and ${layout.details.length} details`);
}

// Handles layout load.
function handleLayoutLoad(e)
{
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) =>
    {
        try
        {
            const layoutData = JSON.parse(evt.target.result);
            loadLayout(layoutData); // Call the actual loading logic
        }
        catch (err)
        {
            console.error("JSON Parse Error:", err);
            showNotification("Failed to parse layout file", "error");
        }
        // Reset input so you can load the same file again if needed
        e.target.value = '';
    };
    reader.readAsText(file);
}

// Loads a saved layout into the scene and restores editor state.
async function loadLayout(layoutData, skipConfirm = false)
{
    if (!layoutData.tiles && !layoutData.details)
    {
        showNotification("Invalid layout file format", "error");
        return;
    }

    if (!skipConfirm && !confirm("Loading a layout will clear the current grid. Continue?")) return;
    clearGrid();

    showNotification("Loading layout...", "info");
    document.getElementById('loading').style.display = 'flex';

    // Restore Layers
    if (layoutData.layers && Array.isArray(layoutData.layers) && layoutData.layers.length > 0)
    {
        layerMap.clear();
        maxLayer = 0;
        layoutData.layers.sort((a, b) => a.num - b.num).forEach(l =>
        {
            layerMap.set(l.num,
            {
                name: l.name,
                locked: l.locked,
                visible: l.visible
            });
            maxLayer = Math.max(maxLayer, l.num);
        });
        currentLayer = maxLayer;
        updateLayerPanel();
        updateModeIndicator();
    }

    detailLayerVisible = layoutData.detailLayerVisible !== false;

    let loadedTileCount = 0;
    let loadedDetailCount = 0;
    let missingCount = 0;

    // Load TILES (grid-based)
    if (layoutData.tiles)
    {
        for (const savedTile of layoutData.tiles)
        {
            const normalizedPackId = savedTile.packId || savedTile.pack;
            const normalizedTileId = savedTile.tileId || savedTile.id;
            const tilePosition = savedTile.position ||
            {
                x: savedTile.x,
                z: savedTile.z,
                layer: savedTile.layer
            };

            const internalId = `${normalizedPackId}:${normalizedTileId}`;
            const tileDef = tiles.get(internalId);

            if (tileDef)
            {
                try
                {
                    const normalizedRotation = savedTile.rotation ?? savedTile.rot;
                    const rotation = getSnappedTileRotationRadians(normalizedRotation);

                    const mesh = await prepareTileMesh(tilePosition.x, tilePosition.z, tilePosition.layer, tileDef, rotation);
                    if (mesh)
                    {
                        mesh.rotation.y = rotation;
                        mesh.userData.rotation = rotation;
                        scene.add(mesh);

                        const key = `${tilePosition.x},${tilePosition.z},${tilePosition.layer}`;
                        placedTiles.set(key, mesh);

                        if (mesh.userData.occupiedCells)
                        {
                            mesh.userData.occupiedCells.forEach(k => placedTiles.set(k, mesh));
                        }

                        loadedTileCount++;
                    }
                }
                catch (error)
                {
                    console.error(`Failed to place tile ${internalId}:`, error);
                }
            }
            else
            {
                console.warn(`Tile definition not found: ${internalId}`);
                missingCount++;
            }
        }
    }

    // Load DETAILS (free placement) - FIXED scale loading
    if (layoutData.details)
    {
        for (const savedDetail of layoutData.details)
        {
            const internalId = `${savedDetail.packId}:${savedDetail.detailId}`;
            const detailDef = details.get(internalId);

            if (detailDef)
            {
                try
                {
                    // CRITICAL FIX: Use saved scale multiplier or default
                    const scaleMultiplier = savedDetail.scale || detailDef.defaultScale || [1, 1, 1];

                    // Create position vector from saved data
                    const position = new THREE.Vector3(
                        savedDetail.position.x,
                        savedDetail.position.y,
                        savedDetail.position.z
                    );

                    const detailRotation = normalizeDetailRotationEuler(savedDetail.rotation, savedDetail.rotationY || 0);

                    // Create detail mesh with the scale multiplier
                    const mesh = await prepareDetailMesh(
                        position.x,
                        position.z,
                        savedDetail.layer || currentLayer,
                        detailDef,
                        detailRotation.y,
                        scaleMultiplier // Pass the multiplier, not the actual scale
                    );

                    if (mesh)
                    {
                        // Set exact Y position from saved data
                        mesh.position.y = savedDetail.position.y;
                        mesh.rotation.copy(detailRotation);
                        mesh.userData.rotation = detailRotation.clone();

                        // CRITICAL FIX: Ensure scale multiplier is stored correctly
                        mesh.userData.scale = new THREE.Vector3(
                            scaleMultiplier[0],
                            scaleMultiplier[1],
                            scaleMultiplier[2]
                        );

                        scene.add(mesh);
                        detailMeshes.add(mesh);

                        // Details are tracked in detailMeshes and selected via dedicated
                        // detail raycasts. Do not register them in placedTiles because
                        // that map is the collision/occupancy source for grid tiles.
                        // If we add details here, a detail on the same cell can override
                        // a tile entry and make the tile appear missing when reloading.
                        mesh.userData.occupiedCells = [];

                        loadedDetailCount++;
                    }
                }
                catch (error)
                {
                    console.error(`Failed to place detail ${internalId}:`, error);
                }
            }
            else
            {
                console.warn(`Detail definition not found: ${internalId}`);
                missingCount++;
            }
        }
    }

    toggleDetailLayerVisibility(detailLayerVisible);
    updateLayerPanel();

    document.getElementById('loading').style.display = 'none';

    let message = `Loaded ${loadedTileCount} tiles`;
    if (loadedDetailCount > 0)
    {
        message += ` and ${loadedDetailCount} details`;
    }

    if (missingCount > 0)
    {
        message += ` (${missingCount} missing)`;
        showNotification(message, "warning");
    }
    else
    {
        showNotification(message + ".");
    }
}

class MoveTileCommand extends Command
{
    constructor(tileMesh, oldPos, newPos)
    {
        super();
        this.tileMesh = tileMesh;
        this.oldPos = {
            ...oldPos
        }; // Clone objects
        this.newPos = {
            ...newPos
        };
    }

    execute()
    {
        this._move(this.newPos);
    }

    undo()
    {
        this._move(this.oldPos);
    }

    _move(targetPos)
    {
        // ✅ FIX: Use effective dimensions based on current rotation
        const [w, h] = getEffectiveDimensions(
            this.tileMesh.userData.tileData,
            this.tileMesh.userData.rotation
        );

        // 1. Remove old map entries
        if (this.tileMesh.userData.occupiedCells)
        {
            this.tileMesh.userData.occupiedCells.forEach(key => placedTiles.delete(key));
        }

        // 2. Update position data
        this.tileMesh.userData.position.cellX = targetPos.cellX;
        this.tileMesh.userData.position.cellZ = targetPos.cellZ;
        this.tileMesh.userData.position.layer = targetPos.layer;

        // 3. Recalculate world position using effective dimensions
        const worldPos = cellToWorld(targetPos.cellX + w / 2 - 0.5, targetPos.cellZ + h / 2 - 0.5);

        // --- FIXED: Use the same positioning logic as prepareTileMesh ---
        const tileData = this.tileMesh.userData.tileData;
        const pivotType = tileData.pivotType || "footprint_center";
        const visualOffset = tileData.visualOffset || [0, 0, 0];
        const layerY = (targetPos.layer - 1) * LAYER_HEIGHT;
        const manualOffset = tileData.yOffset || 0;
        const finalY = layerY + manualOffset;

        let targetX, targetY, targetZ;

        switch (pivotType)
        {
            case "visual_center":
                // Get the original box center from userData if stored, or calculate
                const box = new THREE.Box3().setFromObject(this.tileMesh);
                const center = box.getCenter(new THREE.Vector3());
                targetX = worldPos.x - center.x;
                targetY = finalY - box.min.y;
                targetZ = worldPos.z - center.z;
                break;

            case "footprint_center":
                targetX = worldPos.x;
                targetY = finalY;
                targetZ = worldPos.z;
                break;

            case "bottom_left":
                const footprintMin = cellToWorld(targetPos.cellX, targetPos.cellZ);
                targetX = footprintMin.x + 0.5;
                targetY = finalY;
                targetZ = footprintMin.z + 0.5;
                break;

            case "bottom_center":
                targetX = worldPos.x;
                targetY = finalY;
                targetZ = cellToWorld(targetPos.cellX, targetPos.cellZ).z + 0.5;
                break;

            case "custom":
                targetX = worldPos.x;
                targetY = finalY;
                targetZ = worldPos.z;
                break;

            default:
                targetX = worldPos.x;
                targetY = finalY;
                targetZ = worldPos.z;
        }

        // Apply visual offset
        targetX += visualOffset[0];
        targetY += visualOffset[1];
        targetZ += visualOffset[2];

        this.tileMesh.position.set(targetX, targetY, targetZ);

        // 4. Update occupied cells map with new footprint
        this.tileMesh.userData.occupiedCells = [];
        for (let dx = 0; dx < w; dx++)
        {
            for (let dz = 0; dz < h; dz++)
            {
                const key = `${targetPos.cellX + dx},${targetPos.cellZ + dz},${targetPos.layer}`;
                placedTiles.set(key, this.tileMesh);
                this.tileMesh.userData.occupiedCells.push(key);
            }
        }
    }
}
// Add these helper functions near the other utility functions (around line 140)
// Applies model scale.
function applyModelScale(mesh)
{
    if (MODEL_SCALE !== 1.0)
    {
        mesh.scale.multiplyScalar(MODEL_SCALE);
    }
    return mesh;
}

// Removes model scale.
function removeModelScale(mesh)
{
    if (MODEL_SCALE !== 1.0)
    {
        mesh.scale.multiplyScalar(MODEL_SCALE_INVERSE);
    }
    return mesh;
}

// Scales a vector from editor-space units into model-space units.
function scaleVectorForModel(vector)
{
    return vector.multiplyScalar(MODEL_SCALE);
}

// Converts a vector from model-space units back to export/editor units.
function unscaleVectorForExport(vector)
{
    return vector.multiplyScalar(MODEL_SCALE_INVERSE);
}

// Returns bounding box center.
function getBoundingBoxCenter(boundsMin, boundsMax)
{
    return {
        x: (boundsMin.x + boundsMax.x) * 0.5,
        y: (boundsMin.y + boundsMax.y) * 0.5,
        z: (boundsMin.z + boundsMax.z) * 0.5
    };
}

// Loads a 3D model and normalizes it for use in the editor.
function loadMesh(url)
{
    // 1. Check Cache
    if (meshCache.has(url))
    {
        return meshCache.get(url);
    }

    // 2. Create a Promise to load the file
    const loadingPromise = new Promise((resolve, reject) =>
    {
        document.getElementById('loading').style.display = 'flex';

        const extension = url.split('.').pop().toLowerCase();
        let loader;

        if (extension === 'glb' || extension === 'gltf')
        {
            loader = new THREE.GLTFLoader();
        }
        else if (extension === 'obj')
        {
            loader = new THREE.OBJLoader();
        }
        else
        {
            reject(new Error(`Unknown file extension: ${extension}`));
            return;
        }

        loader.load(
            url,
            (result) =>
            {
                const mesh = result.scene || result;

                // CRITICAL: Store the ORIGINAL scale BEFORE any modifications
                mesh.userData.originalScale = mesh.scale.clone();

                // Store original rotation
                mesh.userData.originalRotation = mesh.rotation.y;

                // Apply MODEL_SCALE
                applyModelScale(mesh);

                // Calculate pivot offset
                const pivotOffset = calculatePivotOffset(mesh);
                mesh.userData.pivotOffset = pivotOffset;

                // Cache the offset
                if (!window.meshPivotCache) window.meshPivotCache = {};
                window.meshPivotCache[url] = pivotOffset;

                mesh.traverse((child) =>
                {
                    if (child.isMesh)
                    {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                document.getElementById('loading').style.display = 'none';
                resolve(mesh);
            },
            undefined,
            (error) =>
            {
                console.error(`Failed to load ${url}:`, error);
                document.getElementById('loading').style.display = 'none';
                reject(error);
            }
        );
    });

    meshCache.set(url, loadingPromise);
    return loadingPromise;
}

/**
 * Export the current map as a GLB (binary GLTF) 3D model
 * Includes visible tiles only, preserves transforms and materials
 */


// Exports the current scene as a combined mesh file.
async function exportAsMesh()
{
    if (placedTiles.size === 0)
    {
        showNotification("No tiles to export!", "warning");
        return;
    }

    document.getElementById('loading').style.display = 'flex';
    document.querySelector('#loading div:last-child').textContent = 'Exporting OBJ...';

    try
    {
        const visibleLayers = new Set(
            Array.from(layerMap.entries())
            .filter(([_, data]) => data.visible !== false)
            .map(([num]) => num)
        );

        const processedMeshes = new Set();
        let objVertices = [];
        let objNormals = [];
        let objUVs = [];
        let objFaces = [];
        let currentVertexIndex = 1;
        let currentNormalIndex = 1;
        let currentUVIndex = 1;

        // Material library
        const materials = new Map();
        let materialIndex = 0;


        for (const [key, rootMesh] of placedTiles)
        {
            if (processedMeshes.has(rootMesh.uuid)) continue;
            if (rootMesh.userData.isDetail ? !detailLayerVisible : !visibleLayers.has(rootMesh.userData.position.layer)) continue;

            processedMeshes.add(rootMesh.uuid);

            // Traverse children to find meshes with geometry
            const meshes = [];
            rootMesh.traverse((child) =>
            {
                if (child.isMesh && child.geometry && child.geometry.attributes.position)
                {
                    meshes.push(child);
                }
            });

            if (meshes.length === 0)
            {
                console.warn(`No geometry found for tile: ${key}`);
                continue;
            }

            // Create material
            const tileId = rootMesh.userData.tileData.id;
            if (!materials.has(tileId))
            {
                materialIndex++;
                const color = rootMesh.userData.tileData.color || '#888888';
                materials.set(tileId,
                {
                    name: `material_${materialIndex}`,
                    color: color
                });
            }
            const matName = materials.get(tileId).name;

            // Process each mesh part
            meshes.forEach(mesh =>
            {
                const geometry = mesh.geometry;
                const positions = geometry.attributes.position.array;
                const normals = geometry.attributes.normal?.array;
                const uvs = geometry.attributes.uv?.array;
                const index = geometry.index?.array;

                // Apply world transform
                mesh.updateMatrixWorld();
                const matrixWorld = mesh.matrixWorld;
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);

                // Transform vertices
                for (let i = 0; i < positions.length; i += 3)
                {
                    const vertex = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
                    vertex.applyMatrix4(matrixWorld);
                    vertex.multiplyScalar(MODEL_SCALE_INVERSE); // Scale back up for export
                    objVertices.push(`v ${vertex.x.toFixed(6)} ${vertex.y.toFixed(6)} ${vertex.z.toFixed(6)}`);
                }

                // Transform normals
                if (normals)
                {
                    for (let i = 0; i < normals.length; i += 3)
                    {
                        const normal = new THREE.Vector3(normals[i], normals[i + 1], normals[i + 2]);
                        normal.applyMatrix3(normalMatrix).normalize();
                        objNormals.push(`vn ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}`);
                    }
                }
                else
                {
                    // Generate flat normals for missing data
                    for (let i = 0; i < positions.length; i += 9)
                    {
                        const v1 = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(matrixWorld);
                        const v2 = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]).applyMatrix4(matrixWorld);
                        const v3 = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]).applyMatrix4(matrixWorld);

                        const normal = new THREE.Vector3().crossVectors(
                            new THREE.Vector3().subVectors(v2, v1),
                            new THREE.Vector3().subVectors(v3, v1)
                        ).normalize();

                        // Add same normal for all 3 vertices of this triangle
                        for (let j = 0; j < 3; j++)
                        {
                            objNormals.push(`vn ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}`);
                        }
                    }
                }

                // Copy UVs
                if (uvs)
                {
                    for (let i = 0; i < uvs.length; i += 2)
                    {
                        objUVs.push(`vt ${uvs[i].toFixed(6)} ${uvs[i+1].toFixed(6)}`);
                    }
                }
                else
                {
                    // Add dummy UVs if missing
                    const vertexCount = positions.length / 3;
                    for (let i = 0; i < vertexCount; i++)
                    {
                        objUVs.push(`vt 0.000000 0.000000`);
                    }
                }

                // Generate faces
                objFaces.push(`g ${mesh.uuid}`);
                objFaces.push(`usemtl ${matName}`);

                const vertexCount = positions.length / 3;
                if (index)
                {
                    // Indexed geometry - ensures we don't exceed vertex count
                    for (let i = 0; i < index.length; i += 3)
                    {
                        const idx0 = index[i];
                        const idx1 = index[i + 1];
                        const idx2 = index[i + 2];

                        // Safety check
                        if (idx0 >= vertexCount || idx1 >= vertexCount || idx2 >= vertexCount)
                        {
                            console.warn('Invalid index found, skipping face');
                            continue;
                        }

                        const v1 = currentVertexIndex + idx0;
                        const v2 = currentVertexIndex + idx1;
                        const v3 = currentVertexIndex + idx2;

                        let face = `f ${v1}`;
                        if (uvs) face += `/${currentUVIndex + idx0}`;
                        if (normals) face += `/${currentNormalIndex + idx0}`;
                        face += ` ${v2}`;
                        if (uvs) face += `/${currentUVIndex + idx1}`;
                        if (normals) face += `/${currentNormalIndex + idx1}`;
                        face += ` ${v3}`;
                        if (uvs) face += `/${currentUVIndex + idx2}`;
                        if (normals) face += `/${currentNormalIndex + idx2}`;

                        objFaces.push(face);
                    }
                }
                else
                {
                    // Non-indexed geometry
                    for (let i = 0; i < vertexCount; i += 3)
                    {
                        const v1 = currentVertexIndex + i;
                        const v2 = currentVertexIndex + i + 1;
                        const v3 = currentVertexIndex + i + 2;

                        // Safety check
                        if (v2 >= (currentVertexIndex + vertexCount) || v3 >= (currentVertexIndex + vertexCount)) break;

                        let face = `f ${v1}`;
                        if (uvs) face += `/${currentUVIndex + i}`;
                        if (normals) face += `/${currentNormalIndex + i}`;
                        face += ` ${v2}`;
                        if (uvs) face += `/${currentUVIndex + i + 1}`;
                        if (normals) face += `/${currentNormalIndex + i + 1}`;
                        face += ` ${v3}`;
                        if (uvs) face += `/${currentUVIndex + i + 2}`;
                        if (normals) face += `/${currentNormalIndex + i + 2}`;

                        objFaces.push(face);
                    }
                }

                // Update indices for next mesh
                currentVertexIndex += vertexCount;
                if (normals) currentNormalIndex += vertexCount;
                if (uvs) currentUVIndex += vertexCount;
            });
        }

        // Build OBJ content (same as before)
        let objContent = `# Tile Map Export\n`;
        objContent += `# ${processedMeshes.size} tiles\n\n`;
        objContent += `mtllib tilemap.mtl\n\n`;
        objContent += objVertices.join('\n') + '\n\n';

        if (objNormals.length > 0)
        {
            objContent += objNormals.join('\n') + '\n\n';
        }

        if (objUVs.length > 0)
        {
            objContent += objUVs.join('\n') + '\n\n';
        }

        objContent += objFaces.join('\n');

        // Build MTL content
        let mtlContent = `# Tile Map Materials\n\n`;
        for (const [tileId, mat] of materials)
        {
            const color = new THREE.Color(mat.color);
            mtlContent += `newmtl ${mat.name}\n`;
            mtlContent += `Kd ${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)}\n`;
            mtlContent += `Ka ${(color.r * 0.2).toFixed(3)} ${(color.g * 0.2).toFixed(3)} ${(color.b * 0.2).toFixed(3)}\n`;
            mtlContent += `Ks 0.000 0.000 0.000\n`;
            mtlContent += `Ns 10.0\n\n`;
        }

        // Download files
        downloadFile(objContent, `tilemap_${Date.now()}.obj`, 'text/plain');
        downloadFile(mtlContent, `tilemap_${Date.now()}.mtl`, 'text/plain');

        showNotification(`Exported ${processedMeshes.size} tiles as OBJ+MTL!`, 'success');
    }
    catch (error)
    {
        console.error('Export error:', error);
        showNotification(`Export failed: ${error.message}`, 'error');
    }
    finally
    {
        document.getElementById('loading').style.display = 'none';
    }
}

// Downloads file.
function downloadFile(content, filename, mimeType)
{
    const blob = new Blob([content],
    {
        type: mimeType
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

// Disposes mesh.
function disposeMesh(mesh)
{
    mesh.traverse((child) =>
    {
        if (child.geometry)
        {
            child.geometry.dispose();
        }
        if (child.material)
        {
            if (Array.isArray(child.material))
            {
                child.material.forEach(material => material.dispose());
            }
            else
            {
                child.material.dispose();
            }
        }
    });
}

// Opens the settings window.
function openSettings()
{
    document.getElementById('settingsWindow').style.display = 'flex';
    loadSettingsToUI();
}

// Closes the settings window.
function closeSettings()
{
    document.getElementById('settingsWindow').style.display = 'none';
}

// Loads current settings values into the settings panel controls.
function loadSettingsToUI()
{
    // Tone Mapping
    document.getElementById('toneMapper').value = settings.toneMapping;
    document.getElementById('toneExposure').value = settings.exposure;
    document.getElementById('exposureValue').textContent = settings.exposure.toFixed(1);

    // Shadows
    document.getElementById('enableShadows').checked = settings.shadows;
    document.getElementById('shadowQuality').value = settings.shadowQuality;

    // Fog
    document.getElementById('enableFog').checked = settings.fog;

    // Lighting
    document.getElementById('ambientIntensity').value = settings.ambientIntensity;
    document.getElementById('ambientValue').textContent = settings.ambientIntensity.toFixed(1);
    document.getElementById('directionalIntensity').value = settings.directionalIntensity;
    document.getElementById('directionalValue').textContent = settings.directionalIntensity.toFixed(1);
    document.getElementById('lightColor').value = '#' + settings.lightColor.toString(16).padStart(6, '0');
    document.getElementById('enableAO').checked = settings.ambientOcclusion;
    document.getElementById('aoRadius').value = settings.aoRadius;
    document.getElementById('aoRadiusValue').textContent = settings.aoRadius;
    document.getElementById('aoMinDistance').value = settings.aoMinDistance;
    document.getElementById('aoMinDistanceValue').textContent = settings.aoMinDistance.toFixed(3);
    document.getElementById('aoMaxDistance').value = settings.aoMaxDistance;
    document.getElementById('aoMaxDistanceValue').textContent = settings.aoMaxDistance.toFixed(2);

    // Grid & View
    document.getElementById('gridSize').value = settings.gridSize;
    document.getElementById('gridSizeValue').textContent = settings.gridSize;
    document.getElementById('gridColor1').value = '#' + settings.gridColor1.toString(16).padStart(6, '0');
    document.getElementById('gridColor2').value = '#' + settings.gridColor2.toString(16).padStart(6, '0');
    document.getElementById('backgroundColor').value = '#' + settings.backgroundColor.toString(16).padStart(6, '0');
    document.getElementById('fov').value = settings.fov;
    document.getElementById('fovValue').textContent = settings.fov + '°';

    // Editor

    document.getElementById('ghostOpacity').value = settings.ghostOpacity;
    document.getElementById('ghostValue').textContent = settings.ghostOpacity.toFixed(2);
    document.getElementById('historySize').value = settings.historySize;
    document.getElementById('historyValue').textContent = settings.historySize;
    document.getElementById('autosaveInterval').value = settings.autosaveInterval;
    document.getElementById('autosaveValue').textContent = settings.autosaveInterval + 's';
}

// Applies current settings to renderer, lighting, and scene behavior.
function applySettings()
{
    // Tone Mapping
    renderer.toneMapping = parseInt(settings.toneMapping);
    renderer.toneMappingExposure = settings.exposure;

    // Update ALL materials in the scene to use the new tone mapping
    scene.traverse((object) =>
    {
        if (object.isMesh && object.material)
        {
            // Handle single material
            if (!Array.isArray(object.material))
            {
                object.material.toneMapped = true;
                object.material.needsUpdate = true;
            }
            // Handle array of materials (multi-material objects)
            else
            {
                object.material.forEach(mat =>
                {
                    mat.toneMapped = true;
                    mat.needsUpdate = true;
                });
            }
        }
    });

    // Shadows
    renderer.shadowMap.enabled = settings.shadows;
    if (directionalLight)
    {
        directionalLight.shadow.mapSize.width = parseInt(settings.shadowQuality);
        directionalLight.shadow.mapSize.height = parseInt(settings.shadowQuality);
        directionalLight.shadow.map?.dispose(); // Force recreation
        directionalLight.shadow.needsUpdate = true;
    }

    // Fog
    if (settings.fog && !fog)
    {
        fog = new THREE.Fog(settings.backgroundColor, 20, 100);
        scene.fog = fog;
    }
    else if (!settings.fog && fog)
    {
        scene.fog = null;
        fog = null;
    }
    else if (fog)
    {
        fog.color.setHex(settings.backgroundColor);
    }

    // Lighting
    if (ambientLight) ambientLight.intensity = settings.ambientIntensity;
    if (directionalLight)
    {
        directionalLight.intensity = settings.directionalIntensity;
        directionalLight.color.setHex(settings.lightColor);
    }

    // Ambient Occlusion
    if (settings.ambientOcclusion && !ssaoPass)
    {
        showNotification("Ambient Occlusion unavailable: SSAO pass failed to initialize", "warning");
        settings.ambientOcclusion = false;
        const aoToggle = document.getElementById('enableAO');
        if (aoToggle) aoToggle.checked = false;
    }

    if (ssaoPass)
    {
        applyAmbientOcclusionSettings();
    }

    // Grid & View
    if (gridHelper)
    {
        scene.remove(gridHelper);
        gridHelper.geometry.dispose();
        gridHelper.material.dispose();
        createGrid(gridHelper.position.y); // Pass current grid height
    }

    scene.background.setHex(settings.backgroundColor);
    if (perspectiveCamera)
    {
        perspectiveCamera.fov = settings.fov;
        perspectiveCamera.updateProjectionMatrix();
    }

    if (previewGhost)
    {
        updatePreviewGhostAppearance();
    }

    // Editor settings (some are applied elsewhere)
    MAX_HISTORY = settings.historySize;

    // Update autosave interval
    if (autoSaveInterval)
    {
        clearInterval(autoSaveInterval);
    }
    autoSaveInterval = setInterval(autoSave, settings.autosaveInterval * 1000);

    // Save settings to localStorage
    saveSettingsToStorage();
    updateCompassPosition();
    showNotification("Settings applied");
    closeSettings();
}

// Saves current editor settings to local storage.
function saveSettingsToStorage()
{
    try
    {
        localStorage.setItem('tilemap_settings', JSON.stringify(settings));
    }
    catch (e)
    {
        console.warn("Could not save settings:", e);
    }
}

/**
 * Export for Second Life with all offsets properly calculated
 */
// Exports the current scene layout to the text format expected by Second Life.
function exportForSecondLife()
{
    if (placedTiles.size === 0 && detailMeshes.size === 0)
    {
        showNotification("No tiles/details to export!", "warning");
        return;
    }

    const SL_CONFIG = {
        REGION_OFFSET_X: 128,
        REGION_OFFSET_Y: 128,
        BASE_Z: 0,
        SCALE_FACTOR: 4.0,
        ROTATION_OFFSET: 0
    };

    const visibleLayers = new Set(
        Array.from(layerMap.entries())
        .filter(([_, d]) => d.visible !== false)
        .map(([n]) => n)
    );

    const tileHeader = 'name,x,y,z,rotation';
    const detailHeader = 'name,positionX,positionY,positionZ,scaleX,scaleY,scaleZ,rotationX,rotationY,rotationZ,rotationW';
    const tileLines = [];
    const detailLines = [];
    const processedTiles = new Set();

    const formatTileLine = (name, position, rotationInt) =>
    {
        return `${name},` +
            `${position.x.toFixed(3)},` +
            `${position.y.toFixed(3)},` +
            `${position.z.toFixed(3)},` +
            `${rotationInt}`;
    };

    const formatDetailLine = (name, position, scale, quaternion) =>
    {
        return `${name},` +
            `${position.x.toFixed(3)},` +
            `${position.y.toFixed(3)},` +
            `${position.z.toFixed(3)},` +
            `${scale.x.toFixed(4)},` +
            `${scale.y.toFixed(4)},` +
            `${scale.z.toFixed(4)},` +
            `${quaternion.x.toFixed(6)},` +
            `${quaternion.y.toFixed(6)},` +
            `${quaternion.z.toFixed(6)},` +
            `${quaternion.w.toFixed(6)}`;
    };

    // Export grid tiles first in SL legacy format: name,x,y,z,rotation(0-3).
    placedTiles.forEach(mesh =>
    {
        if (!mesh || !mesh.userData || mesh.userData.isDetail) return;
        if (processedTiles.has(mesh.uuid)) return;
        processedTiles.add(mesh.uuid);

        const tileData = mesh.userData.tileData;
        const pos = mesh.userData.position;
        if (!tileData || !pos || !visibleLayers.has(pos.layer || 1)) return;

        const rot = mesh.rotation.y || 0;
        const [w, h] = getEffectiveDimensions(tileData, rot);

        const wp = cellToWorld(
            pos.cellX + w / 2 - 0.5,
            pos.cellZ + h / 2 - 0.5
        );

        const worldPos = new THREE.Vector3(wp.x, 0, wp.z);

        const pivot = tileData.pivotOffset || mesh.userData.pivotOffset;
        const pivotVec = new THREE.Vector3(
            pivot?.x || 0,
            pivot?.y || 0,
            pivot?.z || 0
        );
        pivotVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);

        const visualOffset = tileData.visualOffset || [0, 0, 0];
        worldPos.x += visualOffset[0];
        worldPos.z += visualOffset[2];
        worldPos.add(pivotVec);

        const layerY = (pos.layer - 1) * LAYER_HEIGHT;
        const yOffset = tileData.yOffset || 0;
        const finalY = layerY + yOffset + (visualOffset[1] || 0);

        const slPosition = new THREE.Vector3(
            (worldPos.x + GRID_SIZE / 2) * SL_CONFIG.SCALE_FACTOR,
            (-worldPos.z + GRID_SIZE / 2) * SL_CONFIG.SCALE_FACTOR,
            finalY * SL_CONFIG.SCALE_FACTOR
        );

        let rotationInt = Math.round((rot % (Math.PI * 2)) / (Math.PI / 2));
        rotationInt = ((rotationInt % 4) + 4) % 4;

        const name = String(
            tileData.originalId ||
            tileData.id ||
            tileData.name ||
            'tile'
        );

        tileLines.push(formatTileLine(name, slPosition, rotationInt));
    });

    // Export details last.
    detailMeshes.forEach(mesh =>
    {
        if (!mesh || !mesh.userData || !mesh.userData.isDetail) return;

        const detailData = mesh.userData.tileData;
        const pos = mesh.userData.position;
        if (!detailData || !pos) return;
        if (!detailLayerVisible || !visibleLayers.has(pos.layer || 1)) return;

        const slPosition = new THREE.Vector3(
            (mesh.position.x + GRID_SIZE / 2) * SL_CONFIG.SCALE_FACTOR,
            (-mesh.position.z + GRID_SIZE / 2) * SL_CONFIG.SCALE_FACTOR,
            mesh.position.y * SL_CONFIG.SCALE_FACTOR
        );

        const detailScale = mesh.userData.scale ? mesh.userData.scale.clone() : new THREE.Vector3(1, 1, 1);
        const rotQuat = mesh.quaternion.clone();

        const name = String(
            detailData.originalId ||
            detailData.id ||
            detailData.name ||
            'detail'
        );

        detailLines.push(formatDetailLine(name, slPosition, detailScale, rotQuat));
    });

    const lines = [
        '# --- Tiles ---',
        tileHeader,
        ...tileLines,
        '',
        '# ------------------------------',
        '# --- Details (after tiles) ---',
        detailHeader,
        ...detailLines
    ];

    const blob = new Blob([lines.join('\n')],
    {
        type: 'text/plain'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'secondlife_export.txt';
    a.click();
    URL.revokeObjectURL(url);

    showNotification(`Exported ${tileLines.length} tiles and ${detailLines.length} details`);
}

// Loads persisted editor settings from local storage.
function loadSettingsFromStorage()
{
    try
    {
        const saved = localStorage.getItem('tilemap_settings');
        if (saved)
        {
            const loaded = JSON.parse(saved);
            // Merge loaded settings with defaults
            Object.assign(settings, loaded);
        }
    }
    catch (e)
    {
        console.warn("Could not load settings:", e);
    }
}

// Resets settings to their default values and reapplies them.
function resetSettingsToDefaults()
{
    if (!confirm("Reset all settings to defaults?")) return;

    settings = {
        toneMapping: 5,
        exposure: 1.0,
        shadows: true,
        shadowQuality: 2048,
        fog: false,
        ambientIntensity: 1.0,
        directionalIntensity: 5.0,
        lightColor: 0xffffff,
        ambientOcclusion: false,
        aoRadius: 12,
        aoMinDistance: 0.002,
        aoMaxDistance: 0.12,
        gridSize: 64,
        gridColor1: 0x2a3f8a,
        gridColor2: 0x1a2a5a,
        backgroundColor: 0x0a0e27,
        fov: 60,
        ghostOpacity: 0.4,
        historySize: 50,
        autosaveInterval: 30
    };

    applySettings();
    loadSettingsToUI();
    showNotification("Settings reset to defaults");
}

// Creates the 3D compass helper with axis markers and labels.
async function create3DCompass()
{
    // Remove existing compass if any
    if (compassGroup)
    {
        scene.remove(compassGroup);
        // Dispose of geometries/materials
        compassGroup.traverse(child =>
        {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }

    compassGroup = new THREE.Group();
    compassGroup.name = 'compass';

    // Position compass at the edges of the grid
    const gridHalfSize = settings.gridSize / 2;
    const compassHeight = 0.5; // Height above grid
    const compassOffset = 5; // Distance from edge of grid

    // Load a font
    const fontLoader = new THREE.FontLoader();

    try
    {
        // Try to load a font from three.js examples
        const font = await new Promise((resolve, reject) =>
        {
            fontLoader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json',
                resolve,
                undefined,
                reject
            );
        });

        // Create text material
        const textMaterial = new THREE.MeshBasicMaterial(
        {
            color: 0x4fc3f7,
            transparent: true,
            opacity: 0.9
        });

        const northMaterial = new THREE.MeshBasicMaterial(
        {
            color: 0xff4444, // Red for North
            transparent: true,
            opacity: 0.9
        });

        // NORTH text (negative Z direction)
        const northText = createTextMesh('N', font, textMaterial);
        northText.position.set(0, compassHeight, -gridHalfSize - compassOffset);
        northText.rotation.x = -Math.PI / 2; // Lay flat
        compassGroup.add(northText);

        // SOUTH text (positive Z direction)
        const southText = createTextMesh('S', font, northMaterial);
        southText.position.set(0, compassHeight, gridHalfSize + compassOffset);
        southText.rotation.x = -Math.PI / 2;
        compassGroup.add(southText);

        // EAST text (positive X direction)
        const eastText = createTextMesh('E', font, textMaterial);
        eastText.position.set(gridHalfSize + compassOffset, compassHeight, 0);
        eastText.rotation.x = -Math.PI / 2;
        eastText.rotation.z = Math.PI / 2;
        compassGroup.add(eastText);

        // WEST text (negative X direction)
        const westText = createTextMesh('W', font, textMaterial);
        westText.position.set(-gridHalfSize - compassOffset, compassHeight, 0);
        westText.rotation.x = -Math.PI / 2;
        westText.rotation.z = Math.PI / 2;
        compassGroup.add(westText);

        // Add a subtle glow/background behind text
        createTextBackgrounds(compassGroup, gridHalfSize, compassHeight);

    }
    catch (error)
    {
        console.warn('Could not load font, using fallback compass:', error);
        createFallbackCompass(gridHalfSize, compassHeight, compassOffset);
    }

    scene.add(compassGroup);
}

// Creates text mesh.
function createTextMesh(text, font, material, size = 3)
{
    const textGeometry = new THREE.TextGeometry(text,
    {
        font: font,
        size: size,
        height: 0.1,
        curveSegments: 12,
        bevelEnabled: false
    });

    textGeometry.computeBoundingBox();
    const centerOffset = -0.5 * (textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x);

    const textMesh = new THREE.Mesh(textGeometry, material);
    textMesh.position.x = centerOffset;

    return textMesh;
}

// Creates fallback compass.
function createFallbackCompass(gridHalfSize, compassHeight, compassOffset)
{
    // Fallback using basic shapes if font loading fails

    // Create direction markers using boxes and cones
    const markerMaterial = new THREE.MeshBasicMaterial(
    {
        color: 0x4fc3f7
    });
    const northMaterial = new THREE.MeshBasicMaterial(
    {
        color: 0xff4444
    });

    // North (red arrow)
    const northArrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 2, 8),
        northMaterial
    );
    northArrow.position.set(0, compassHeight + 1, -gridHalfSize - compassOffset);
    northArrow.rotation.x = Math.PI / 2;
    compassGroup.add(northArrow);

    // South (blue arrow)
    const southArrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 2, 8),
        markerMaterial
    );
    southArrow.position.set(0, compassHeight + 1, gridHalfSize + compassOffset);
    southArrow.rotation.x = -Math.PI / 2;
    compassGroup.add(southArrow);

    // East (blue arrow)
    const eastArrow = southArrow.clone();
    eastArrow.position.set(gridHalfSize + compassOffset, compassHeight + 1, 0);
    eastArrow.rotation.z = -Math.PI / 2;
    eastArrow.rotation.x = 0;
    compassGroup.add(eastArrow);

    // West (blue arrow)
    const westArrow = southArrow.clone();
    westArrow.position.set(-gridHalfSize - compassOffset, compassHeight + 1, 0);
    westArrow.rotation.z = Math.PI / 2;
    westArrow.rotation.x = 0;
    compassGroup.add(westArrow);

    // Add simple N, S, E, W text using planes with canvas textures
    createCanvasTextMarker('N', -gridHalfSize - compassOffset + 0.5, compassHeight, -gridHalfSize - compassOffset, 0xff4444);
    createCanvasTextMarker('S', -gridHalfSize - compassOffset + 0.5, compassHeight, gridHalfSize + compassOffset, 0x4fc3f7);
    createCanvasTextMarker('E', gridHalfSize + compassOffset, compassHeight, 0.5, 0x4fc3f7);
    createCanvasTextMarker('W', -gridHalfSize - compassOffset, compassHeight, 0.5, 0x4fc3f7);
}

// Creates canvas text marker.
function createCanvasTextMarker(text, x, y, z, color)
{
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 64;
    canvas.height = 64;

    // Clear canvas
    context.fillStyle = 'rgba(0,0,0,0)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Draw text
    context.font = 'bold 48px Arial';
    context.fillStyle = `#${color.toString(16)}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    // Add glow effect
    context.shadowColor = `#${color.toString(16)}`;
    context.shadowBlur = 10;
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial(
    {
        map: texture,
        transparent: true,
        side: THREE.DoubleSide
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.set(x, y + 1, z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.lookAt(new THREE.Vector3(0, mesh.position.y, 0));

    compassGroup.add(mesh);
}

// Creates simple text.
function createSimpleText(text, size = 1)
{
    // Create simple text using sprites if font not available
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 64;

    context.fillStyle = 'rgba(10, 15, 35, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.font = 'bold 32px Arial';
    context.fillStyle = '#4fc3f7';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial(
    {
        map: texture,
        transparent: true
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(size * 2, size, 1);

    return sprite;
}

// Creates text backgrounds.
function createTextBackgrounds(group, gridHalfSize, compassHeight)
{
    // Add subtle planes behind text for better readability
    const backgroundMaterial = new THREE.MeshBasicMaterial(
    {
        color: 0x0a0f23,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
    });

    // Background for N
    const northBg = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 3),
        backgroundMaterial
    );
    northBg.position.set(0, compassHeight - 0.05, -gridHalfSize - 6);
    northBg.rotation.x = -Math.PI / 2;
    group.add(northBg);

    // Background for S
    const southBg = northBg.clone();
    southBg.position.set(0, compassHeight - 0.05, gridHalfSize + 6);
    group.add(southBg);

    // Background for E
    const eastBg = northBg.clone();
    eastBg.position.set(gridHalfSize + 6, compassHeight - 0.05, 0);
    eastBg.rotation.z = Math.PI / 2;
    group.add(eastBg);

    // Background for W
    const westBg = northBg.clone();
    westBg.position.set(-gridHalfSize - 6, compassHeight - 0.05, 0);
    westBg.rotation.z = Math.PI / 2;
    group.add(westBg);
}

// Analyzes a tile mesh to estimate a visual offset for grid alignment.
async function analyzeTileVisualOffset(tileData)
{
    if (!tileData.mesh || tileData.visualOffset) return;

    try
    {
        const mesh = await loadMesh(tileData.mesh);

        // Calculate visual offset for all 4 rotations
        tileData.visualOffsets = {
            0: calculateVisualOffset(mesh, tileData, 0), // 0°
            1: calculateVisualOffset(mesh, tileData, Math.PI / 2), // 90°
            2: calculateVisualOffset(mesh, tileData, Math.PI), // 180°
            3: calculateVisualOffset(mesh, tileData, 3 * Math.PI / 2) // 270°
        };

        console.log(`Visual offsets for ${tileData.name}:`, tileData.visualOffsets);

    }
    catch (error)
    {
        console.warn(`Could not analyze visual offset for ${tileData.name}:`, error);
        tileData.visualOffsets = {
            0: new THREE.Vector3(),
            1: new THREE.Vector3(),
            2: new THREE.Vector3(),
            3: new THREE.Vector3()
        };
    }
}

/**
 * Calculate the offset between visual center and footprint center
 * @param {THREE.Object3D} mesh - The mesh object
 * @param {Object} tileData - Tile definition
 * @param {number} rotation - Current rotation in radians
 * @returns {THREE.Vector3} Offset vector
 */
// Calculates visual offset.
function calculateVisualOffset(mesh, tileData, rotation)
{
    // 1. Get bounding box in LOCAL space (no rotation/position)
    const box = new THREE.Box3().setFromObject(mesh);
    const visualCenter = box.getCenter(new THREE.Vector3());

    // 2. Calculate footprint center based on pivot type
    const [w, h] = tileData.size;
    let footprintCenter;

    switch (tileData.pivotType || "footprint_center")
    {
        case "footprint_center":
            // Footprint center is at origin for footprint_center pivot
            footprintCenter = new THREE.Vector3(0, 0, 0);
            break;

        case "bottom_left":
            // For bottom-left pivot, footprint center is at (w/2, 0, h/2)
            footprintCenter = new THREE.Vector3(w / 2, 0, h / 2);
            break;

        case "visual_center":
            // Already using visual center
            return new THREE.Vector3(0, 0, 0);

        default:
            footprintCenter = new THREE.Vector3(0, 0, 0);
    }

    // 3. Apply rotation to footprint center
    // (Visual center is already in mesh-local coordinates)
    footprintCenter.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);

    // 4. Calculate offset: visualCenter - footprintCenter
    const offset = new THREE.Vector3().subVectors(visualCenter, footprintCenter);

    return offset;
}

// Calculates pivot offset.
function calculatePivotOffset(mesh)
{
    // Get bounding box in LOCAL SPACE (no transforms)
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());

    // The offset is just the center coordinates (since pivot is at origin)
    return {
        x: center.x,
        y: center.y,
        z: center.z,
        // Store the full data for reference
        boundingBox:
        {
            min: box.min.toArray(),
            max: box.max.toArray(),
            center: center.toArray()
        }
    };
}

// Switches pack type.
function switchPackType(type)
{
    if (currentPackType === type) return;

    currentPackType = type;

    // Update active tab UI
    document.querySelectorAll('.pack-type-tab').forEach(tab =>
    {
        tab.classList.toggle('active', tab.dataset.type === type);
    });

    // Auto-select first pack if none selected
    if (type === 'tiles' && tilePacks.size > 0 && !activePackId)
    {
        activePackId = Array.from(tilePacks.keys())[0];
    }
    else if (type === 'details' && detailPacks.size > 0 && !activeDetailPackId)
    {
        activeDetailPackId = Array.from(detailPacks.keys())[0];
    }

    // Update pack list
    updatePackList();

    // Update the grid - THIS IS CRITICAL
    updateTileGrid();
}

// Updates pack list.
function updatePackList()
{
    const container = document.getElementById('packTabs');
    container.innerHTML = '';

    if (currentPackType === 'tiles')
    {
        // Show tile packs
        tilePacks.forEach(pack =>
        {
            const button = document.createElement('button');
            button.className = 'pack-tab' + (pack.id === activePackId ? ' active' : '');
            button.textContent = pack.name;
            button.onclick = () =>
            {
                activePackId = pack.id;
                selectedPaletteTile = null;
                updatePackList();
                updateTileGrid(); // This updates the asset browser
            };
            container.appendChild(button);
        });
    }
    else
    {
        // Show detail packs
        detailPacks.forEach(pack =>
        {
            const button = document.createElement('button');
            button.className = 'pack-tab' + (pack.id === activeDetailPackId ? ' active' : '');
            button.textContent = pack.name;
            button.onclick = () =>
            {
                activeDetailPackId = pack.id;
                selectedDetail = null;
                updatePackList();
                updateTileGrid(); // This updates the asset browser
            };
            container.appendChild(button);
        });
    }
}

// Fetches a detail-pack JSON file from a URL and loads it into the editor.
async function loadDetailPackFromURL(url)
{
    try
    {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const detailPack = await response.json();
        loadDetailPack(detailPack);
        console.log(`Loaded detail pack: ${url}`);
    }
    catch (error)
    {
        console.warn(`Failed to load ${url}:`, error.message);
    }
}

// Loads detail pack.
function loadDetailPack(detailPack)
{
    const packId = detailPack.id || THREE.MathUtils.generateUUID();
    if (detailPacks.has(packId)) return;

    const packDetails = [];
    detailPack.details.forEach((detail, index) =>
    {
        const uniqueId = detail.id ? `${packId}:${detail.id}` : `${packId}:detail_${index}`;
        const detailObj = {
            ...detail,
            packId,
            originalId: detail.id,
            id: uniqueId,
            type: 'detail',
            // Ensure scale properties exist
            defaultScale: detail.defaultScale || [1, 1, 1],
            minScale: detail.minScale || [0.1, 0.1, 0.1],
            maxScale: detail.maxScale || [5, 5, 5]
        };

        details.set(uniqueId, detailObj);
        packDetails.push(detailObj);
    });

    detailPacks.set(packId,
    {
        id: packId,
        name: detailPack.name || 'Unnamed Details',
        spriteSheet: detailPack.spriteSheet || '',
        iconCols: detailPack.iconCols || 4,
        iconSize: detailPack.iconSize || 64,
        details: packDetails
    });

    if (activeDetailPackId === null && detailPacks.size > 0)
    {
        activeDetailPackId = packId;
    }

    updatePackList();
    showNotification(`Loaded detail pack: ${detailPack.name}`);
}

// Updates detail grid.
function updateDetailGrid()
{
    const grid = document.getElementById('tileGrid');
    grid.innerHTML = '';

    const pack = detailPacks.get(activeDetailPackId);
    if (!pack) return;

    // Update category tabs
    updateCategoryTabsForDetails();

    const indexToSpriteXY = (idx, cols, iconSize) =>
    {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        return {
            x: col * iconSize,
            y: row * iconSize
        };
    };

    pack.details.forEach(detail =>
    {
        const div = document.createElement('div');
        div.className = 'tile-item detail-item';
        div.dataset.detailId = detail.id;
        div.title = detail.name;
        div.draggable = true;

        // Sprite preview
        let previewStyle = '';
        if (detail.spriteIndex != null && pack.spriteSheet)
        {
            const
            {
                x,
                y
            } = indexToSpriteXY(detail.spriteIndex, pack.iconCols, pack.iconSize);
            const sheetWH = `${pack.iconCols * pack.iconSize}px`;

            previewStyle =
                `background-image:url('${pack.spriteSheet}');` +
                `background-size:${sheetWH} ${sheetWH};` +
                `background-position:-${x}px -${y}px;`;
        }
        else if (detail.color)
        {
            previewStyle = `background-color:${detail.color};`;
        }
        else
        {
            previewStyle = `background-color:#888888;`;
        }

        // Label & 3D indicator
        const meshIcon = detail.mesh ? '<span class="mesh-indicator">📦</span>' : '';

        div.innerHTML = `
            <div class="sprite-preview" style="${previewStyle}"></div>
            <div class="tile-label">${detail.name}${meshIcon}</div>
        `;

        // Selection
        div.onclick = () =>
        {
            selectedDetail = detail;
            selectedPaletteTile = null;
            grid.querySelectorAll('.tile-item').forEach(el => el.classList.remove('active'));
            div.classList.add('active');

            // Set interaction mode to detail placement
            setInteractionMode('place');
        };

        grid.appendChild(div);
    });

    if (window.feather) feather.replace();

    // Apply current category filter
    const activeCategory = document.querySelector('.category-tab.active')?.dataset.category || 'all';
    filterByCategoryForDetails(activeCategory);
}

// Updates category tabs for details.
function updateCategoryTabsForDetails()
{
    const categoryTabs = document.getElementById('categoryTabs');
    if (!categoryTabs) return;

    categoryTabs.innerHTML = '';

    const pack = detailPacks.get(activeDetailPackId);
    if (!pack) return;

    const categories = new Set();
    pack.details.forEach(detail =>
    {
        if (detail.category)
        {
            categories.add(detail.category);
        }
    });

    // Add "All" tab first
    const allTab = document.createElement('button');
    allTab.className = 'category-tab active';
    allTab.textContent = 'All';
    allTab.dataset.category = 'all';
    allTab.onclick = () => filterByCategoryForDetails('all');
    categoryTabs.appendChild(allTab);

    // Add category tabs
    Array.from(categories).sort().forEach(category =>
    {
        const tab = document.createElement('button');
        tab.className = 'category-tab';
        tab.textContent = category;
        tab.dataset.category = category;
        tab.onclick = () => filterByCategoryForDetails(category);
        categoryTabs.appendChild(tab);
    });
}

// Filters by category for details.
function filterByCategoryForDetails(category)
{
    // Update active tab
    document.querySelectorAll('.category-tab').forEach(tab =>
    {
        tab.classList.toggle('active', tab.dataset.category === category);
    });

    // Filter details
    const detailItems = document.querySelectorAll('#tileGrid .detail-item');
    detailItems.forEach(item =>
    {
        const detailId = item.dataset.detailId;
        const detail = details.get(detailId);

        if (category === 'all' || (detail && detail.category === category))
        {
            item.style.display = 'block';
        }
        else
        {
            item.style.display = 'none';
        }
    });
}

// Auto-loads configured tile/detail packs and optional auto-saved layout data.
async function autoLoadTilePacks(autoSavedLayout = null)
{
    document.getElementById('loading').style.display = 'flex';
    let loadedSomething = false;
    let loadedDetails = false;

    const bust = Date.now();

    if (window.location.protocol !== 'file:')
    {
        try
        {
            // Fetch tile packs manifest
            const manifestUrl = `tilepacks/manifest.json?t=${bust}`;
            const response = await fetch(manifestUrl);
            if (response.ok)
            {
                const manifest = await response.json();
                if (manifest.tilepacks && Array.isArray(manifest.tilepacks))
                {
                    for (const filename of manifest.tilepacks)
                    {
                        const url = `tilepacks/${filename}?t=${bust}`;
                        await loadTilePackFromURL(url);
                    }
                    loadedSomething = true;
                }
            }
        }
        catch (e)
        {
            console.log('Could not load tile pack manifest:', e);
        }

        try
        {
            // Fetch detail packs manifest
            const detailManifestUrl = `detailpacks/manifest.json?t=${bust}`;
            const response = await fetch(detailManifestUrl);
            if (response.ok)
            {
                const manifest = await response.json();
                if (manifest.detailpacks && Array.isArray(manifest.detailpacks))
                {
                    for (const filename of manifest.detailpacks)
                    {
                        const url = `detailpacks/${filename}?t=${bust}`;
                        await loadDetailPackFromURL(url);
                    }
                    loadedDetails = true;
                }
            }
        }
        catch (e)
        {
            console.log('Could not load detail pack manifest:', e);
        }
    }

    if (!loadedSomething && tilePacks.size === 0)
    {
        console.log("No tile packs loaded.");
    }

    if (!loadedDetails && detailPacks.size === 0)
    {
        console.log("No detail packs loaded.");
    }

    // Initialize pack type tabs
    updatePackList();

    // Show tiles by default if available, otherwise show details
    if (tilePacks.size > 0)
    {
        // Auto-select first tile pack
        activePackId = Array.from(tilePacks.keys())[0];
        switchPackType('tiles');
    }
    else if (detailPacks.size > 0)
    {
        // Auto-select first detail pack
        activeDetailPackId = Array.from(detailPacks.keys())[0];
        switchPackType('details');
    }
    else
    {
        // If nothing loaded, create default UI state
        updateTileGrid();
    }

    if (autoSavedLayout)
    {
        await loadLayout(autoSavedLayout, true);
    }

    document.getElementById('loading').style.display = 'none';
}

window.addEventListener('load', init);
