import { Scene } from "phaser";

// Stand data type — mirrors your Supabase table
interface StandData {
  id: string;
  participant_name: string;
  description: string;
  category: string;
  instagram?: string;
}

export class Game extends Scene {
  private map!: Phaser.Tilemaps.Tilemap;
  private tileset!: Phaser.Tilemaps.Tileset;
  private floorLayer!: Phaser.Tilemaps.TilemapLayer;
  private structuresLayer!: Phaser.Tilemaps.TilemapLayer; // your "Objects" tile layer

  // Player
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  // Touch movement
  private touchStartX = 0;
  private touchStartY = 0;
  private touchActive = false;
  private touchDeltaX = 0;
  private touchDeltaY = 0;
  private touchDeadzone = 12; // computed from screen size in create()
  private touchDecay = 0; // 1.0 → 0 over several frames after finger lift
  private readonly TOUCH_DECAY_RATE = 0.12;
  private lastMoveByTouch = false;
  private dragIndicator: Phaser.GameObjects.Arc | null = null;

  // Stands
  private standsLayer!: Phaser.Tilemaps.ObjectLayer;
  private activeStand: string | null = null;
  private standDataCache: Map<string, StandData> = new Map();

  // UI
  private standPopup!: Phaser.GameObjects.Container;
  private isPopupOpen = false;
  private closeBtnBounds = { x: 0, y: 0, halfSize: 22 };
  private popupBounds = { top: 0, bottom: 0, left: 0, right: 0 };

  // Zone-exit tracking (prevents popup from reopening while player stays in zone)
  private currentOverlaps = new Set<string>();
  private previousOverlaps = new Set<string>();

  // Constants
  private readonly PLAYER_SPEED = 160;

  constructor() {
    super("Game");
  }

  preload() {
    // Load the map and tileset
    this.load.tilemapTiledJSON("map", "assets/map_glitter.json");
    this.load.image("tileset1", "assets/tileset.png");

    // Load the player spritesheet
    // Assumes a 32x48 sprite with 12 frames: 3 per direction (down, left, right, up)
    this.load.spritesheet("player", "assets/entities/federico.png", {
      frameWidth: 32,
      frameHeight: 52,
    });
  }

  create() {
    this.createMap();
    this.createPlayer();
    this.createAnimations();
    this.createCamera();
    this.createStandInteractions();
    this.createUI();
    this.touchDeadzone = Math.min(this.scale.width, this.scale.height) * 0.025;
    this.setupInput();
  }

  private createMap() {
    this.map = this.make.tilemap({ key: "map" });

    // "tileset1" = key from preload, "tileset1" = name inside the .tsx file
    const tileset = this.map.addTilesetImage("tileset1", "tileset1");
    if (!tileset) throw new Error("Failed to load tileset");
    this.tileset = tileset;

    // Create tile layers — names must match exactly what's in your .tmj
    this.floorLayer = this.map.createLayer("Floor", this.tileset, 0, 0)!;

    // Your booth/wall tile layer
    this.structuresLayer = this.map.createLayer(
      "Structures",
      this.tileset,
      0,
      0,
    )!;

    // Enable collisions using the "collides" property you set in the tileset
    this.structuresLayer.setCollisionByProperty({ collides: true });

    // Get the object layer (not a tile layer — this is your stand zones)
    const standsLayer = this.map.getObjectLayer("Stands");
    if (!standsLayer) throw new Error("Stands object layer not found");
    this.standsLayer = standsLayer;
  }

  private createPlayer() {
    // Find the spawn point defined in Tiled (add a point object named "spawn" in your map)
    const spawnPoint = this.map.findObject(
      "Stands",
      (obj) => obj.name === "spawn",
    );

    const spawnX = spawnPoint?.x ?? 640; // fallback to map center
    const spawnY = spawnPoint?.y ?? 480;

    this.player = this.physics.add
      .sprite(spawnX, spawnY, "player", 0)
      .setOrigin(0, 1)
      .setScale(2)
      .setDepth(2);
    this.player.setCollideWorldBounds(true);

    // Player hitbox — make it smaller than the sprite for better feel
    // A 32x48 sprite with a 20x16 hitbox at the feet
    this.player.body?.setSize(20, 16);
    this.player.body?.setOffset(6, 28); // offset pushes hitbox to the bottom of the sprite
  }

  private createAnimations() {
    // Walk down — frames 0, 1, 2
    this.anims.create({
      key: "walk-down",
      frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }),
      frameRate: 8,
      repeat: -1,
    });

    // Walk left — frames 3, 4, 5
    this.anims.create({
      key: "walk-left",
      frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }),
      frameRate: 8,
      repeat: -1,
    });

    // Walk right — frames 6, 7, 8
    this.anims.create({
      key: "walk-right",
      frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }),
      frameRate: 8,
      repeat: -1,
    });

    // Walk up — frames 9, 10, 11
    this.anims.create({
      key: "walk-up",
      frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }),
      frameRate: 8,
      repeat: -1,
    });

    // Idle — just frame 0 (facing down, standing still)
    this.anims.create({
      key: "idle",
      frames: [{ key: "player", frame: 0 }],
      frameRate: 1,
    });
  }

  // ─── CAMERA ──────────────────────────────────────────────────────────────

  private createCamera() {
    // Set world bounds to match the full map size (40 * 32 = 1280, 30 * 32 = 960)
    this.physics.world.setBounds(
      0,
      0,
      this.map.widthInPixels,
      this.map.heightInPixels,
    );

    this.cameras.main.setBounds(
      0,
      0,
      this.map.widthInPixels,
      this.map.heightInPixels,
    );
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1); // 0.1 = smooth follow
    this.cameras.main.setZoom(1.5); // zoom in for mobile readability
  }

  // ─── STAND INTERACTIONS ──────────────────────────────────────────────────

  private createStandInteractions() {
    // Add collider between player and the structure tiles
    this.physics.add.collider(this.player, this.structuresLayer);

    // For each stand zone object, create an invisible physics zone
    this.standsLayer.objects.forEach((standObj) => {
      if (!standObj.name || standObj.name === "spawn") return;

      const zone = this.add.zone(
        standObj.x! + standObj.width! / 2, // Phaser zones are centered
        standObj.y! + standObj.height! / 2,
        standObj.width!,
        standObj.height!,
      );

      this.physics.world.enable(zone);
      (zone.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
      (zone.body as Phaser.Physics.Arcade.Body).moves = false;

      // When player overlaps a stand zone, trigger the interaction
      this.physics.add.overlap(this.player, zone, () => {
        if (standObj.name) this.currentOverlaps.add(standObj.name);
        if (!this.isPopupOpen && this.activeStand !== standObj.name) {
          this.activeStand = standObj.name!;
          this.openStandPopup(standObj.name!);
        }
      });
    });
  }

  private async openStandPopup(standId: string) {
    this.isPopupOpen = true;
    this.touchActive = false;
    this.touchDecay = 0;
    this.touchDeltaX = 0;
    this.touchDeltaY = 0;
    this.dragIndicator?.setVisible(false);
    this.player.setVelocity(0, 0); // stop the player

    // Check cache first
    if (this.standDataCache.has(standId)) {
      this.showPopup(this.standDataCache.get(standId)!);
      return;
    }

    this.showLoading();

    // Fetch from your API — replace with your actual Next.js API route
    try {
      // const res = await fetch(`/api/stands/${standId}`)ß;
      // const data: StandData = await res.json();
      // this.standDataCache.set(standId, data); // cache it
      const data: StandData = {
        id: standId,
        participant_name: `Participant name in ${standId}`,
        description: `Description in ${standId}`,
        category: `Category in ${standId}`,
        instagram: `Instagram in ${standId}`,
      };
      this.showPopup(data);
    } catch (err) {
      console.error("Failed to fetch stand data:", err);
      this.isPopupOpen = false;
      this.activeStand = null;
    }
  }

  // ─── UI ──────────────────────────────────────────────────────────────────

  private createUI() {
    // Container is fixed to camera — always visible regardless of map scroll
    this.standPopup = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setVisible(false);

    // Drag indicator - follows pointer position while dragging
    this.dragIndicator = this.add
      .circle(0, 0, 24, 0xffffff, 0.25)
      .setScrollFactor(0)
      .setDepth(10)
      .setVisible(false);
  }

  private showPopup(data: StandData) {
    const { width, height } = this.scale;
    this.standPopup.removeAll(true);

    const popupWidth = Math.min(width - 32, 480);
    const centerX = width / 2;
    const padding = 16;
    const bottomMargin = 16;
    const baseFontSize = Math.min(
      14,
      Math.max(11, Math.round(Math.min(width, height) * 0.038)),
    );

    // ── Build content items at relY=0; shifted to final Y after measuring ──────
    const textItems: Phaser.GameObjects.Text[] = [];
    let relY = 0;

    // Avatar: colored circle + first initial
    const avatarRadius = Math.round(baseFontSize * 1.5);
    const avatarRelCenterY = relY + avatarRadius;
    const avatar = this.add.circle(
      centerX,
      avatarRelCenterY,
      avatarRadius,
      0xf5a623,
      0.25,
    );
    const avatarInitial = this.add
      .text(
        centerX,
        avatarRelCenterY,
        data.participant_name.charAt(0).toUpperCase(),
        {
          fontSize: `${Math.round(baseFontSize * 1.2)}px`,
          color: "#f5a623",
          fontStyle: "bold",
        },
      )
      .setOrigin(0.5);
    relY += avatarRadius * 2 + 12;

    const nameText = this.add
      .text(centerX, relY, data.participant_name, {
        fontSize: `${Math.round(baseFontSize * 1.2)}px`,
        color: "#f5a623",
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: popupWidth - padding * 2 },
      })
      .setOrigin(0.5, 0);
    relY += nameText.height + 6;
    textItems.push(nameText);

    const categoryText = this.add
      .text(centerX, relY, data.category, {
        fontSize: `${baseFontSize}px`,
        color: "#aaaaaa",
        align: "center",
      })
      .setOrigin(0.5, 0);
    relY += categoryText.height + 10;
    textItems.push(categoryText);

    const descText = this.add
      .text(centerX, relY, data.description, {
        fontSize: `${baseFontSize}px`,
        color: "#ffffff",
        wordWrap: { width: popupWidth - padding * 2 },
        align: "center",
      })
      .setOrigin(0.5, 0);
    relY += descText.height + 8;
    textItems.push(descText);

    if (data.instagram) {
      const igText = this.add
        .text(centerX, relY, `@${data.instagram}`, {
          fontSize: `${baseFontSize}px`,
          color: "#c084fc",
          align: "center",
        })
        .setOrigin(0.5, 0);
      relY += igText.height + 8;
      textItems.push(igText);
    }

    // ── Compute popup geometry ──────────────────────────────────────────────────
    const closeRowHeight = 44;
    const popupHeight = padding + closeRowHeight + padding + relY + padding;
    // Clamp so popup never extends above the top of the screen
    const popupTop = Math.max(
      bottomMargin,
      height - popupHeight - bottomMargin,
    );
    const popupCenterY = popupTop + popupHeight / 2;
    const contentStartY = popupTop + padding + closeRowHeight + padding;

    // Shift all content items to final Y positions
    avatar.setY(avatarRelCenterY + contentStartY);
    avatarInitial.setY(avatarRelCenterY + contentStartY);
    for (const item of textItems) {
      item.setY(item.y + contentStartY);
    }

    // ── Save bounds for scene-level click handling ─────────────────────────────
    const closeBtnX = centerX + popupWidth / 2 - padding - 10;
    const closeBtnY = popupTop + padding + closeRowHeight / 2;
    this.closeBtnBounds = { x: closeBtnX, y: closeBtnY, halfSize: 22 };
    this.popupBounds = {
      top: popupTop,
      bottom: popupTop + popupHeight,
      left: centerX - popupWidth / 2,
      right: centerX + popupWidth / 2,
    };

    // ── Dim overlay (visual only — clicks handled via scene pointerdown) ────────
    const overlay = this.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      0x000000,
      0.5,
    );

    // ── Background panel ────────────────────────────────────────────────────────
    const bg = this.add
      .rectangle(centerX, popupCenterY, popupWidth, popupHeight, 0x1a1a2e, 0.95)
      .setStrokeStyle(2, 0xf5a623);

    // ── Close button — visual hit area (clicks handled via scene pointerdown) ───
    const closeBg = this.add.rectangle(
      closeBtnX,
      closeBtnY,
      44,
      44,
      0x333344,
      0.6,
    );

    const closeIcon = this.add
      .text(closeBtnX, closeBtnY, "✕", {
        fontSize: `${Math.round(baseFontSize * 1.1)}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5);

    // Z-order: overlay → bg → avatar → content → close
    this.standPopup.add([
      overlay,
      bg,
      avatar,
      avatarInitial,
      ...textItems,
      closeBg,
      closeIcon,
    ]);
    this.standPopup.setVisible(true);
  }

  private showLoading() {
    const { width, height } = this.scale;
    this.standPopup.removeAll(true);

    const popupWidth = Math.min(width - 32, 480);
    const popupHeight = 80;
    const popupTop = height - popupHeight - 16;

    // No close button during loading — point it off-screen so it never matches
    this.closeBtnBounds = { x: -999, y: -999, halfSize: 22 };
    this.popupBounds = {
      top: popupTop,
      bottom: popupTop + popupHeight,
      left: width / 2 - popupWidth / 2,
      right: width / 2 + popupWidth / 2,
    };

    const overlay = this.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      0x000000,
      0.5,
    );

    const bg = this.add
      .rectangle(
        width / 2,
        popupTop + popupHeight / 2,
        popupWidth,
        popupHeight,
        0x1a1a2e,
        0.95,
      )
      .setStrokeStyle(2, 0xf5a623);

    const loadingText = this.add
      .text(width / 2, popupTop + popupHeight / 2, "Loading…", {
        fontSize: "16px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    this.standPopup.add([overlay, bg, loadingText]);
    this.standPopup.setVisible(true);
  }

  private closePopup() {
    this.standPopup.setVisible(false);
    this.isPopupOpen = false;
    // activeStand intentionally NOT reset here — zone-exit detection in update() handles it,
    // preventing the overlap callback from reopening the popup while player stays in the zone
    this.touchActive = false;
    this.touchDecay = 0;
    this.touchDeltaX = 0;
    this.touchDeltaY = 0;
    this.dragIndicator?.setVisible(false);
  }

  // ─── INPUT ───────────────────────────────────────────────────────────────

  private setupInput() {
    // Arrow keys
    this.cursors = this.input.keyboard!.createCursorKeys();

    // WASD
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Close popup with Escape
    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.isPopupOpen) this.closePopup();
    });

    // Touch / drag-to-move
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.isPopupOpen) {
        const onClose =
          Math.abs(pointer.x - this.closeBtnBounds.x) <=
            this.closeBtnBounds.halfSize &&
          Math.abs(pointer.y - this.closeBtnBounds.y) <=
            this.closeBtnBounds.halfSize;
        const outside =
          pointer.x < this.popupBounds.left ||
          pointer.x > this.popupBounds.right ||
          pointer.y < this.popupBounds.top ||
          pointer.y > this.popupBounds.bottom;
        if (onClose || outside) this.closePopup();
        return;
      }
      this.touchActive = true;
      this.touchDecay = 0;
      this.lastMoveByTouch = true;
      this.touchStartX = pointer.x;
      this.touchStartY = pointer.y;
      this.touchDeltaX = 0;
      this.touchDeltaY = 0;
      this.dragIndicator?.setPosition(pointer.x, pointer.y).setVisible(true);
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.touchActive) return;
      this.touchDeltaX = pointer.x - this.touchStartX;
      this.touchDeltaY = pointer.y - this.touchStartY;
      this.dragIndicator?.setPosition(pointer.x, pointer.y);
    });

    this.input.on("pointerup", () => {
      this.touchActive = false;
      this.touchDecay = 1.0; // begin deceleration — deltas preserved briefly
      this.dragIndicator?.setVisible(false);
    });

    this.input.on("pointerout", () => {
      this.touchActive = false;
      this.touchDecay = 0;
      this.touchDeltaX = 0;
      this.touchDeltaY = 0;
      this.dragIndicator?.setVisible(false);
    });
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────

  update() {
    // Reset activeStand only when player physically leaves a zone (not on popup close)
    for (const zone of this.previousOverlaps) {
      if (!this.currentOverlaps.has(zone) && this.activeStand === zone) {
        this.activeStand = null;
      }
    }
    this.previousOverlaps = new Set(this.currentOverlaps);
    this.currentOverlaps.clear();

    if (this.isPopupOpen) {
      this.player.setVelocity(0, 0);
      this.player.anims.play("idle", true);
      return;
    }

    this.handleMovement();
  }

  private handleMovement() {
    // Decay touch velocity each frame after finger lift
    if (!this.touchActive && this.touchDecay > 0) {
      this.touchDecay = Math.max(0, this.touchDecay - this.TOUCH_DECAY_RATE);
      if (this.touchDecay === 0) {
        this.touchDeltaX = 0;
        this.touchDeltaY = 0;
      }
    }

    const touchActive = this.touchActive || this.touchDecay > 0;
    const touchUp = touchActive && this.touchDeltaY < -this.touchDeadzone;
    const touchDown = touchActive && this.touchDeltaY > this.touchDeadzone;
    const touchLeft = touchActive && this.touchDeltaX < -this.touchDeadzone;
    const touchRight = touchActive && this.touchDeltaX > this.touchDeadzone;

    const keyUp = this.cursors.up.isDown || this.wasd.up.isDown;
    const keyDown = this.cursors.down.isDown || this.wasd.down.isDown;
    const keyLeft = this.cursors.left.isDown || this.wasd.left.isDown;
    const keyRight = this.cursors.right.isDown || this.wasd.right.isDown;

    if (keyUp || keyDown || keyLeft || keyRight) this.lastMoveByTouch = false;

    const up = keyUp || touchUp;
    const down = keyDown || touchDown;
    const left = keyLeft || touchLeft;
    const right = keyRight || touchRight;

    this.player.setVelocity(0, 0);

    if (left) this.player.setVelocityX(-this.PLAYER_SPEED);
    if (right) this.player.setVelocityX(this.PLAYER_SPEED);
    if (up) this.player.setVelocityY(-this.PLAYER_SPEED);
    if (down) this.player.setVelocityY(this.PLAYER_SPEED);

    // Decay only applies when the movement was touch-initiated
    const speed =
      this.PLAYER_SPEED *
      (this.touchActive ? 1 : this.lastMoveByTouch ? this.touchDecay || 1 : 1);
    this.player.body?.velocity.normalize().scale(speed);

    // Animations — prioritize horizontal for diagonals
    if (left) this.player.anims.play("walk-left", true);
    else if (right) this.player.anims.play("walk-right", true);
    else if (up) this.player.anims.play("walk-up", true);
    else if (down) this.player.anims.play("walk-down", true);
    else this.player.anims.play("idle", true);
  }
}
