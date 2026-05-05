/**
 * Home3D — Galaxy / Solar System with 3D Logo Models
 * Central sun with "WAS", 3D section logos orbiting,
 * right-click orbit controls (Blender-style), scroll zoom.
 * Enhanced: realistic sun, meteors, supernovae, twinkling stars.
 */
var Home3D = (function () {
    'use strict';

    var scene, camera, renderer, raycaster, mouse;
    var sun, sunCorona, sunGlow, sunGlowOuter, sunGlowCore;
    var solarFlares = [];
    var planets = [];       // THREE.Group per section
    var planetGlows = [];
    var orbitLines = [];
    var starField;
    var dustParticles = [];
    var labelEls = [];
    var containerEl, labelsEl;
    var animId = null;
    var isActive = false;
    var hoveredPlanet = null;

    // Mobile detection for performance tuning
    var isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
        (window.matchMedia && window.matchMedia('(hover: none)').matches) ||
        (window.innerWidth < 900);

    // Zoom transition state
    var zoomTarget = null;       // planet group being zoomed into
    var zoomPage = null;         // page name to navigate to
    var zoomStartTime = 0;
    var zoomDuration = 1.0;      // seconds
    var zoomStartPos = null;     // camera start position {x,y,z}
    var isZooming = false;
    var transitionOverlay = null;

    // New arrays for enhanced effects
    var meteors = [];
    var supernovae = [];
    var twinklingStars = [];

    // Timers for spawning
    var nextMeteorTime = 0;
    var nextSupernovaTime = 0;

    // Mouse parallax
    var mouseTarget = { x: 0, y: 0 };
    var mouseLerp  = { x: 0, y: 0 };

    // Orbit camera (Blender-style right-click drag)
    var orbit = {
        theta: 0, phi: 1.35,
        targetTheta: 0, targetPhi: 1.35,
        radius: 22, targetRadius: 22,
        isDragging: false, lastX: 0, lastY: 0
    };

    var SECTIONS = [
        { name: 'Notes',    page: 'notes',    color: 0xC4B5FD, emissive: 0x6D28D9, orbR: 3.8,  orbSpeed: 0.32,  orbTilt: 0.25,  start: 0,              logoScale: 0.55 },
        { name: 'Trading',  page: 'trading',  color: 0x86EFAC, emissive: 0x059669, orbR: 5.5,  orbSpeed: 0.21,  orbTilt:-0.18,  start: Math.PI * 0.5,  logoScale: 0.50 },
        { name: 'Social',   page: 'social',   color: 0xFCA5A5, emissive: 0xDC2626, orbR: 7.2,  orbSpeed: 0.14,  orbTilt: 0.13,  start: Math.PI,        logoScale: 0.55 },
        { name: 'Finances', page: 'finances', color: 0x93C5FD, emissive: 0x2563EB, orbR: 9.0,  orbSpeed: 0.09,  orbTilt:-0.22,  start: Math.PI * 1.5,  logoScale: 0.80 }
    ];

    // ── Init / Destroy ──────────────────────────────────────────────────────

    function init() {
        if (isActive) return;
        containerEl = document.getElementById('home-3d-container');
        labelsEl    = document.getElementById('home-3d-labels');
        if (!containerEl || typeof THREE === 'undefined') return;

        orbit.radius = orbit.targetRadius = baseRadius();
        setupScene();
        setupLights();
        createSun();
        createPlanets();
        createOrbitRings();
        createStarField();
        createTwinklingStars();
        createDust();
        createLabels();
        addChannelPlanets();
        bindEvents();
        isActive = true;
        nextMeteorTime = performance.now() * 0.001 + (isMobile ? 999999 : 2);  // disable meteors on mobile
        nextSupernovaTime = performance.now() * 0.001 + (isMobile ? 999999 : 5); // disable supernovae on mobile
        animate();
    }

    function destroy() {
        isActive = false;
        isZooming = false;
        zoomTarget = null;
        zoomPage = null;
        if (transitionOverlay && transitionOverlay.parentNode) {
            transitionOverlay.parentNode.removeChild(transitionOverlay);
            transitionOverlay = null;
        }
        if (animId) { cancelAnimationFrame(animId); animId = null; }
        window.removeEventListener('resize', onResize);
        if (containerEl) {
            containerEl.removeEventListener('mousemove', onMouseMove);
            containerEl.removeEventListener('mousedown', onMouseDown);
            containerEl.removeEventListener('mouseup', onMouseUp);
            containerEl.removeEventListener('click', onClick);
            containerEl.removeEventListener('contextmenu', onContextMenu);
            containerEl.removeEventListener('wheel', onWheel);
            containerEl.removeEventListener('touchstart', onTouch);
        }
        if (renderer) {
            renderer.dispose();
            if (renderer.domElement && renderer.domElement.parentNode)
                renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        // Dispose sun
        if (sun) { if (sun.material.map) sun.material.map.dispose(); sun.geometry.dispose(); sun.material.dispose(); }
        if (sunCorona) { sunCorona.geometry.dispose(); sunCorona.material.dispose(); }
        if (sunGlow) { if (sunGlow.material.map) sunGlow.material.map.dispose(); sunGlow.material.dispose(); }
        if (sunGlowOuter) { if (sunGlowOuter.material.map) sunGlowOuter.material.map.dispose(); sunGlowOuter.material.dispose(); }
        if (sunGlowCore) { if (sunGlowCore.material.map) sunGlowCore.material.map.dispose(); sunGlowCore.material.dispose(); }
        // Dispose solar flares
        solarFlares.forEach(function (f) { if (f.material.map) f.material.map.dispose(); f.material.dispose(); });
        // Dispose planet groups recursively
        planets.forEach(function (p) {
            p.traverse(function (c) {
                if (c.isMesh) {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
                }
            });
        });
        planetGlows.forEach(function (g) { if (g.material.map) g.material.map.dispose(); g.material.dispose(); });
        orbitLines.forEach(function (l) { l.geometry.dispose(); l.material.dispose(); });
        dustParticles.forEach(function (d) { d.geometry.dispose(); d.material.dispose(); });
        if (starField) { starField.geometry.dispose(); starField.material.dispose(); }

        // Dispose meteors
        meteors.forEach(function (m) {
            if (m.group && m.group.parent) m.group.parent.remove(m.group);
            m.sprites.forEach(function (s) { if (s.material.map) s.material.map.dispose(); s.material.dispose(); });
        });

        // Dispose supernovae
        supernovae.forEach(function (sn) {
            if (sn.sprite && sn.sprite.parent) sn.sprite.parent.remove(sn.sprite);
            if (sn.sprite) { if (sn.sprite.material.map) sn.sprite.material.map.dispose(); sn.sprite.material.dispose(); }
        });

        // Dispose twinkling stars
        twinklingStars.forEach(function (ts) {
            if (ts.points && ts.points.parent) ts.points.parent.remove(ts.points);
            if (ts.points) { ts.points.geometry.dispose(); ts.points.material.dispose(); }
            if (ts.sprite && ts.sprite.parent) ts.sprite.parent.remove(ts.sprite);
            if (ts.sprite) { if (ts.sprite.material.map) ts.sprite.material.map.dispose(); ts.sprite.material.dispose(); }
        });
        twinkleGeometry = null; twinkleSizes = null; twinklePhases = null; twinkleFreqs = null;

        planets = []; planetGlows = []; orbitLines = []; dustParticles = []; labelEls = [];
        channelPlanets = []; channelGlows = [];
        meteors = []; supernovae = []; twinklingStars = []; solarFlares = [];
        sun = sunCorona = sunGlow = sunGlowOuter = sunGlowCore = starField = null;
        scene = camera = renderer = raycaster = null;
        hoveredPlanet = null;
    }

    // ── Scene ──────────────────────────────────────────��────────���───────────

    function setupScene() {
        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x030308, 0.008);
        cachedWidth = containerEl.clientWidth;
        cachedHeight = containerEl.clientHeight;
        camera = new THREE.PerspectiveCamera(50, cachedWidth / cachedHeight, 0.1, 200);
        renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true, powerPreference: isMobile ? 'low-power' : 'high-performance' });
        renderer.setSize(cachedWidth, cachedHeight);
        renderer.setPixelRatio(isMobile ? Math.min(window.devicePixelRatio, 1.5) : window.devicePixelRatio);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        containerEl.appendChild(renderer.domElement);
        raycaster = new THREE.Raycaster();
        mouse = new THREE.Vector2(-10, -10);
    }

    function baseRadius() {
        if (!containerEl) return 22;
        var a = containerEl.clientWidth / containerEl.clientHeight;
        if (a < 0.7) return 36;
        if (a < 1.0) return 28;
        return 22;
    }

    // ── Lights ───────────────────────────────────��──────────────────────────

    function setupLights() {
        scene.add(new THREE.AmbientLight(0x2a2a4a, 0.6));
        var sunLight = new THREE.PointLight(0xFFDD88, 2.5, 100, 1.2);
        scene.add(sunLight);
        var fill = new THREE.DirectionalLight(0x8888ff, 0.18);
        fill.position.set(-10, 5, -10); scene.add(fill);
        var fill2 = new THREE.DirectionalLight(0xff8888, 0.14);
        fill2.position.set(10, -3, 5); scene.add(fill2);
    }

    // ── Glow Texture ────────────────────────────────────────────────────────

    function createGlowTexture() {
        var s = isMobile ? 128 : 256, c = document.createElement('canvas');
        c.width = s; c.height = s;
        var ctx = c.getContext('2d'), h = s / 2;
        var g = ctx.createRadialGradient(h, h, 0, h, h, h);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.08, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.15, 'rgba(255,255,255,0.7)');
        g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.2)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
        g.addColorStop(0.8, 'rgba(255,255,255,0.02)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
        return new THREE.CanvasTexture(c);
    }

    // ── Sun ─────────────────────────────────────────────────────────────────

    function createSun() {
        // Enhanced sun texture with sunspots and glowing WAS text
        var tc = document.createElement('canvas');
        var sunTexSize = isMobile ? 512 : 1024;
        tc.width = sunTexSize; tc.height = sunTexSize / 2;
        var ctx = tc.getContext('2d');

        // Complex gradient: white center -> bright yellow -> orange -> deep red at edges
        var tw = tc.width, th = tc.height;
        var g = ctx.createRadialGradient(tw/2, th/2, 0, tw/2, th/2, tw/2);
        g.addColorStop(0, '#FFFFFF');
        g.addColorStop(0.1, '#FFFDE7');
        g.addColorStop(0.25, '#FFE082');
        g.addColorStop(0.45, '#FFB300');
        g.addColorStop(0.65, '#FF8F00');
        g.addColorStop(0.82, '#E65100');
        g.addColorStop(1, '#BF360C');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, tw, th);

        // Add sunspots (fewer on mobile)
        var si, numSpots = isMobile ? 10 : 20;
        for (si = 0; si < numSpots; si++) {
            var spotX = Math.random() * tw;
            var spotY = Math.random() * th;
            var spotR = (5 + Math.random() * 25) * (tw / 1024);
            var spotAlpha = 0.05 + Math.random() * 0.15;
            ctx.beginPath();
            ctx.arc(spotX, spotY, spotR, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(80,30,0,' + spotAlpha + ')';
            ctx.fill();
        }

        // WAS text with glow effect
        var fontSize = Math.round(160 * (tw / 1024));
        ctx.font = '900 ' + fontSize + 'px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 40 * (tw / 1024);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('WAS', tw/2, th/2);
        if (!isMobile) ctx.fillText('WAS', tw/2, th/2); // double draw only on desktop

        // Draw again sharp on top (no shadow)
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText('WAS', tw/2, th/2);

        var tex = new THREE.CanvasTexture(tc);

        // Inner core sphere - bright white/yellow, high emissive
        var sunSegs = isMobile ? 24 : 32;
        sun = new THREE.Mesh(
            new THREE.SphereGeometry(1.2, sunSegs, sunSegs),
            new THREE.MeshStandardMaterial({
                map: tex,
                emissive: 0xFFCC44,
                emissiveIntensity: 1.2,
                roughness: 0.3
            })
        );
        scene.add(sun);

        // Outer corona sphere - slightly larger, transparent, animated
        sunCorona = new THREE.Mesh(
            new THREE.SphereGeometry(1.4, sunSegs, sunSegs),
            new THREE.MeshStandardMaterial({
                color: 0xFFAA33,
                emissive: 0xFF8800,
                emissiveIntensity: 0.6,
                transparent: true,
                opacity: 0.25,
                roughness: 0.5,
                depthWrite: false,
                side: THREE.FrontSide
            })
        );
        scene.add(sunCorona);

        // Glow sprites for layered corona effect
        var glowTex = createGlowTexture();

        // Inner bright glow (small, bright)
        sunGlowCore = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTex, color: 0xFFEECC, transparent: true,
            opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        sunGlowCore.scale.setScalar(5);
        scene.add(sunGlowCore);

        // Mid glow
        sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTex, color: 0xFFAA44, transparent: true,
            opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        sunGlow.scale.setScalar(8);
        scene.add(sunGlow);

        // Large dim outer glow
        sunGlowOuter = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTex, color: 0xFF6622, transparent: true,
            opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        sunGlowOuter.scale.setScalar(14);
        scene.add(sunGlowOuter);

        // Solar flare particles: sprites orbiting close to the sun surface
        var flareTex = createGlowTexture();
        var flareCount = isMobile ? 2 : 5;
        for (var fi = 0; fi < flareCount; fi++) {
            var flareSize = 0.15 + Math.random() * 0.25;
            var flareMat = new THREE.SpriteMaterial({
                map: flareTex, color: new THREE.Color().setHSL(0.08 + Math.random() * 0.08, 1.0, 0.6 + Math.random() * 0.3),
                transparent: true, opacity: 0.4 + Math.random() * 0.4,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            var flareSprite = new THREE.Sprite(flareMat);
            flareSprite.scale.setScalar(flareSize);
            flareSprite.userData = {
                orbitRadius: 1.5 + Math.random() * 0.4,
                theta: Math.random() * Math.PI * 2,
                phi: (Math.random() - 0.5) * Math.PI * 0.8,
                speedTheta: (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? 1 : -1),
                speedPhi: (0.1 + Math.random() * 0.3) * (Math.random() < 0.5 ? 1 : -1),
                wobblePhase: Math.random() * Math.PI * 2,
                wobbleSpeed: 1 + Math.random() * 3,
                wobbleAmp: 0.05 + Math.random() * 0.15
            };
            scene.add(flareSprite);
            solarFlares.push(flareSprite);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  3D LOGO BUILDERS
    // ════════════════════════════════════════════════════════════════════════

    function createNotesLogo() {
        var grp = new THREE.Group();
        var pageMat = new THREE.MeshStandardMaterial({ color: 0xF0E6FF, roughness: 0.45, emissive: 0x6D28D9, emissiveIntensity: 0.08 });
        var darkMat = new THREE.MeshStandardMaterial({ color: 0xD4C0FF, roughness: 0.5 });
        var lineMat = new THREE.MeshStandardMaterial({ color: 0x8B7FC7, roughness: 0.6 });

        // Back page
        var p2 = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.35, 0.04), darkMat);
        p2.position.set(0.04, -0.03, -0.05); p2.rotation.z = 0.04;
        grp.add(p2);

        // Front page
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.35, 0.06), pageMat));

        // Folded corner
        var fShape = new THREE.Shape();
        fShape.moveTo(0, 0); fShape.lineTo(-0.22, 0); fShape.lineTo(0, -0.22); fShape.closePath();
        var fold = new THREE.Mesh(
            new THREE.ExtrudeGeometry(fShape, { depth: 0.065, bevelEnabled: false }),
            darkMat
        );
        fold.position.set(0.525, 0.675, -0.002);
        grp.add(fold);

        // Text lines
        var widths = [0.65, 0.65, 0.65, 0.4];
        for (var i = 0; i < 4; i++) {
            var ln = new THREE.Mesh(new THREE.BoxGeometry(widths[i], 0.04, 0.065), lineMat);
            ln.position.set(i === 3 ? -0.12 : 0, 0.2 - i * 0.2, 0);
            grp.add(ln);
        }
        return grp;
    }

    function createTradingLogo() {
        var grp = new THREE.Group();
        var bars = [
            { h: 0.55, c: 0x22c55e, x: -0.38 },
            { h: 0.9,  c: 0x22c55e, x: -0.13 },
            { h: 0.4,  c: 0xef4444, x: 0.12 },
            { h: 1.15, c: 0x22c55e, x: 0.37 }
        ];
        for (var i = 0; i < bars.length; i++) {
            var b = bars[i];
            var bar = new THREE.Mesh(
                new THREE.BoxGeometry(0.2, b.h, 0.2),
                new THREE.MeshStandardMaterial({ color: b.c, roughness: 0.35, metalness: 0.1, emissive: b.c, emissiveIntensity: 0.1 })
            );
            bar.position.set(b.x, b.h / 2 - 0.45, 0);
            grp.add(bar);
        }
        // Base
        var base = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.06, 0.35),
            new THREE.MeshStandardMaterial({ color: 0x1a3a2a, roughness: 0.6 })
        );
        base.position.y = -0.48;
        grp.add(base);

        // Upward arrow
        var aShape = new THREE.Shape();
        aShape.moveTo(0, 0.2); aShape.lineTo(0.14, 0); aShape.lineTo(0.05, 0);
        aShape.lineTo(0.05, -0.25); aShape.lineTo(-0.05, -0.25); aShape.lineTo(-0.05, 0);
        aShape.lineTo(-0.14, 0); aShape.closePath();
        var arrow = new THREE.Mesh(
            new THREE.ExtrudeGeometry(aShape, { depth: 0.08, bevelEnabled: false }),
            new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.3, emissive: 0x22c55e, emissiveIntensity: 0.15 })
        );
        arrow.position.set(0.37, 0.95, -0.04);
        grp.add(arrow);
        return grp;
    }

    function createYouTubeLogo() {
        var grp = new THREE.Group();

        // Rounded rectangle body
        var w = 1.5, h = 1.05, r = 0.22;
        var s = new THREE.Shape();
        s.moveTo(-w/2 + r, -h/2);
        s.lineTo(w/2 - r, -h/2);
        s.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + r);
        s.lineTo(w/2, h/2 - r);
        s.quadraticCurveTo(w/2, h/2, w/2 - r, h/2);
        s.lineTo(-w/2 + r, h/2);
        s.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - r);
        s.lineTo(-w/2, -h/2 + r);
        s.quadraticCurveTo(-w/2, -h/2, -w/2 + r, -h/2);

        var bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: !isMobile, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: isMobile ? 1 : 3 });
        bodyGeo.center();
        var body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({
            color: 0xFF0000, roughness: 0.35, emissive: 0x880000, emissiveIntensity: 0.15
        }));
        grp.add(body);

        // Play triangle
        var t = new THREE.Shape();
        t.moveTo(-0.18, -0.28); t.lineTo(0.28, 0); t.lineTo(-0.18, 0.28); t.closePath();
        var triGeo = new THREE.ExtrudeGeometry(t, { depth: 0.04, bevelEnabled: false });
        triGeo.center();
        var tri = new THREE.Mesh(triGeo, new THREE.MeshStandardMaterial({
            color: 0xffffff, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.08
        }));
        tri.position.set(0.03, 0, 0.2);
        grp.add(tri);
        return grp;
    }

    function createFinancesLogo() {
        var grp = new THREE.Group();

        // Coin face texture
        var tc = document.createElement('canvas');
        tc.width = 256; tc.height = 256;
        var ctx = tc.getContext('2d');
        var g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        g.addColorStop(0, '#FFD700'); g.addColorStop(0.6, '#DAA520'); g.addColorStop(1, '#B8860B');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
        ctx.font = '900 150px Inter, Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8B6914'; ctx.fillText('$', 128, 132);
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillText('$', 126, 130);
        var coinTex = new THREE.CanvasTexture(tc);

        // Rim (open-ended cylinder)
        var coinSegs = isMobile ? 24 : 48;
        var rimGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.14, coinSegs, 1, true);
        rimGeo.rotateX(Math.PI / 2);
        var rimMat = new THREE.MeshStandardMaterial({ color: 0xB8860B, roughness: 0.3, metalness: 0.55 });
        grp.add(new THREE.Mesh(rimGeo, rimMat));

        // Front face
        var faceGeo = new THREE.CircleGeometry(0.7, coinSegs);
        var faceMat = new THREE.MeshStandardMaterial({
            map: coinTex, roughness: 0.3, metalness: 0.45, emissive: 0xDAA520, emissiveIntensity: 0.08
        });
        var front = new THREE.Mesh(faceGeo, faceMat);
        front.position.z = 0.07;
        grp.add(front);

        // Back face
        var back = new THREE.Mesh(faceGeo.clone(), faceMat);
        back.position.z = -0.07;
        back.rotation.y = Math.PI;
        grp.add(back);

        // Edge bevel ring
        var ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.7, 0.022, isMobile ? 4 : 8, coinSegs),
            new THREE.MeshStandardMaterial({ color: 0xB8860B, roughness: 0.3, metalness: 0.6 })
        );
        ring.position.z = 0.07;
        grp.add(ring);
        var ring2 = ring.clone(); ring2.position.z = -0.07;
        grp.add(ring2);

        return grp;
    }

    function createLogo(page) {
        switch (page) {
            case 'notes':    return createNotesLogo();
            case 'trading':  return createTradingLogo();
            case 'social':   return createYouTubeLogo(); // reuse the play-icon glyph for now
            case 'finances': return createFinancesLogo();
            default:         return new THREE.Group();
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  3D ANIMAL LOGO BUILDERS (for YouTube channel planets)
    // ════════════════════════════════════════════════════════════════════════

    function createAnimalLogo(animalType, color) {
        switch (animalType) {
            case 'wolf':    return createWolfLogo(color);
            case 'bear':    return createBearLogo(color);
            case 'eagle':   return createEagleLogo(color);
            case 'fox':     return createFoxLogo(color);
            case 'cat':     return createCatLogo(color);
            case 'owl':     return createOwlLogo(color);
            case 'lion':    return createLionLogo(color);
            case 'penguin': return createPenguinLogo(color);
            default:        return createBearLogo(color);
        }
    }

    function createWolfLogo(color) {
        var grp = new THREE.Group();
        var mat = new THREE.MeshStandardMaterial({ color: color || 0x8899aa, roughness: 0.4, emissive: color || 0x8899aa, emissiveIntensity: 0.3 });
        var darkMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.5, emissive: color || 0x556677, emissiveIntensity: 0.15 });
        grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), mat));
        var snout = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 6), mat);
        snout.rotation.x = Math.PI / 2;
        snout.position.set(0, -0.1, 0.45);
        grp.add(snout);
        var ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 4), darkMat);
        ear1.position.set(-0.25, 0.4, 0);
        grp.add(ear1);
        var ear2 = ear1.clone();
        ear2.position.set(0.25, 0.4, 0);
        grp.add(ear2);
        var eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.3 });
        var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
        eye1.position.set(-0.15, 0.08, 0.38);
        grp.add(eye1);
        var eye2 = eye1.clone();
        eye2.position.set(0.15, 0.08, 0.38);
        grp.add(eye2);
        return grp;
    }

    function createBearLogo(color) {
        var grp = new THREE.Group();
        var mat = new THREE.MeshStandardMaterial({ color: color || 0x8B6914, roughness: 0.5, emissive: color || 0x8B6914, emissiveIntensity: 0.3 });
        grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), mat));
        var ear1 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), mat);
        ear1.position.set(-0.35, 0.38, 0);
        grp.add(ear1);
        var ear2 = ear1.clone();
        ear2.position.set(0.35, 0.38, 0);
        grp.add(ear2);
        var snoutMat = new THREE.MeshStandardMaterial({ color: 0xd4a76a, roughness: 0.5 });
        var snout = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), snoutMat);
        snout.position.set(0, -0.08, 0.4);
        snout.scale.set(1, 0.8, 0.8);
        grp.add(snout);
        var noseMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        var nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), noseMat);
        nose.position.set(0, -0.02, 0.55);
        grp.add(nose);
        var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), noseMat);
        eye1.position.set(-0.15, 0.1, 0.42);
        grp.add(eye1);
        var eye2 = eye1.clone();
        eye2.position.set(0.15, 0.1, 0.42);
        grp.add(eye2);
        return grp;
    }

    function createEagleLogo(color) {
        var grp = new THREE.Group();
        var mat = new THREE.MeshStandardMaterial({ color: color || 0xdddddd, roughness: 0.4, emissive: color || 0xdddddd, emissiveIntensity: 0.3 });
        var darkMat = new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.5, emissive: color || 0x5C4033, emissiveIntensity: 0.15 });
        var body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), mat);
        body.scale.set(1, 0.8, 1.2);
        grp.add(body);
        var head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mat);
        head.position.set(0, 0.3, 0.2);
        grp.add(head);
        var beakMat = new THREE.MeshStandardMaterial({ color: 0xffa500, roughness: 0.3 });
        var beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 5), beakMat);
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, 0.25, 0.42);
        grp.add(beak);
        var wingShape = new THREE.Shape();
        wingShape.moveTo(0, 0); wingShape.lineTo(0.6, 0.15); wingShape.lineTo(0.55, -0.1); wingShape.lineTo(0.1, -0.15); wingShape.closePath();
        var wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.03, bevelEnabled: false });
        var wing1 = new THREE.Mesh(wingGeo, darkMat);
        wing1.position.set(0.2, 0, 0);
        wing1.rotation.z = 0.3;
        grp.add(wing1);
        var wing2 = wing1.clone();
        wing2.scale.x = -1;
        wing2.position.set(-0.2, 0, 0);
        grp.add(wing2);
        var eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.2 });
        var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
        eye1.position.set(-0.1, 0.34, 0.36);
        grp.add(eye1);
        var eye2 = eye1.clone();
        eye2.position.set(0.1, 0.34, 0.36);
        grp.add(eye2);
        return grp;
    }

    function createFoxLogo(color) {
        var grp = new THREE.Group();
        var mat = new THREE.MeshStandardMaterial({ color: color || 0xff6633, roughness: 0.4, emissive: color || 0xff6633, emissiveIntensity: 0.3 });
        var whiteMat = new THREE.MeshStandardMaterial({ color: 0xffeedd, roughness: 0.5 });
        grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), mat));
        var ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 4), mat);
        ear1.position.set(-0.25, 0.42, 0);
        grp.add(ear1);
        var ear2 = ear1.clone();
        ear2.position.set(0.25, 0.42, 0);
        grp.add(ear2);
        var face = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), whiteMat);
        face.position.set(0, -0.08, 0.25);
        face.scale.set(0.8, 0.7, 0.5);
        grp.add(face);
        var noseMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        var nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), noseMat);
        nose.position.set(0, -0.06, 0.45);
        grp.add(nose);
        var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), noseMat);
        eye1.position.set(-0.13, 0.08, 0.35);
        grp.add(eye1);
        var eye2 = eye1.clone();
        eye2.position.set(0.13, 0.08, 0.35);
        grp.add(eye2);
        return grp;
    }

    function createCatLogo(color) {
        var grp = new THREE.Group();
        var mat = new THREE.MeshStandardMaterial({ color: color || 0xaa88cc, roughness: 0.4, emissive: color || 0xaa88cc, emissiveIntensity: 0.3 });
        grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), mat));
        var earShape = new THREE.Shape();
        earShape.moveTo(0, 0.22); earShape.lineTo(-0.12, 0); earShape.lineTo(0.12, 0); earShape.closePath();
        var earGeo = new THREE.ExtrudeGeometry(earShape, { depth: 0.04, bevelEnabled: false });
        var ear1 = new THREE.Mesh(earGeo, mat);
        ear1.position.set(-0.2, 0.35, -0.02);
        grp.add(ear1);
        var ear2 = ear1.clone();
        ear2.position.set(0.2, 0.35, -0.02);
        grp.add(ear2);
        var eyeMat = new THREE.MeshStandardMaterial({ color: 0x44ff88, emissive: 0x44ff88, emissiveIntensity: 0.2 });
        var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
        eye1.position.set(-0.14, 0.06, 0.35);
        grp.add(eye1);
        var eye2 = eye1.clone();
        eye2.position.set(0.14, 0.06, 0.35);
        grp.add(eye2);
        var noseMat = new THREE.MeshStandardMaterial({ color: 0xffaaaa });
        var nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), noseMat);
        nose.position.set(0, -0.04, 0.4);
        grp.add(nose);
        return grp;
    }

    function createOwlLogo(color) {
        var grp = new THREE.Group();
        var mat = new THREE.MeshStandardMaterial({ color: color || 0x8B7355, roughness: 0.5, emissive: color || 0x8B7355, emissiveIntensity: 0.3 });
        grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), mat));
        var eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffeedd });
        var eyePupil = new THREE.MeshStandardMaterial({ color: 0x111111 });
        var ew1 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), eyeWhite);
        ew1.position.set(-0.14, 0.08, 0.35);
        grp.add(ew1);
        var ew2 = ew1.clone();
        ew2.position.set(0.14, 0.08, 0.35);
        grp.add(ew2);
        var ep1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyePupil);
        ep1.position.set(-0.14, 0.08, 0.44);
        grp.add(ep1);
        var ep2 = ep1.clone();
        ep2.position.set(0.14, 0.08, 0.44);
        grp.add(ep2);
        var beakMat = new THREE.MeshStandardMaterial({ color: 0xffa500 });
        var beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), beakMat);
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, -0.04, 0.45);
        grp.add(beak);
        var tuft1 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), mat);
        tuft1.position.set(-0.25, 0.4, 0);
        tuft1.rotation.z = 0.3;
        grp.add(tuft1);
        var tuft2 = tuft1.clone();
        tuft2.position.set(0.25, 0.4, 0);
        tuft2.rotation.z = -0.3;
        grp.add(tuft2);
        return grp;
    }

    function createLionLogo(color) {
        var grp = new THREE.Group();
        var mat = new THREE.MeshStandardMaterial({ color: color || 0xDAA520, roughness: 0.4, emissive: color || 0xDAA520, emissiveIntensity: 0.3 });
        var maneMat = new THREE.MeshStandardMaterial({ color: 0xB8860B, roughness: 0.6, emissive: color || 0xB8860B, emissiveIntensity: 0.15 });
        var mane = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), maneMat);
        grp.add(mane);
        var head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 8), mat);
        head.position.z = 0.12;
        grp.add(head);
        var snout = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), mat);
        snout.position.set(0, -0.08, 0.42);
        snout.scale.set(1, 0.7, 0.7);
        grp.add(snout);
        var noseMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        grp.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), noseMat), { position: new THREE.Vector3(0, -0.04, 0.5) }));
        var eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.2 });
        var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
        eye1.position.set(-0.13, 0.08, 0.42);
        grp.add(eye1);
        var eye2 = eye1.clone();
        eye2.position.set(0.13, 0.08, 0.42);
        grp.add(eye2);
        return grp;
    }

    function createPenguinLogo(color) {
        var grp = new THREE.Group();
        var bodyColor = color || 0x4466aa;
        var blackMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4, emissive: bodyColor, emissiveIntensity: 0.3 });
        var whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.15 });
        var body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), blackMat);
        body.scale.set(0.85, 1.1, 0.8);
        grp.add(body);
        var belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), whiteMat);
        belly.position.set(0, -0.05, 0.15);
        belly.scale.set(0.7, 0.9, 0.5);
        grp.add(belly);
        var head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), blackMat);
        head.position.y = 0.42;
        grp.add(head);
        var eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 });
        var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
        eye1.position.set(-0.1, 0.45, 0.2);
        grp.add(eye1);
        var eye2 = eye1.clone();
        eye2.position.set(0.1, 0.45, 0.2);
        grp.add(eye2);
        var beakMat = new THREE.MeshStandardMaterial({ color: 0xff8c00, emissive: 0xff8c00, emissiveIntensity: 0.2 });
        var beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 5), beakMat);
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, 0.38, 0.28);
        grp.add(beak);
        return grp;
    }

    // ── Dynamic Channel Planets ───────────────────────────────────────────

    var channelPlanets = [];   // { group, glow, label, channelId }
    var channelGlows = [];

    function getChannelColor(index) {
        var colors = [0xFCA5A5, 0xA5B4FC, 0x86EFAC, 0xFDE68A, 0xF9A8D4, 0xA7F3D0, 0xC4B5FD, 0x93C5FD];
        return colors[index % colors.length];
    }

    function addChannelPlanets() {
        if (!scene || !labelsEl) return;
        if (typeof YouTube === 'undefined' || !YouTube.getChannels) return;
        var ytChannels = YouTube.getChannels();
        if (!ytChannels || ytChannels.length === 0) return;
        // Don't add duplicates
        if (channelPlanets.length > 0) return;

        var glowTex = createGlowTexture();
        var baseOrb = 11.0; // start orbit radius after the 4 main sections

        for (var i = 0; i < ytChannels.length; i++) {
            var ch = ytChannels[i];
            var animal = YouTube.getChannelAnimal(ch);
            var initials = YouTube.getChannelInitials(ch.name);
            var color = getChannelColor(i);
            var orbR = baseOrb + i * 1.8;
            var orbSpeed = 0.06 - i * 0.005;
            if (orbSpeed < 0.02) orbSpeed = 0.02;
            var orbTilt = (i % 2 === 0 ? 0.15 : -0.15) + (Math.random() - 0.5) * 0.1;

            var group = createAnimalLogo(animal, color);
            group.scale.setScalar(0.45);
            group.userData = {
                page: 'channel-detail', name: initials, idx: SECTIONS.length + i,
                channelId: ch.channelId,
                orbR: orbR, orbSpeed: orbSpeed, orbTilt: orbTilt,
                startAngle: (Math.PI * 2 / ytChannels.length) * i,
                logoScale: 0.45,
                scaleTarget: 1, scaleCurrent: 1
            };

            // Glow
            var gMat = new THREE.SpriteMaterial({
                map: glowTex, color: color, transparent: true,
                opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false
            });
            var gSprite = new THREE.Sprite(gMat);
            var baseGS = 0.45 * 4;
            gSprite.scale.setScalar(baseGS);
            gSprite.userData = {
                baseOpacity: 0.12, baseScale: baseGS,
                opacityTarget: 0.12, scaleTarget: baseGS,
                opacityCurrent: 0.12, scaleCurrent: baseGS
            };
            scene.add(gSprite);
            channelGlows.push(gSprite);

            scene.add(group);
            channelPlanets.push(group);
            planets.push(group);
            planetGlows.push(gSprite);

            // Orbit ring
            var pts = [];
            for (var a = 0; a <= Math.PI * 2 + 0.01; a += 0.06) {
                var lx = orbR * Math.cos(a), lz = orbR * Math.sin(a);
                pts.push(new THREE.Vector3(lx, lz * Math.sin(orbTilt), lz * Math.cos(orbTilt)));
            }
            var line = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.04, depthWrite: false })
            );
            scene.add(line);
            orbitLines.push(line);

            // Label
            var lbl = document.createElement('div');
            lbl.className = 'home-3d-label';
            lbl.textContent = initials;
            lbl.dataset.page = 'channel-detail';
            lbl.dataset.channelId = ch.channelId;
            labelsEl.appendChild(lbl);
            labelEls.push(lbl);
        }
    }

    // ── Planets (3D logos orbiting) ─────────────────────────────────────────

    function createPlanets() {
        var glowTex = createGlowTexture();

        for (var i = 0; i < SECTIONS.length; i++) {
            var s     = SECTIONS[i];
            var group = createLogo(s.page);
            group.scale.setScalar(s.logoScale);
            group.userData = {
                page: s.page, name: s.name, idx: i,
                orbR: s.orbR, orbSpeed: s.orbSpeed, orbTilt: s.orbTilt,
                startAngle: s.start, logoScale: s.logoScale,
                scaleTarget: 1, scaleCurrent: 1
            };

            // Glow sprite
            var gMat = new THREE.SpriteMaterial({
                map: glowTex, color: s.color, transparent: true,
                opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false
            });
            var gSprite = new THREE.Sprite(gMat);
            var baseGS = s.logoScale * 4;
            gSprite.scale.setScalar(baseGS);
            gSprite.userData = {
                baseOpacity: 0.14, baseScale: baseGS,
                opacityTarget: 0.14, scaleTarget: baseGS,
                opacityCurrent: 0.14, scaleCurrent: baseGS
            };
            scene.add(gSprite);
            planetGlows.push(gSprite);

            scene.add(group);
            planets.push(group);
        }
    }

    // ── Orbit Rings ─────────────────────────────────────────────────────────

    function createOrbitRings() {
        for (var i = 0; i < SECTIONS.length; i++) {
            var s = SECTIONS[i], pts = [];
            for (var a = 0; a <= Math.PI * 2 + 0.01; a += 0.04) {
                var lx = s.orbR * Math.cos(a), lz = s.orbR * Math.sin(a);
                pts.push(new THREE.Vector3(lx, lz * Math.sin(s.orbTilt), lz * Math.cos(s.orbTilt)));
            }
            var line = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.06, depthWrite: false })
            );
            scene.add(line);
            orbitLines.push(line);
        }
    }

    // ── Star Field ──────────────────────────────────────────────────────────

    function createStarField() {
        var n = isMobile ? 400 : 1000, pos = new Float32Array(n * 3);
        for (var i = 0; i < n; i++) {
            var th = Math.random() * Math.PI * 2;
            var ph = Math.acos(2 * Math.random() - 1);
            var r  = 30 + Math.random() * 60;
            pos[i*3] = r * Math.sin(ph) * Math.cos(th);
            pos[i*3+1] = r * Math.sin(ph) * Math.sin(th);
            pos[i*3+2] = r * Math.cos(ph);
        }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        starField = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0xffffff, size: 0.1, sizeAttenuation: true, transparent: true, opacity: 0.6
        }));
        scene.add(starField);
    }

    // ── Twinkling Stars ─────────────────────────────────────────────────────

    // Twinkling stars as a single Points object (1 draw call instead of 60+)
    var twinkleGeometry = null;
    var twinkleSizes = null;   // base sizes per star
    var twinklePhases = null;  // phase offsets
    var twinkleFreqs = null;   // twinkle frequencies

    function createTwinklingStars() {
        var numTwinkling = isMobile ? 20 : 60;
        var positions = new Float32Array(numTwinkling * 3);
        twinkleSizes = new Float32Array(numTwinkling);
        twinklePhases = new Float32Array(numTwinkling);
        twinkleFreqs = new Float32Array(numTwinkling);
        var sizes = new Float32Array(numTwinkling);

        for (var i = 0; i < numTwinkling; i++) {
            var th = Math.random() * Math.PI * 2;
            var ph = Math.acos(2 * Math.random() - 1);
            var r  = 35 + Math.random() * 50;
            positions[i * 3]     = r * Math.sin(ph) * Math.cos(th);
            positions[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
            positions[i * 3 + 2] = r * Math.cos(ph);
            var baseSize = 0.15 + Math.random() * 0.35;
            twinkleSizes[i] = baseSize;
            sizes[i] = baseSize;
            twinklePhases[i] = Math.random() * Math.PI * 2;
            twinkleFreqs[i] = 0.5 + Math.random() * 2.5;
        }

        twinkleGeometry = new THREE.BufferGeometry();
        twinkleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        twinkleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        var twinkleMaterial = new THREE.PointsMaterial({
            color: 0xFFFFFF, size: 0.3, sizeAttenuation: true,
            transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        var twinklePoints = new THREE.Points(twinkleGeometry, twinkleMaterial);
        scene.add(twinklePoints);
        twinklingStars.push({ points: twinklePoints });
    }

    var twinkleFrameCounter = 0;
    function updateTwinklingStars(t) {
        twinkleFrameCounter++;
        if (!twinkleGeometry || !twinkleSizes) return;
        // Update sizes to simulate twinkling — every 3rd frame is fine
        if (twinkleFrameCounter % 3 !== 0) return;
        var sizeAttr = twinkleGeometry.getAttribute('size');
        var arr = sizeAttr.array;
        for (var i = 0; i < arr.length; i++) {
            var val = Math.sin(t * twinkleFreqs[i] + twinklePhases[i]);
            arr[i] = twinkleSizes[i] * (0.3 + 0.7 * (val * 0.5 + 0.5));
        }
        sizeAttr.needsUpdate = true;
    }

    // ── Meteors ─────────────────────────────────────────────────────────────

    function spawnMeteor(t) {
        if (meteors.length >= 2) return;

        var glowTex = createGlowTexture();
        var group = new THREE.Group();

        // Random start position on the edge of the scene
        var angle1 = Math.random() * Math.PI * 2;
        var angle2 = (Math.random() - 0.5) * Math.PI * 0.6;
        var dist = 25 + Math.random() * 15;
        var startX = dist * Math.cos(angle2) * Math.cos(angle1);
        var startY = dist * Math.sin(angle2);
        var startZ = dist * Math.cos(angle2) * Math.sin(angle1);

        // Direction: generally toward the center area with some randomness
        var dirX = -startX * 0.7 + (Math.random() - 0.5) * 15;
        var dirY = -startY * 0.7 + (Math.random() - 0.5) * 10;
        var dirZ = -startZ * 0.7 + (Math.random() - 0.5) * 15;
        var dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
        var speed = 8 + Math.random() * 12;
        var vx = (dirX / dirLen) * speed;
        var vy = (dirY / dirLen) * speed;
        var vz = (dirZ / dirLen) * speed;

        group.position.set(startX, startY, startZ);

        // Head sprite - bright glowing point
        var headMat = new THREE.SpriteMaterial({
            map: glowTex, color: 0xFFEEDD, transparent: true,
            opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false
        });
        var headSprite = new THREE.Sprite(headMat);
        headSprite.scale.setScalar(0.15);
        group.add(headSprite);

        // Trail sprites - progressively fading/shrinking sprites
        var trailCount = 4;
        var trailSprites = [headSprite]; // include head in sprites for cleanup
        var trailData = [];
        for (var ti = 0; ti < trailCount; ti++) {
            var frac = (ti + 1) / trailCount;
            var trailColor = new THREE.Color().setHSL(0.08 - frac * 0.03, 1.0, 0.9 - frac * 0.3);
            var trailMat = new THREE.SpriteMaterial({
                map: glowTex, color: trailColor, transparent: true,
                opacity: 0.8 * (1 - frac * 0.85),
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            var trailSprite = new THREE.Sprite(trailMat);
            var trailScale = 0.12 * (1 - frac * 0.7);
            trailSprite.scale.setScalar(trailScale);
            trailSprite.position.set(0, 0, 0); // will be updated
            group.add(trailSprite);
            trailSprites.push(trailSprite);
            trailData.push({
                sprite: trailSprite,
                positions: [] // ring buffer of past head positions
            });
        }

        scene.add(group);

        var lifetime = 2 + Math.random() * 2;
        var meteorObj = {
            group: group,
            head: headSprite,
            sprites: trailSprites,
            trailData: trailData,
            posHistory: [], // array of {x,y,z}
            vx: vx, vy: vy, vz: vz,
            birthTime: t,
            lifetime: lifetime,
            alive: true
        };
        meteors.push(meteorObj);
    }

    function updateMeteors(t, dt) {
        // Spawn check
        if (t >= nextMeteorTime && meteors.length < 2) {
            spawnMeteor(t);
            nextMeteorTime = t + 5 + Math.random() * 7; // 5-12 seconds
        }

        for (var i = meteors.length - 1; i >= 0; i--) {
            var m = meteors[i];
            var age = t - m.birthTime;

            if (age >= m.lifetime) {
                // Remove
                if (m.group.parent) m.group.parent.remove(m.group);
                m.sprites.forEach(function (s) { if (s.material.map) s.material.map.dispose(); s.material.dispose(); });
                meteors.splice(i, 1);
                continue;
            }

            // Move
            m.group.position.x += m.vx * dt;
            m.group.position.y += m.vy * dt;
            m.group.position.z += m.vz * dt;

            // Store position history (world position of head)
            m.posHistory.unshift({
                x: m.group.position.x,
                y: m.group.position.y,
                z: m.group.position.z
            });
            // Keep only last 20 positions
            if (m.posHistory.length > 20) m.posHistory.length = 20;

            // Update trail sprites to follow historical positions
            for (var ti = 0; ti < m.trailData.length; ti++) {
                var spacing = 2 + ti; // how many frames back
                var histIdx = Math.min(spacing, m.posHistory.length - 1);
                if (histIdx >= 0 && m.posHistory[histIdx]) {
                    var hp = m.posHistory[histIdx];
                    // Convert world position to local (relative to group)
                    m.trailData[ti].sprite.position.set(
                        hp.x - m.group.position.x,
                        hp.y - m.group.position.y,
                        hp.z - m.group.position.z
                    );
                }
            }

            // Fade out near end of life
            var fadeStart = m.lifetime - 0.5;
            if (age > fadeStart) {
                var fadeFrac = 1 - (age - fadeStart) / 0.5;
                m.head.material.opacity = fadeFrac;
                for (var fi = 0; fi < m.trailData.length; fi++) {
                    var baseFrac = (fi + 1) / m.trailData.length;
                    m.trailData[fi].sprite.material.opacity = 0.8 * (1 - baseFrac * 0.85) * fadeFrac;
                }
            }
        }
    }

    // ── Supernovae (Star Explosions) ────────────────────────────────────────

    function spawnSupernova(t) {
        if (supernovae.length >= 2) return;

        var glowTex = createGlowTexture();

        // Random far position
        var th = Math.random() * Math.PI * 2;
        var ph = Math.acos(2 * Math.random() - 1);
        var r  = 30 + Math.random() * 40;
        var x = r * Math.sin(ph) * Math.cos(th);
        var y = r * Math.sin(ph) * Math.sin(th);
        var z = r * Math.cos(ph);

        // Random warm color: white, blue-white, orange
        var colorChoices = [
            new THREE.Color(1.0, 1.0, 1.0),       // white
            new THREE.Color(0.7, 0.8, 1.0),       // blue-white
            new THREE.Color(1.0, 0.6, 0.2)        // orange
        ];
        var color = colorChoices[Math.floor(Math.random() * colorChoices.length)];

        var mat = new THREE.SpriteMaterial({
            map: glowTex, color: color, transparent: true,
            opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false
        });
        var sprite = new THREE.Sprite(mat);
        sprite.position.set(x, y, z);
        sprite.scale.setScalar(0.01);
        scene.add(sprite);

        var targetScale = 3 + Math.random() * 2; // 3-5
        var fadeOutDuration = 2 + Math.random() * 1; // 2-3 seconds

        supernovae.push({
            sprite: sprite,
            birthTime: t,
            expandDuration: 0.3,
            fadeOutDuration: fadeOutDuration,
            targetScale: targetScale,
            phase: 'expand', // 'expand', 'flash', 'fade'
            alive: true
        });
    }

    function updateSupernovae(t) {
        // Spawn check
        if (t >= nextSupernovaTime && supernovae.length < 2) {
            spawnSupernova(t);
            nextSupernovaTime = t + 5 + Math.random() * 7; // 5-12 seconds
        }

        for (var i = supernovae.length - 1; i >= 0; i--) {
            var sn = supernovae[i];
            var age = t - sn.birthTime;

            if (sn.phase === 'expand') {
                // Rapidly scale up from 0 to targetScale over 0.3 seconds
                var expandFrac = Math.min(age / sn.expandDuration, 1.0);
                // Ease out
                var easedFrac = 1 - (1 - expandFrac) * (1 - expandFrac);
                sn.sprite.scale.setScalar(sn.targetScale * easedFrac);
                sn.sprite.material.opacity = easedFrac;

                if (expandFrac >= 1.0) {
                    sn.phase = 'flash';
                    sn.flashStart = t;
                }
            } else if (sn.phase === 'flash') {
                // Brief bright flash: opacity 1 for 0.1 seconds
                var flashAge = t - sn.flashStart;
                if (flashAge < 0.1) {
                    sn.sprite.material.opacity = 1.0;
                    sn.sprite.scale.setScalar(sn.targetScale * (1 + flashAge * 3));
                } else {
                    sn.phase = 'fade';
                    sn.fadeStart = t;
                }
            } else if (sn.phase === 'fade') {
                // Slowly fade out over fadeOutDuration
                var fadeFrac = (t - sn.fadeStart) / sn.fadeOutDuration;
                if (fadeFrac >= 1.0) {
                    // Remove
                    if (sn.sprite.parent) sn.sprite.parent.remove(sn.sprite);
                    if (sn.sprite.material.map) sn.sprite.material.map.dispose();
                    sn.sprite.material.dispose();
                    supernovae.splice(i, 1);
                    continue;
                }
                sn.sprite.material.opacity = 1.0 - fadeFrac;
                // Slightly continue expanding while fading
                sn.sprite.scale.setScalar(sn.targetScale * (1.0 + fadeFrac * 0.5));
            }
        }
    }

    // ── Space Dust ──────────────────────────────────────────────────────────

    function createDust() {
        var pal = [0xC4B5FD, 0x86EFAC, 0xFCA5A5, 0x93C5FD, 0xFDE68A];
        var dustCount = isMobile ? 4 : 10;
        for (var i = 0; i < dustCount; i++) {
            var sz = 0.03 + Math.random() * 0.06;
            var gt = Math.floor(Math.random() * 3);
            var geo = gt === 0 ? new THREE.IcosahedronGeometry(sz,0) : gt === 1 ? new THREE.OctahedronGeometry(sz,0) : new THREE.TetrahedronGeometry(sz,0);
            var gl = (i % 3 === 0);
            var mat = new THREE.MeshStandardMaterial({
                color: pal[Math.floor(Math.random()*pal.length)], roughness: gl?0.3:0.8,
                emissive: gl ? pal[Math.floor(Math.random()*pal.length)] : 0x000000,
                emissiveIntensity: gl?0.5:0
            });
            if (gl) { mat.transparent = true; mat.opacity = 0.7; mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; }
            var m = new THREE.Mesh(geo, mat);
            m.position.set((Math.random()-0.5)*24, (Math.random()-0.5)*14, (Math.random()-0.5)*16-4);
            m.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
            m.userData = { rx:(Math.random()-0.5)*0.01, ry:(Math.random()-0.5)*0.01, phase:Math.random()*Math.PI*2, speed:0.2+Math.random()*0.4, amp:0.15+Math.random()*0.3, baseY:m.position.y };
            scene.add(m); dustParticles.push(m);
        }
    }

    // ── Labels ──────────────────────────────────────────────────────────────

    function createLabels() {
        if (!labelsEl) return;
        labelsEl.innerHTML = ''; labelEls = [];
        for (var i = 0; i < SECTIONS.length; i++) {
            var el = document.createElement('div');
            el.className = 'home-3d-label';
            el.textContent = SECTIONS[i].name;
            labelsEl.appendChild(el); labelEls.push(el);
        }
    }

    var labelVec = null;
    var labelLastActive = -1;
    function updateLabels() {
        if (!labelsEl || !camera) return;
        var w = cachedWidth || containerEl.clientWidth;
        var h = cachedHeight || containerEl.clientHeight;
        if (!labelVec) labelVec = new THREE.Vector3();
        var v = labelVec;
        var len = Math.min(planets.length, labelEls.length);
        var hovIdx = -1;
        for (var i = 0; i < len; i++) {
            var p = planets[i];
            v.copy(p.position); v.y -= 1.2;
            v.project(camera);
            var sx = (v.x * 0.5 + 0.5) * w;
            var sy = (v.y * -0.5 + 0.5) * h;
            var dist = camera.position.distanceTo(p.position);
            var fade = dist < orbit.radius - 10 ? 1.0 : dist > orbit.radius + 12 ? 0.25 : 0.25 + 0.75 * (1 - (dist - (orbit.radius - 10)) / 22);
            labelEls[i].style.transform = 'translate(-50%,-50%) translate(' + (sx | 0) + 'px,' + (sy | 0) + 'px)';
            labelEls[i].style.opacity = fade;
            if (hoveredPlanet === p) hovIdx = i;
        }
        // Only toggle active class when hovered planet changes
        if (hovIdx !== labelLastActive) {
            if (labelLastActive >= 0 && labelLastActive < len) labelEls[labelLastActive].classList.remove('active');
            if (hovIdx >= 0) labelEls[hovIdx].classList.add('active');
            labelLastActive = hovIdx;
        }
    }

    // ── Find planet group from raycasted child ──────────────────────────────

    function findPlanetGroup(obj) {
        while (obj) {
            if (obj.userData && obj.userData.page) return obj;
            obj = obj.parent;
        }
        return null;
    }

    // ── Animation ───────────────────────────────────────────────────────────

    var lastFrameTime = 0;

    function animate() {
        if (!isActive) return;
        animId = requestAnimationFrame(animate);
        var t = performance.now() * 0.001;
        var dt = Math.min(t - lastFrameTime, 0.05);
        lastFrameTime = t;

        // Zoom transition overrides normal camera
        if (isZooming) {
            updateZoom(t);
        } else {
            // Smooth orbit camera
            orbit.theta  += (orbit.targetTheta  - orbit.theta)  * 0.08;
            orbit.phi    += (orbit.targetPhi    - orbit.phi)    * 0.08;
            orbit.radius += (orbit.targetRadius - orbit.radius) * 0.08;
            mouseLerp.x  += (mouseTarget.x - mouseLerp.x) * 0.03;
            mouseLerp.y  += (mouseTarget.y - mouseLerp.y) * 0.03;

            var r = orbit.radius;
            var sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
            var st = Math.sin(orbit.theta), ct = Math.cos(orbit.theta);
            camera.position.x = r * sp * st + mouseLerp.x * 0.8;
            camera.position.y = r * cp      + mouseLerp.y * 0.4;
            camera.position.z = r * sp * ct;
            camera.lookAt(0, 0, 0);
        }

        // Sun - multiple sine waves for flickering/pulsing
        if (sun) {
            sun.rotation.y = t * 0.15;
            var flicker = 0.9
                + Math.sin(t * 0.5) * 0.15
                + Math.sin(t * 1.3) * 0.08
                + Math.sin(t * 3.7) * 0.04
                + Math.sin(t * 7.1) * 0.02;
            sun.material.emissiveIntensity = flicker;
        }

        // Sun corona - animate opacity and slight rotation
        if (sunCorona) {
            sunCorona.rotation.y = t * 0.1;
            if (!isMobile) sunCorona.rotation.x = t * 0.07;
            sunCorona.material.opacity = 0.2 + Math.sin(t * 0.8) * 0.08;
        }

        // Sun glows - layered animation (simplified on mobile)
        if (sunGlowCore) {
            sunGlowCore.scale.setScalar(4.5 + Math.sin(t * 0.7) * 0.5);
            sunGlowCore.material.opacity = 0.55;
        }
        if (sunGlow) {
            sunGlow.scale.setScalar(7.5 + Math.sin(t * 0.4) * 0.8);
            if (!isMobile) sunGlow.material.opacity = 0.3 + Math.sin(t * 0.6) * 0.08;
        }
        if (sunGlowOuter) {
            sunGlowOuter.scale.setScalar(13 + Math.sin(t * 0.3) * 1.5);
            if (!isMobile) sunGlowOuter.material.opacity = 0.12 + Math.sin(t * 0.5) * 0.04;
        }

        // Solar flares - erratic orbiting around the sun
        for (var fi = 0; fi < solarFlares.length; fi++) {
            var flare = solarFlares[fi];
            var fd = flare.userData;
            fd.theta += fd.speedTheta * dt;
            fd.phi += fd.speedPhi * dt;
            // Add some wobble
            var wobble = Math.sin(t * fd.wobbleSpeed + fd.wobblePhase) * fd.wobbleAmp;
            var fRadius = fd.orbitRadius + wobble;
            var fPhi = fd.phi;
            var fTheta = fd.theta;
            flare.position.x = fRadius * Math.cos(fPhi) * Math.cos(fTheta);
            flare.position.y = fRadius * Math.sin(fPhi);
            flare.position.z = fRadius * Math.cos(fPhi) * Math.sin(fTheta);
            // Flicker opacity — deterministic (no Math.random in hot loop)
            flare.material.opacity = (0.3 + Math.sin(t * 5.7 + fi * 2.3) * 0.2 + 0.2) * (0.6 + Math.sin(t * 4 + fi) * 0.4);
        }

        // Planets orbit
        for (var i = 0; i < planets.length; i++) {
            var p = planets[i], d = p.userData;
            var angle = d.startAngle + t * d.orbSpeed;
            var lx = d.orbR * Math.cos(angle), lz = d.orbR * Math.sin(angle);
            p.position.x = lx;
            p.position.y = lz * Math.sin(d.orbTilt);
            p.position.z = lz * Math.cos(d.orbTilt);

            // Face camera but with a continuous slow spin so all sides are visible
            p.lookAt(camera.position);
            p.rotateY(Math.PI);          // flip front face toward camera
            p.rotateY(t * 0.5 + i * 1.5); // continuous spin
            if (!isMobile) p.rotateX(Math.sin(t * 0.4 + i * 1.2) * 0.12); // gentle tilt (skip on mobile)

            // Scale lerp
            d.scaleCurrent += (d.scaleTarget - d.scaleCurrent) * 0.1;
            p.scale.setScalar(d.logoScale * d.scaleCurrent);

            // Glow follows
            var g = planetGlows[i], gd = g.userData;
            g.position.copy(p.position);
            gd.opacityCurrent += (gd.opacityTarget - gd.opacityCurrent) * 0.08;
            gd.scaleCurrent   += (gd.scaleTarget   - gd.scaleCurrent)   * 0.08;
            g.material.opacity = gd.opacityCurrent;
            g.scale.setScalar(gd.scaleCurrent);
            if (!isMobile && hoveredPlanet === p) g.scale.setScalar(gd.scaleCurrent * (1 + Math.sin(t * 3) * 0.06));
        }

        // Dust — skip on mobile every other frame
        if (!isMobile || twinkleFrameCounter % 2 === 0) {
            for (var j = 0; j < dustParticles.length; j++) {
                var dp = dustParticles[j], dd = dp.userData;
                dp.rotation.x += dd.rx; dp.rotation.y += dd.ry;
                dp.position.y = dd.baseY + Math.sin(t * dd.speed + dd.phase) * dd.amp;
            }
        }

        if (starField) starField.rotation.y = t * 0.002;

        // Update new effects — skip expensive ones on mobile
        updateTwinklingStars(t);
        if (!isMobile) {
            updateMeteors(t, dt);
            updateSupernovae(t);
        }

        // Raycast (recursive into groups)
        var shouldRaycast = isMobile ? (twinkleFrameCounter % 6 === 0) : true;
        var newHov = hoveredPlanet; // keep current if skipping
        if (shouldRaycast) {
            raycaster.setFromCamera(mouse, camera);
            var hits = raycaster.intersectObjects(planets, true);
            newHov = hits.length > 0 ? findPlanetGroup(hits[0].object) : null;
        }

        if (newHov !== hoveredPlanet) {
            if (hoveredPlanet) {
                hoveredPlanet.userData.scaleTarget = 1;
                var oi = hoveredPlanet.userData.idx;
                planetGlows[oi].userData.opacityTarget = planetGlows[oi].userData.baseOpacity;
                planetGlows[oi].userData.scaleTarget   = planetGlows[oi].userData.baseScale;
            }
            if (newHov) {
                newHov.userData.scaleTarget = 1.3;
                var ni = newHov.userData.idx;
                planetGlows[ni].userData.opacityTarget = 0.45;
                planetGlows[ni].userData.scaleTarget   = planetGlows[ni].userData.baseScale * 1.5;
            }
            hoveredPlanet = newHov;
            renderer.domElement.style.cursor = hoveredPlanet ? 'pointer' : '';
        }

        // Update labels
        {
            updateLabels();
        }
        renderer.render(scene, camera);
    }

    // ── Events ──────────────────────────────────────────────────────────────

    var cachedRect = null;
    var rectCacheTime = 0;
    function onMouseMove(e) {
        // Cache rect for 500ms to avoid layout thrashing
        var now = performance.now();
        if (!cachedRect || now - rectCacheTime > 500) {
            cachedRect = containerEl.getBoundingClientRect();
            rectCacheTime = now;
        }
        var rect = cachedRect;
        mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

        if (orbit.isDragging) {
            var dx = e.clientX - orbit.lastX;
            var dy = e.clientY - orbit.lastY;
            orbit.targetTheta -= dx * 0.005;
            orbit.targetPhi = Math.max(0.3, Math.min(Math.PI - 0.3, orbit.targetPhi - dy * 0.005));
            orbit.lastX = e.clientX;
            orbit.lastY = e.clientY;
        } else {
            mouseTarget.x = (e.clientX / window.innerWidth)  * 2 - 1;
            mouseTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
        }
    }

    function onMouseDown(e) {
        if (e.button === 2) {
            orbit.isDragging = true;
            orbit.lastX = e.clientX;
            orbit.lastY = e.clientY;
            e.preventDefault();
        }
    }

    function onMouseUp(e) {
        if (e.button === 2) orbit.isDragging = false;
    }

    function onContextMenu(e) { e.preventDefault(); }

    function onWheel(e) {
        e.preventDefault();
        orbit.targetRadius = Math.max(8, Math.min(55, orbit.targetRadius + e.deltaY * 0.025));
    }

    // ── Zoom Transition ─────────────────────────────────────────────────

    function createTransitionOverlay() {
        if (transitionOverlay) return transitionOverlay;
        transitionOverlay = document.createElement('div');
        transitionOverlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(10,10,20,0);pointer-events:none;transition:none;';
        document.body.appendChild(transitionOverlay);
        return transitionOverlay;
    }

    function startZoomTo(planet) {
        if (isZooming || !planet) return;
        isZooming = true;
        zoomTarget = planet;
        zoomPage = planet.userData.page;
        zoomStartTime = performance.now() * 0.001;
        zoomStartPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

        createTransitionOverlay();
    }

    function updateZoom(t) {
        if (!isZooming) return;

        var elapsed = t - zoomStartTime;
        var progress = Math.min(elapsed / zoomDuration, 1.0);

        // Ease in-out cubic
        var ease = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // Recompute end position based on current planet position (it orbits)
        var px = zoomTarget.position.x, py = zoomTarget.position.y, pz = zoomTarget.position.z;
        var dx = zoomStartPos.x - px, dy = zoomStartPos.y - py, dz = zoomStartPos.z - pz;
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var closeDist = 1.5;
        var ex = px + (dx / dist) * closeDist;
        var ey = py + (dy / dist) * closeDist;
        var ez = pz + (dz / dist) * closeDist;

        // Interpolate camera position
        camera.position.x = zoomStartPos.x + (ex - zoomStartPos.x) * ease;
        camera.position.y = zoomStartPos.y + (ey - zoomStartPos.y) * ease;
        camera.position.z = zoomStartPos.z + (ez - zoomStartPos.z) * ease;

        // Look at the planet (not origin)
        camera.lookAt(px, py, pz);

        // Fade overlay in during last 40% of zoom
        if (transitionOverlay && progress > 0.6) {
            var fadeProg = (progress - 0.6) / 0.4;
            transitionOverlay.style.background = 'rgba(10,10,20,' + fadeProg.toFixed(3) + ')';
        }

        // Done
        if (progress >= 1.0) {
            var page = zoomPage;
            var chId = zoomTarget && zoomTarget.userData ? zoomTarget.userData.channelId : null;
            // Reset zoom state
            isZooming = false;
            zoomTarget = null;
            zoomPage = null;

            // Navigate after a tiny delay for the full fade
            setTimeout(function () {
                if (typeof App !== 'undefined' && App.navigateTo) {
                    if (page === 'channel-detail' && chId && typeof YouTube !== 'undefined' && YouTube.openChannelDetail) {
                        YouTube.openChannelDetail(chId);
                    } else {
                        App.navigateTo(page);
                    }
                }
                // Fade overlay back out
                if (transitionOverlay) {
                    transitionOverlay.style.transition = 'background 0.4s ease';
                    transitionOverlay.style.background = 'rgba(10,10,20,0)';
                    setTimeout(function () {
                        if (transitionOverlay) {
                            transitionOverlay.style.transition = 'none';
                        }
                    }, 450);
                }
            }, 50);
        }
    }

    function onClick(e) {
        if (e.button !== 0) return;
        if (isZooming) return;
        if (hoveredPlanet && typeof App !== 'undefined' && App.navigateTo) {
            startZoomTo(hoveredPlanet);
        }
    }

    function onTouch(e) {
        if (isZooming) return;
        var touch = e.touches[0];
        var rect = containerEl.getBoundingClientRect();
        mouse.x =  ((touch.clientX - rect.left) / rect.width)  * 2 - 1;
        mouse.y = -((touch.clientY - rect.top)  / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        var hits = raycaster.intersectObjects(planets, true);
        if (hits.length > 0) {
            var grp = findPlanetGroup(hits[0].object);
            if (grp) startZoomTo(grp);
        }
    }

    var cachedWidth = 0, cachedHeight = 0;
    function onResize() {
        if (!containerEl || !camera || !renderer) return;
        cachedWidth = containerEl.clientWidth;
        cachedHeight = containerEl.clientHeight;
        camera.aspect = cachedWidth / cachedHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(cachedWidth, cachedHeight);
        orbit.targetRadius = baseRadius();
        cachedRect = null; // invalidate mousemove rect cache
    }

    function bindEvents() {
        containerEl.addEventListener('mousemove', onMouseMove, { passive: true });
        containerEl.addEventListener('mousedown', onMouseDown);
        containerEl.addEventListener('mouseup', onMouseUp);
        containerEl.addEventListener('click', onClick);
        containerEl.addEventListener('contextmenu', onContextMenu);
        containerEl.addEventListener('wheel', onWheel, { passive: false });
        containerEl.addEventListener('touchstart', onTouch, { passive: true });
        window.addEventListener('resize', onResize);
    }

    // ── Auto-init ───────────────────────────────────────────────────────────

    function autoInit() {
        var hp = document.getElementById('home-page');
        if (hp && hp.classList.contains('active')) init();
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', autoInit);
    else
        autoInit();

    return { init: init, destroy: destroy, refreshChannelPlanets: addChannelPlanets };
})();